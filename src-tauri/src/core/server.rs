//! Media Server ท้องถิ่น (HTTP) — แชร์ไฟล์ผ่าน LAN, เล่นบนมือถือ/Smart TV, ฟีดพอดแคสต์ RSS
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tiny_http::{Header, Request, Response, Server, StatusCode};

pub struct MediaServer {
    pub server: Arc<Server>,
    pub root: PathBuf,
    pub port: u16,
    pub url: String,
}

impl Drop for MediaServer {
    fn drop(&mut self) {
        self.server.unblock();
    }
}

const MEDIA_EXT: &[&str] = &[
    "mp4", "mkv", "webm", "mov", "avi", "m4v", "flv", "wmv", "mp3", "m4a", "wav", "flac", "ogg",
    "opus", "aac", "jpg", "jpeg", "png", "gif", "webp", "avif", "pdf", "zip", "srt", "vtt",
];

pub fn start(root: PathBuf, port: u16) -> Result<MediaServer, String> {
    let server = Server::http(("0.0.0.0", port))
        .map_err(|e| format!("เปิดเซิร์ฟเวอร์ไม่ได้ (พอร์ต {port} อาจถูกใช้อยู่): {e}"))?;
    let server = Arc::new(server);
    let ip = local_ip_address::local_ip()
        .map(|i| i.to_string())
        .unwrap_or_else(|_| "127.0.0.1".into());
    let url = format!("http://{ip}:{port}/");
    let (s2, r2, base) = (server.clone(), root.clone(), url.clone());
    std::thread::spawn(move || {
        for req in s2.incoming_requests() {
            let (r, b) = (r2.clone(), base.clone());
            std::thread::spawn(move || handle(req, &r, &b));
        }
    });
    Ok(MediaServer { server, root, port, url })
}

fn header(k: &str, v: &str) -> Header {
    Header::from_bytes(k.as_bytes(), v.as_bytes()).unwrap()
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn list_media(root: &Path) -> Vec<(String, u64)> {
    let mut v: Vec<(String, u64)> = walkdir::WalkDir::new(root)
        .max_depth(3)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file())
        .filter(|e| {
            e.path()
                .extension()
                .map(|x| MEDIA_EXT.contains(&x.to_string_lossy().to_lowercase().as_str()))
                .unwrap_or(false)
        })
        .filter_map(|e| {
            let rel = e.path().strip_prefix(root).ok()?.to_string_lossy().replace('\\', "/");
            Some((rel, e.metadata().map(|m| m.len()).unwrap_or(0)))
        })
        .collect();
    v.sort();
    v
}

fn enc_path(rel: &str) -> String {
    rel.split('/').map(|p| urlencoding::encode(p).into_owned()).collect::<Vec<_>>().join("/")
}

/// รวมพาธที่ร้องขอกับโฟลเดอร์ที่แชร์ — ปฏิเสธทุกอย่างที่อาจหลุดออกนอก root
/// (`..`, พาธเต็ม, ไดรฟ์ `C:`, UNC `\\server`, ทั้งแบบ `/` และ `\`)
pub fn safe_join(root: &Path, rel: &str) -> Option<PathBuf> {
    let mut out = root.to_path_buf();
    for part in rel.split(['/', '\\']) {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." || part.contains(':') || part.contains('\0') {
            return None;
        }
        out.push(part);
    }
    // กันซ้ำอีกชั้น: symlink/junction ที่ชี้ออกนอกโฟลเดอร์
    let (Ok(real), Ok(real_root)) = (out.canonicalize(), root.canonicalize()) else {
        return Some(out); // ไฟล์ไม่มีอยู่ → serve_file ตอบ 404 เอง
    };
    real.starts_with(&real_root).then_some(out)
}

