//! หาไฟล์ yt-dlp / ffmpeg / ffprobe: พาธที่ตั้งเอง → โฟลเดอร์ bin ที่ bundle มา → PATH
use std::path::PathBuf;

pub fn resolve(name: &str, custom: &str, resource_dir: Option<&PathBuf>) -> Option<PathBuf> {
    if !custom.trim().is_empty() {
        let p = PathBuf::from(custom.trim());
        if p.is_file() {
            return Some(p);
        }
    }
    let exe = format!("{name}{}", std::env::consts::EXE_SUFFIX);
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(r) = resource_dir {
        candidates.push(r.join("bin").join(&exe));
    }
    if let Ok(cur) = std::env::current_exe() {
        if let Some(d) = cur.parent() {
            candidates.push(d.join("bin").join(&exe));
            candidates.push(d.join(&exe));
        }
    }
    // โหมดพัฒนา: src-tauri/bin
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bin").join(&exe));
    if let Some(c) = candidates.into_iter().find(|c| c.is_file()) {
        return Some(c);
    }
    // ค้นใน PATH
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|d| d.join(&exe))
        .find(|p| p.is_file())
}

/// สร้าง Command แบบ async ที่ไม่เด้งหน้าต่าง console บน Windows
pub fn command(program: &PathBuf) -> tokio::process::Command {
    #[allow(unused_mut)]
    let mut c = tokio::process::Command::new(program);
    #[cfg(windows)]
    c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    c
}

/// Command สำหรับงานหนักในคิว (โหลด/แปลง) — ลดลำดับความสำคัญ CPU ให้เครื่องไม่หน่วง
/// (process ลูกที่ yt-dlp เปิด เช่น ffmpeg จะได้ลำดับนี้ตามไปด้วย)
pub fn job_command(program: &PathBuf) -> tokio::process::Command {
    #[allow(unused_mut)]
    let mut c = tokio::process::Command::new(program);
    #[cfg(windows)]
    c.creation_flags(0x0800_0000 | 0x0000_4000); // CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS
    c
}

/// ฆ่า process พร้อมลูกหลานทั้งหมด — yt-dlp.exe (PyInstaller) แตก process ลูกที่ทำงานจริง
/// และเปิด ffmpeg ต่ออีกชั้น ถ้าฆ่าแค่ตัวแม่ ตัวลูกจะโหลดต่อไปเรื่อย ๆ
pub fn kill_tree(pid: u32) {
    #[cfg(windows)]
    {
        let _ = std_command(&PathBuf::from("taskkill"))
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new("pkill").args(["-KILL", "-P", &pid.to_string()]).status();
    }
}

/// สร้าง Command แบบ sync ที่ไม่เด้งหน้าต่าง console
pub fn std_command(program: &PathBuf) -> std::process::Command {
    #[allow(unused_mut)]
    let mut c = std::process::Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000);
    }
    c
}
