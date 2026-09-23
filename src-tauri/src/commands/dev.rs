//! เครื่องมือนักพัฒนา: ทดสอบ API, webhook (ใช้ curl.exe ที่มากับ Windows 10+ — ไม่ติด CORS)
use crate::core::binaries;
use crate::error::{msg, AppResult};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::Instant;

fn curl() -> PathBuf {
    let sys = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
    let p = PathBuf::from(sys).join("System32").join("curl.exe");
    if p.is_file() { p } else { PathBuf::from("curl") }
}

fn webhook_body(url: &str, text: &str) -> String {
    if url.contains("discord") {
        serde_json::json!({ "content": text }).to_string()
    } else {
        // Slack และบริการส่วนใหญ่ใช้รูปแบบ {"text": ...}
        serde_json::json!({ "text": text }).to_string()
    }
}

/// ส่ง webhook แบบไม่รอผล (ใช้ตอนงานเสร็จ)
pub fn send_webhook_blocking(url: &str, text: &str) {
    let (url, body) = (url.to_string(), webhook_body(url, text));
    std::thread::spawn(move || {
        let _ = binaries::std_command(&curl())
            .args(["-s", "-m", "15", "-X", "POST", "-H", "Content-Type: application/json", "--data-binary", "@-"])
            .arg(&url)
            .stdin(std::process::Stdio::piped())
            .spawn()
            .and_then(|mut c| {
                use std::io::Write;
                if let Some(mut i) = c.stdin.take() {
                    let _ = i.write_all(body.as_bytes());
                }
                c.wait()
            });
    });
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpReq {
    method: String,
    url: String,
    headers: Vec<(String, String)>,
    body: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpResp {
    status: u16,
    headers: String,
    body: String,
    millis: u128,
}

#[tauri::command]
pub async fn http_request(req: HttpReq) -> AppResult<HttpResp> {
    if !(req.url.starts_with("http://") || req.url.starts_with("https://")) {
        return msg("URL ต้องขึ้นต้นด้วย http:// หรือ https://");
    }
    let mut cmd = binaries::command(&curl());
    cmd.args(["-s", "-i", "-m", "60", "-X", &req.method.to_uppercase()]);
    for (k, v) in &req.headers {
        if !k.trim().is_empty() {
            cmd.arg("-H").arg(format!("{}: {}", k.trim(), v));
        }
    }
    let has_body = !req.body.is_empty();
    if has_body {
        cmd.args(["--data-binary", "@-"]);
    }
    cmd.arg("--").arg(&req.url);
    cmd.stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped());
    let start = Instant::now();
    let mut child = cmd.spawn()?;
    if let Some(mut stdin) = child.stdin.take() {
        use tokio::io::AsyncWriteExt;
        if has_body {
            stdin.write_all(req.body.as_bytes()).await?;
        }
        drop(stdin);
    }
    let out = child.wait_with_output().await?;
    if !out.status.success() && out.stdout.is_empty() {
        return msg(format!("เชื่อมต่อไม่สำเร็จ: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    let text = String::from_utf8_lossy(&out.stdout).to_string();
    // แยกส่วน header สุดท้าย (กรณีมี 100 Continue / redirect)
    let mut rest = text.as_str();
    let mut head = "";
    while rest.starts_with("HTTP/") {
        match rest.split_once("\r\n\r\n") {
            Some((h, b)) => {
                head = h;
                rest = b;
            }
            None => {
                head = rest;
                rest = "";
            }
        }
    }
    let status = head.lines().next().and_then(|l| l.split_whitespace().nth(1)).and_then(|s| s.parse().ok()).unwrap_or(0);
    Ok(HttpResp { status, headers: head.to_string(), body: rest.to_string(), millis: start.elapsed().as_millis() })
}

#[tauri::command]
pub async fn send_webhook(url: String, text: String) -> AppResult<String> {
    let out = binaries::command(&curl())
        .args(["-s", "-m", "20", "-w", "%{http_code}", "-o", "NUL", "-X", "POST", "-H", "Content-Type: application/json", "-d"])
        .arg(webhook_body(&url, &text))
        .arg(&url)
        .output()
        .await?;
    let code = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if code.starts_with('2') {
        Ok(format!("ส่งสำเร็จ (HTTP {code})"))
    } else {
        msg(format!("ส่งไม่สำเร็จ (HTTP {code})"))
    }
}

/// หา rclone: ที่ติดตั้งผ่านปุ่มในโปรแกรม (AppDatain) → ข้างโปรแกรม → PATH
fn rclone_exe(app: &tauri::AppHandle) -> Option<PathBuf> {
    use tauri::Manager;
    let own = app.state::<crate::state::AppState>().data_dir.join("bin").join("rclone.exe");
    if own.is_file() {
        return Some(own);
    }
    binaries::resolve("rclone", "", None)
}

/// เรียก rclone (ตั้ง remote ด้วยปุ่ม "เชื่อมบัญชีคลาวด์" ก่อน)
#[tauri::command]
pub async fn run_rclone(app: tauri::AppHandle, args: Vec<String>) -> AppResult<String> {
    let exe = rclone_exe(&app).ok_or_else(|| crate::error::AppError::Msg("ยังไม่ได้ติดตั้ง rclone — กดปุ่ม \"ติดตั้ง rclone\" ในหน้านี้".into()))?;
    // อนุญาตเฉพาะคำสั่งที่ปลอดภัยสำหรับหน้าซิงก์
    let allowed = ["listremotes", "copy", "sync", "lsjson", "about", "link", "version", "copyto", "mkdir"];
    if !args.first().map(|a| allowed.contains(&a.as_str())).unwrap_or(false) {
        return msg("คำสั่ง rclone นี้ไม่อนุญาต");
    }
    let out = binaries::command(&exe).args(&args).output().await?;
    let text = String::from_utf8_lossy(&out.stdout).to_string();
    if out.status.success() {
        Ok(text)
    } else {
        msg(format!("rclone ผิดพลาด: {}", String::from_utf8_lossy(&out.stderr).lines().last().unwrap_or("")))
    }
}

/// ดาวน์โหลด rclone จากเว็บทางการ (downloads.rclone.org) — ทำเมื่อผู้ใช้กดปุ่มเท่านั้น
#[tauri::command]
pub async fn install_rclone(app: tauri::AppHandle) -> AppResult<String> {
    use std::io::Read;
    use tauri::Manager;
    let dir = app.state::<crate::state::AppState>().data_dir.join("bin");
    std::fs::create_dir_all(&dir)?;
    let arch = if cfg!(target_arch = "aarch64") { "arm64" } else { "amd64" };
    let url = format!("https://downloads.rclone.org/rclone-current-windows-{arch}.zip");
    let zip_path = dir.join("rclone-download.zip");
    let out = binaries::command(&curl()).args(["-fsSL", "--retry", "2", "-o"]).arg(&zip_path).arg(&url).output().await?;
    if !out.status.success() {
        return msg(format!("ดาวน์โหลด rclone ไม่สำเร็จ (ต่อเน็ตอยู่ไหม?): {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    let dest = dir.join("rclone.exe");
    let d2 = dest.clone();
    let zp = zip_path.clone();
    tauri::async_runtime::spawn_blocking(move || -> AppResult<()> {
        let mut z = zip::ZipArchive::new(std::fs::File::open(&zp)?)?;
        for i in 0..z.len() {
            let mut f = z.by_index(i)?;
            if f.name().ends_with("/rclone.exe") || f.name() == "rclone.exe" {
                let mut buf = Vec::new();
                f.read_to_end(&mut buf)?;
                std::fs::write(&d2, buf)?;
                return Ok(());
            }
        }
        Err(crate::error::AppError::Msg("ไม่พบ rclone.exe ในไฟล์ที่โหลดมา".into()))
    })
    .await
    .map_err(|e| crate::error::AppError::Msg(e.to_string()))??;
    let _ = std::fs::remove_file(&zip_path);
    let v = binaries::command(&dest).arg("version").output().await?;
    Ok(String::from_utf8_lossy(&v.stdout).lines().next().unwrap_or("rclone").to_string())
}

/// เปิดหน้าต่าง rclone config (ถามตอบในคอนโซล เชื่อม Google Drive/OneDrive ฯลฯ ผ่านเบราว์เซอร์)
#[tauri::command(async)]
pub fn rclone_config(app: tauri::AppHandle) -> AppResult<()> {
    let exe = rclone_exe(&app).ok_or_else(|| crate::error::AppError::Msg("ยังไม่ได้ติดตั้ง rclone".into()))?;
    // ต้องมีหน้าต่างคอนโซลให้พิมพ์ จึงไม่ใช้ CREATE_NO_WINDOW
    std::process::Command::new("cmd").args(["/c", "start", "rclone config"]).arg(&exe).arg("config").spawn()?;
    Ok(())
}
