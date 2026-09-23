//! FTP server แบบอ่านอย่างเดียว (anonymous) — ให้มือถือ/ทีวี/โปรแกรม FTP โหลดไฟล์ผ่าน LAN
//! รองรับคำสั่งพื้นฐาน: USER PASS SYST FEAT PWD CWD CDUP TYPE PASV EPSV LIST NLST RETR SIZE NOOP QUIT
use std::io::{BufRead, BufReader, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

pub struct FtpServer {
    pub port: u16,
    pub root: PathBuf,
    pub url: String,
    stop: Arc<AtomicBool>,
}

impl Drop for FtpServer {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        // ปลุก accept() ให้หลุดออกจากลูป
        let _ = TcpStream::connect(("127.0.0.1", self.port));
    }
}

pub fn start(root: PathBuf, port: u16) -> Result<FtpServer, String> {
    let listener = TcpListener::bind(("0.0.0.0", port)).map_err(|e| format!("เปิด FTP ไม่ได้ (พอร์ต {port} อาจถูกใช้อยู่): {e}"))?;
    let ip = local_ip_address::local_ip().map(|i| i.to_string()).unwrap_or_else(|_| "127.0.0.1".into());
    let stop = Arc::new(AtomicBool::new(false));
    let (s2, r2, ip2) = (stop.clone(), root.clone(), ip.clone());
    std::thread::spawn(move || {
        for conn in listener.incoming() {
            if s2.load(Ordering::SeqCst) {
                break;
            }
            if let Ok(c) = conn {
                let (r, i, s) = (r2.clone(), ip2.clone(), s2.clone());
                std::thread::spawn(move || {
                    let _ = session(c, &r, &i, &s);
                });
            }
        }
    });
    Ok(FtpServer { port, root, url: format!("ftp://{ip}:{port}/"), stop })
}

/// รวมพาธเสมือนกับ root โดยกันไม่ให้หลุดออกนอกโฟลเดอร์ที่แชร์
pub fn resolve(root: &Path, cwd: &str, arg: &str) -> Option<(String, PathBuf)> {
    let joined = if arg.starts_with('/') { arg.to_string() } else { format!("{}/{}", cwd.trim_end_matches('/'), arg) };
    let mut parts: Vec<String> = Vec::new();
    for c in Path::new(&joined.replace('\\', "/")).components() {
        match c {
            Component::Normal(p) if !p.to_string_lossy().contains(':') => parts.push(p.to_string_lossy().to_string()),
            Component::ParentDir => {
                parts.pop();
            }
            _ => {}
        }
    }
    let mut full = root.to_path_buf();
    for p in &parts {
        full.push(p);
    }
    Some((format!("/{}", parts.join("/")), full))
}

fn reply(w: &mut TcpStream, s: &str) -> std::io::Result<()> {
    w.write_all(format!("{s}\r\n").as_bytes())
}

