//! แปลงสดสำหรับเครื่องเล่นในตัว: ไฟล์ที่ WebView เล่นเองไม่ได้ (HEVC, MPEG-2, AVI, WMV, FLAC ใน MKV ฯลฯ)
//! ffmpeg แปลงเป็น fragmented MP4 แล้วส่งออกทาง HTTP ในเครื่องทันที — ดูได้ภายในไม่กี่วินาที
//! ไม่ต้องรอแปลงทั้งไฟล์ และไม่มีเพดานเวลา (หนัง 3 ชั่วโมงก็ได้) กรอ = เริ่ม ffmpeg ใหม่ที่ตำแหน่งนั้น
use crate::core::binaries;
use std::io::Read;
use std::path::PathBuf;
use std::process::{Child, Stdio};
use std::sync::OnceLock;
use tiny_http::{Header, Response, Server};

struct Stream {
    port: u16,
    token: String,
}

static SERVER: OnceLock<Stream> = OnceLock::new();

/// อ่าน stdout ของ ffmpeg — ถ้าผู้เล่นตัดการเชื่อมต่อ (กรอ/เปลี่ยนไฟล์) จะฆ่า ffmpeg ทิ้งทันที
struct ChildReader {
    child: Child,
}

impl Read for ChildReader {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        match self.child.stdout.as_mut() {
            Some(o) => o.read(buf),
            None => Ok(0),
        }
    }
}

impl Drop for ChildReader {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn param(url: &str, key: &str) -> Option<String> {
    let q = url.split_once('?')?.1;
    q.split('&').find_map(|kv| {
        let (k, v) = kv.split_once('=')?;
        (k == key).then(|| urlencoding::decode(v).map(|s| s.into_owned()).unwrap_or_default())
    })
}

pub fn ensure(ffmpeg: PathBuf) -> Result<(u16, String), String> {
    if let Some(s) = SERVER.get() {
        return Ok((s.port, s.token.clone()));
    }
    // ฟังเฉพาะ 127.0.0.1 + โทเคนสุ่ม → เครื่องอื่นหรือเว็บอื่นเรียกใช้ไม่ได้
    let server = Server::http("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = server.server_addr().to_ip().map(|a| a.port()).unwrap_or(0);
    let token = format!("{:032x}", rand::random::<u128>());
    let tk = token.clone();
    std::thread::spawn(move || {
        for req in server.incoming_requests() {
            let ff = ffmpeg.clone();
            let tk = tk.clone();
            std::thread::spawn(move || handle(req, &ff, &tk));
        }
    });
    let _ = SERVER.set(Stream { port, token });
    let s = SERVER.get().unwrap();
    Ok((s.port, s.token.clone()))
}

fn handle(req: tiny_http::Request, ffmpeg: &PathBuf, token: &str) {
    let url = req.url().to_string();
    if param(&url, "k").as_deref() != Some(token) {
        let _ = req.respond(Response::empty(403));
        return;
    }
    let Some(file) = param(&url, "f").filter(|f| std::path::Path::new(f).is_file()) else {
        let _ = req.respond(Response::empty(404));
        return;
    };
    let start: f64 = param(&url, "t").and_then(|t| t.parse().ok()).unwrap_or(0.0);
    let track = param(&url, "a").unwrap_or_else(|| "0".into());
    // v: copy (H.264 เล่นได้อยู่แล้ว แค่เปลี่ยนกล่อง) | enc (แปลงภาพ) | none (เสียงอย่างเดียว)
    let v = param(&url, "v").unwrap_or_else(|| "enc".into());
    let mut args: Vec<String> = vec!["-hide_banner".into(), "-loglevel".into(), "error".into(), "-nostdin".into()];
    if start > 0.0 {
        args.extend(["-ss".into(), format!("{start:.3}")]);
    }
    args.extend(["-i".into(), file]);
    match v.as_str() {
        "none" => args.extend(["-vn".into(), "-map".into(), format!("0:a:{track}?")]),
        mode => {
            args.extend(["-map".into(), "0:v:0".into(), "-map".into(), format!("0:a:{track}?")]);
            if mode == "copy" {
                args.extend(["-c:v".into(), "copy".into()]);
            } else {
                // veryfast + ใช้ทุกคอร์: 1080p แปลงได้เร็วกว่าเวลาจริงบนเครื่องทั่วไป
                args.extend(["-c:v", "libx264", "-preset", "veryfast", "-tune", "fastdecode", "-crf", "21", "-pix_fmt", "yuv420p", "-g", "60"].map(String::from));
                // 4K → ย่อเหลือ 1080p ให้ทันเวลาจริง
                args.extend(["-vf".into(), "scale='min(1920,iw)':-2".into()]);
            }
        }
    }
    args.extend(["-c:a", "aac", "-b:a", "192k", "-ac", "2", "-sn", "-dn"].map(String::from));
    args.extend(["-movflags", "frag_keyframe+empty_moov+default_base_moof", "-frag_duration", "1000000", "-f", "mp4", "pipe:1"].map(String::from));
    let child = binaries::std_command(ffmpeg).args(&args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn();
    let Ok(child) = child else {
        let _ = req.respond(Response::empty(500));
        return;
    };
    let ct = if v == "none" { "audio/mp4" } else { "video/mp4" };
    let headers = vec![
        Header::from_bytes("Content-Type", ct).unwrap(),
        Header::from_bytes("Cache-Control", "no-store").unwrap(),
        Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap(),
    ];
    // ไม่รู้ความยาวล่วงหน้า → ส่งแบบ chunked
    let resp = Response::new(200.into(), headers, ChildReader { child }, None, None);
    let _ = req.respond(resp);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stream_hevc_as_mp4() {
        let bin = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bin");
        let ff = bin.join("ffmpeg.exe");
        if !ff.is_file() {
            return;
        }
        let d = std::env::temp_dir().join(format!("mtb-stream-{}", rand::random::<u32>()));
        std::fs::create_dir_all(&d).unwrap();
        let src = d.join("คลิป hevc.mkv");
        let ok = std::process::Command::new(&ff)
            .args(["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=25:duration=6", "-f", "lavfi", "-i", "sine=duration=6", "-c:v", "libx265", "-c:a", "flac"])
            .arg(&src)
            .status()
            .unwrap();
        assert!(ok.success());
        let (port, token) = ensure(ff.clone()).unwrap();
        let url = format!("/s?k={token}&f={}&t=2&a=0&v=enc", urlencoding::encode(&src.to_string_lossy()));
        let mut s = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
        use std::io::Write;
        write!(s, "GET {url} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n").unwrap();
        let mut body = Vec::new();
        s.read_to_end(&mut body).unwrap();
        let text = String::from_utf8_lossy(&body[..body.len().min(400)]).to_string();
        assert!(text.starts_with("HTTP/1.1 200"), "{text}");
        assert!(body.windows(4).any(|w| w == b"moof"), "ต้องเป็น fragmented mp4");
        // โทเคนผิดต้องถูกปฏิเสธ
        let mut s = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(s, "GET /s?k=bad&f=x HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n").unwrap();
        let mut b2 = String::new();
        s.read_to_string(&mut b2).unwrap();
        assert!(b2.starts_with("HTTP/1.1 403"));
        std::fs::remove_dir_all(d).unwrap();
    }
}