fn handle(req: Request, root: &Path, base: &str) {
    let raw = req.url().split('?').next().unwrap_or("/").to_string();
    let path = urlencoding::decode(&raw).map(|s| s.into_owned()).unwrap_or(raw);
    if path == "/" {
        let items = list_media(root);
        let mut rows = String::new();
        for (rel, size) in &items {
            let lower = rel.to_lowercase();
            let is_video = [".mp4", ".webm", ".m4v", ".mov", ".mkv"].iter().any(|e| lower.ends_with(e));
            let is_audio = [".mp3", ".m4a", ".wav", ".ogg", ".opus", ".flac", ".aac"].iter().any(|e| lower.ends_with(e));
            let href = format!("/files/{}", enc_path(rel));
            let player = if is_video {
                format!("<video src=\"{href}\" controls preload=\"none\"></video>")
            } else if is_audio {
                format!("<audio src=\"{href}\" controls preload=\"none\"></audio>")
            } else {
                String::new()
            };
            rows.push_str(&format!(
                "<li><a href=\"{href}\" download>{}</a> <small>{:.1} MB</small>{player}</li>",
                html_escape(rel),
                *size as f64 / 1048576.0
            ));
        }
        let body = format!(
            "<!doctype html><html lang=\"th\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\
             <title>MediaToolbox Server</title><style>body{{font-family:sans-serif;background:#0b0b18;color:#eee;padding:16px}}\
             a{{color:#67e8f9}}li{{margin:10px 0;list-style:none;border-bottom:1px solid #333;padding-bottom:8px}}video,audio{{display:block;width:100%;max-width:640px;margin-top:6px}}</style></head>\
             <body><h2>📺 มีเดียทูลบ็อกซ์ — ไฟล์ที่แชร์ ({})</h2><p><a href=\"/feed.xml\">ฟีดพอดแคสต์ RSS</a></p><ul>{rows}</ul></body></html>",
            items.len()
        );
        let _ = req.respond(Response::from_string(body).with_header(header("Content-Type", "text/html; charset=utf-8")));
        return;
    }
    if path == "/feed.xml" {
        let mut items = String::new();
        for (rel, size) in list_media(root) {
            let lower = rel.to_lowercase();
            if !(lower.ends_with(".mp3") || lower.ends_with(".m4a") || lower.ends_with(".mp4")) {
                continue;
            }
            let mime = mime_guess::from_path(&rel).first_or_octet_stream();
            items.push_str(&format!(
                "<item><title>{}</title><enclosure url=\"{base}files/{}\" length=\"{size}\" type=\"{mime}\"/><guid>{}</guid></item>",
                html_escape(&rel),
                enc_path(&rel),
                html_escape(&rel)
            ));
        }
        let body = format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?><rss version=\"2.0\"><channel><title>MediaToolbox Podcast</title><link>{base}</link><description>พอดแคสต์จากมีเดียทูลบ็อกซ์</description><language>th</language>{items}</channel></rss>"
        );
        let _ = req.respond(Response::from_string(body).with_header(header("Content-Type", "application/rss+xml; charset=utf-8")));
        return;
    }
    if path == "/api/list" {
        let json = serde_json::to_string(&list_media(root)).unwrap_or_default();
        let _ = req.respond(Response::from_string(json).with_header(header("Content-Type", "application/json")).with_header(header("Access-Control-Allow-Origin", "*")));
        return;
    }
    if let Some(rel) = path.strip_prefix("/files/") {
        // ป้องกันการเข้าถึงนอกโฟลเดอร์ที่แชร์
        match safe_join(root, rel) {
            Some(p) => serve_file(req, &p),
            None => {
                let _ = req.respond(Response::empty(StatusCode(403)));
            }
        }
        return;
    }
    let _ = req.respond(Response::from_string("ไม่พบหน้า").with_status_code(404));
}

/// ส่งไฟล์พร้อมรองรับ Range (กรอวิดีโอได้)
/// ทีวี Samsung/LG บางรุ่นต้องเห็นหัวข้อ DLNA ถึงจะยอมเล่น/กรอ
const DLNA_FEATURES: &str = "DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000";

fn serve_file(req: Request, path: &Path) {
    let Ok(mut f) = File::open(path) else {
        let _ = req.respond(Response::empty(StatusCode(404)));
        return;
    };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let mime = mime_guess::from_path(path).first_or_octet_stream().to_string();
    let range = req
        .headers()
        .iter()
        .find(|h| h.field.equiv("Range"))
        .map(|h| h.value.as_str().to_string());
    if let Some(r) = range.and_then(|r| r.strip_prefix("bytes=").map(|s| s.to_string())) {
        let mut it = r.splitn(2, '-');
        let start: u64 = it.next().and_then(|s| s.parse().ok()).unwrap_or(0);
        let end: u64 = it
            .next()
            .and_then(|s| s.parse().ok())
            .unwrap_or(len.saturating_sub(1))
            .min(len.saturating_sub(1));
        if start > end || start >= len {
            let _ = req.respond(Response::empty(StatusCode(416)));
            return;
        }
        let n = end - start + 1;
        let _ = f.seek(SeekFrom::Start(start));
        let reader = f.take(n);
        let resp = Response::new(
            StatusCode(206),
            vec![
                header("Content-Type", &mime),
                header("Accept-Ranges", "bytes"),
                header("Content-Range", &format!("bytes {start}-{end}/{len}")),
                header("transferMode.dlna.org", "Streaming"),
                header("contentFeatures.dlna.org", DLNA_FEATURES),
            ],
            reader,
            Some(n as usize),
            None,
        );
        let _ = req.respond(resp);
    } else {
        let resp = Response::new(
            StatusCode(200),
            vec![
                header("Content-Type", &mime),
                header("Accept-Ranges", "bytes"),
                header("transferMode.dlna.org", "Streaming"),
                header("contentFeatures.dlna.org", DLNA_FEATURES),
            ],
            f,
            Some(len as usize),
            None,
        );
        let _ = req.respond(resp);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cannot_escape_shared_folder() {
        let root = std::env::temp_dir().join(format!("mtb-srv-{}", rand::random::<u32>()));
        std::fs::create_dir_all(root.join("ย่อย")).unwrap();
        std::fs::write(root.join("ย่อย").join("a.mp4"), b"x").unwrap();
        assert!(safe_join(&root, "ย่อย/a.mp4").is_some());
        assert!(safe_join(&root, r"ย่อย\a.mp4").is_some());
        for bad in ["../x", r"..\..\Windows\win.ini", r"ย่อย/..\..\x", r"C:\Windows\win.ini"] {
            assert!(safe_join(&root, bad).is_none(), "{bad} ต้องถูกปฏิเสธ");
        }
        // พาธเต็ม/UNC ต้องถูกบังคับให้อยู่ใต้ root เสมอ
        for p in [r"\Windows\win.ini", r"\\server\share\x"] {
            assert!(safe_join(&root, p).unwrap().starts_with(&root), "{p}");
        }
        std::fs::remove_dir_all(root).unwrap();
    }
}