fn session(ctrl: TcpStream, root: &Path, ip: &str, stop: &AtomicBool) -> std::io::Result<()> {
    let mut w = ctrl.try_clone()?;
    let mut r = BufReader::new(ctrl);
    let mut cwd = "/".to_string();
    let mut pasv: Option<TcpListener> = None;
    reply(&mut w, "220 MediaToolbox FTP (read-only)")?;
    let mut line = String::new();
    loop {
        line.clear();
        if r.read_line(&mut line)? == 0 || stop.load(Ordering::SeqCst) {
            break;
        }
        let l = line.trim_end();
        let (cmd, arg) = l.split_once(' ').map(|(a, b)| (a.to_uppercase(), b.to_string())).unwrap_or((l.to_uppercase(), String::new()));
        match cmd.as_str() {
            "USER" => reply(&mut w, "331 OK, any password")?,
            "PASS" => reply(&mut w, "230 Logged in")?,
            "SYST" => reply(&mut w, "215 UNIX Type: L8")?,
            "FEAT" => reply(&mut w, "211-Features:\r\n UTF8\r\n SIZE\r\n EPSV\r\n211 End")?,
            "OPTS" => reply(&mut w, "200 OK")?,
            "PWD" | "XPWD" => reply(&mut w, &format!("257 \"{cwd}\""))?,
            "TYPE" | "MODE" | "STRU" | "NOOP" => reply(&mut w, "200 OK")?,
            "CWD" | "CDUP" => {
                let target = if cmd == "CDUP" { ".." } else { arg.as_str() };
                match resolve(root, &cwd, target) {
                    Some((v, p)) if p.is_dir() => {
                        cwd = v;
                        reply(&mut w, "250 OK")?
                    }
                    _ => reply(&mut w, "550 ไม่พบโฟลเดอร์")?,
                }
            }
            "PASV" | "EPSV" => {
                let l = TcpListener::bind(("0.0.0.0", 0))?;
                let port = l.local_addr()?.port();
                pasv = Some(l);
                if cmd == "EPSV" {
                    reply(&mut w, &format!("229 Entering Extended Passive Mode (|||{port}|)"))?;
                } else {
                    let ipc = ip.replace('.', ",");
                    reply(&mut w, &format!("227 Entering Passive Mode ({ipc},{},{})", port >> 8, port & 0xff))?;
                }
            }
            "SIZE" => match resolve(root, &cwd, &arg) {
                Some((_, p)) if p.is_file() => reply(&mut w, &format!("213 {}", std::fs::metadata(&p)?.len()))?,
                _ => reply(&mut w, "550 ไม่พบไฟล์")?,
            },
            "LIST" | "NLST" | "MLSD" => {
                let target = if arg.starts_with('-') { "" } else { arg.as_str() };
                let Some((_, dir)) = resolve(root, &cwd, target) else { reply(&mut w, "550")?; continue };
                let Some(l) = pasv.take() else { reply(&mut w, "425 ใช้ PASV ก่อน")?; continue };
                reply(&mut w, "150 Listing")?;
                let (mut data, _) = l.accept()?;
                for e in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
                    let md = e.metadata()?;
                    let name = e.file_name().to_string_lossy().to_string();
                    let row = if cmd == "NLST" {
                        name
                    } else {
                        format!("{}rw-r--r-- 1 owner group {:>13} Jan  1 00:00 {}", if md.is_dir() { "d" } else { "-" }, md.len(), name)
                    };
                    data.write_all(format!("{row}\r\n").as_bytes())?;
                }
                let _ = data.shutdown(Shutdown::Both);
                reply(&mut w, "226 Done")?;
            }
            "RETR" => {
                let Some((_, p)) = resolve(root, &cwd, &arg).filter(|(_, p)| p.is_file()) else { reply(&mut w, "550 ไม่พบไฟล์")?; continue };
                let Some(l) = pasv.take() else { reply(&mut w, "425 ใช้ PASV ก่อน")?; continue };
                reply(&mut w, "150 Sending")?;
                let (mut data, _) = l.accept()?;
                let mut f = std::fs::File::open(p)?;
                std::io::copy(&mut f, &mut data)?;
                let _ = data.shutdown(Shutdown::Both);
                reply(&mut w, "226 Done")?;
            }
            "STOR" | "DELE" | "RMD" | "MKD" | "RNFR" | "RNTO" | "APPE" => reply(&mut w, "550 เซิร์ฟเวอร์นี้อ่านได้อย่างเดียว")?,
            "QUIT" => {
                reply(&mut w, "221 Bye")?;
                break;
            }
            _ => reply(&mut w, "502 ไม่รองรับคำสั่งนี้")?,
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_cannot_escape_root() {
        let root = Path::new("C:/share");
        let (v, p) = resolve(root, "/a", "../../../Windows").unwrap();
        assert_eq!(v, "/Windows");
        assert!(p.starts_with(root));
        let (v, _) = resolve(root, "/a/b", "..").unwrap();
        assert_eq!(v, "/a");
    }
}
