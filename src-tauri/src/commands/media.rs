//! อัดหน้าจอ (ภาพ + เสียงในเครื่อง + ไมค์)
use crate::core::db::HistoryItem;
use crate::core::recorder::{self, AudioDevices, RecordOptions, RecordStatus};
use crate::error::AppResult;
use crate::state::AppState;
use tauri::{AppHandle, Emitter, Manager};

#[tauri::command(async)]
pub fn rec_devices() -> AudioDevices {
    recorder::devices()
}

#[tauri::command]
pub async fn rec_start(app: AppHandle, options: RecordOptions) -> AppResult<RecordStatus> {
    let ffmpeg = app.state::<AppState>().tool("ffmpeg")?;
    let st = tauri::async_runtime::spawn_blocking(move || recorder::start(&ffmpeg, options))
        .await
        .map_err(|e| crate::error::AppError::Msg(e.to_string()))??;
    let _ = app.emit("recording-changed", true);
    Ok(st)
}

#[tauri::command(async)]
pub fn rec_status() -> RecordStatus {
    recorder::status()
}

#[tauri::command]
pub async fn rec_stop(app: AppHandle) -> AppResult<String> {
    stop_and_save(app).await
}

/// ใช้ทั้งปุ่มในหน้าและเมนูถาดระบบ
pub async fn stop_and_save(app: AppHandle) -> AppResult<String> {
    let ffmpeg = app.state::<AppState>().tool("ffmpeg")?;
    let res = tauri::async_runtime::spawn_blocking(move || recorder::stop(&ffmpeg))
        .await
        .map_err(|e| crate::error::AppError::Msg(e.to_string()))?;
    let _ = app.emit("recording-changed", false);
    let (path, secs) = res?;
    let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0) as i64;
    let state = app.state::<AppState>();
    let _ = state.db.lock().unwrap().add_history(&HistoryItem {
        id: uuid::Uuid::new_v4().to_string(),
        kind: "record".into(),
        title: format!("อัดหน้าจอ {}", std::path::Path::new(&path).file_name().unwrap_or_default().to_string_lossy()),
        input: String::new(),
        output: path.clone(),
        status: "done".into(),
        size_before: 0,
        size_after: size,
        message: format!("{:.0} วินาที", secs),
        created_at: chrono::Local::now().to_rfc3339(),
    });
    let _ = app.emit("history-changed", ());
    Ok(path)
}

// ---------- ล้างเครื่อง ----------
use crate::core::cleaner::{self, AppDirs, Category, CleanResult, StartupItem};

fn app_dirs(app: &AppHandle) -> AppDirs {
    let st = app.state::<AppState>();
    let downloads = std::path::PathBuf::from(&st.settings.lock().unwrap().download_dir);
    AppDirs { scratch: vec![st.data_dir.join("thumbs"), st.data_dir.join("temp")], downloads: Some(downloads) }
}

#[tauri::command]
pub async fn clean_scan(app: AppHandle) -> AppResult<Vec<Category>> {
    let dirs = app_dirs(&app);
    tauri::async_runtime::spawn_blocking(move || cleaner::scan(&dirs)).await.map_err(|e| crate::error::AppError::Msg(e.to_string()))
}

#[tauri::command]
pub async fn clean_run(app: AppHandle, ids: Vec<String>) -> AppResult<CleanResult> {
    let dirs = app_dirs(&app);
    let r = tauri::async_runtime::spawn_blocking(move || cleaner::clean(&ids, &dirs)).await.map_err(|e| crate::error::AppError::Msg(e.to_string()))?;
    let st = app.state::<AppState>();
    st.log("info", "cleaner", &format!("ล้างเครื่อง: คืนพื้นที่ {} ไบต์, ลบ {} ไฟล์, ข้าม {} ไฟล์ที่ใช้อยู่", r.freed, r.deleted, r.skipped));
    let _ = st.db.lock().unwrap().add_history(&HistoryItem {
        id: uuid::Uuid::new_v4().to_string(),
        kind: "clean".into(),
        title: "ล้างไฟล์ขยะในเครื่อง".into(),
        input: String::new(),
        output: String::new(),
        status: "done".into(),
        size_before: r.freed as i64,
        size_after: 0,
        message: format!("ลบ {} ไฟล์", r.deleted),
        created_at: chrono::Local::now().to_rfc3339(),
    });
    let _ = app.emit("history-changed", ());
    Ok(r)
}

#[tauri::command(async)]
pub fn startup_list() -> Vec<StartupItem> {
    cleaner::startup_list()
}

#[tauri::command(async)]
pub fn startup_set(name: String, location: String, enabled: bool) -> AppResult<()> {
    cleaner::startup_set(&name, &location, enabled)
}

/// โปรแกรมรันด้วยสิทธิ์แอดมินอยู่ไหม (ล้าง Windows Update/Temp ของระบบต้องใช้)
#[tauri::command(async)]
pub fn is_admin() -> bool {
    #[cfg(windows)]
    {
        // เขียนโฟลเดอร์ระบบได้ = แอดมิน
        let p = std::path::PathBuf::from(std::env::var_os("SystemRoot").unwrap_or_default()).join("Temp").join(format!("mtb-admin-{}", std::process::id()));
        let ok = std::fs::write(&p, b"").is_ok() && std::fs::remove_file(&p).is_ok();
        let q = std::path::PathBuf::from(std::env::var_os("SystemRoot").unwrap_or_default()).join("SoftwareDistribution").join(format!("mtb-{}", std::process::id()));
        ok && std::fs::create_dir(&q).is_ok() && std::fs::remove_dir(&q).is_ok()
    }
    #[cfg(not(windows))]
    false
}

/// เปิดโปรแกรมนี้ใหม่แบบ Run as administrator (Windows จะถาม UAC)
#[tauri::command(async)]
pub fn relaunch_admin(app: AppHandle) -> AppResult<()> {
    let exe = std::env::current_exe()?;
    crate::core::binaries::std_command(&std::path::PathBuf::from("powershell"))
        .args(["-NoProfile", "-Command", &format!("Start-Process -FilePath '{}' -Verb RunAs", exe.to_string_lossy().replace('\'', "''"))])
        .spawn()?;
    app.exit(0);
    Ok(())
}

/// ลิงก์เล่นแบบแปลงสด (ดู core::stream)
#[tauri::command(async)]
pub fn play_stream_url(app: AppHandle, path: String, start: f64, track: String, video: String) -> AppResult<String> {
    let ff = app.state::<AppState>().tool("ffmpeg")?;
    let (port, token) = crate::core::stream::ensure(ff).map_err(crate::error::AppError::Msg)?;
    Ok(format!(
        "http://127.0.0.1:{port}/s?k={token}&f={}&t={start:.3}&a={}&v={}&n={}",
        urlencoding::encode(&path),
        urlencoding::encode(&track),
        urlencoding::encode(&video),
        rand::random::<u32>()
    ))
}

/// สั่งงานด้วยเสียงแบบออฟไลน์ด้วยตัวรู้จำเสียงของ Windows (System.Speech) — ฟังได้เฉพาะคำในรายการ จึงแม่นและไม่ต้องใช้เน็ต
/// คืน {text, culture}; text ว่าง = ไม่ได้ยินคำที่รู้จัก
#[tauri::command]
pub async fn voice_listen(words: Vec<String>, seconds: Option<u32>) -> AppResult<serde_json::Value> {
    let list = words
        .iter()
        .map(|w| w.replace('\'', "''").replace(['\r', '\n'], " "))
        .filter(|w| !w.trim().is_empty())
        .map(|w| format!("'{w}'"))
        .collect::<Vec<_>>()
        .join(",");
    if list.is_empty() {
        return Err(crate::error::AppError::Msg("ไม่มีคำสั่งให้ฟัง".into()));
    }
    let secs = seconds.unwrap_or(6).clamp(2, 20);
    let script = format!(
        r#"$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech
$all=[System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()
if($all.Count -eq 0){{ Write-Output '{{"error":"norecognizer"}}'; exit }}
$info=($all | Where-Object {{ $_.Culture.Name -eq 'th-TH' }} | Select-Object -First 1)
if(-not $info){{ $info=($all | Where-Object {{ $_.Culture.Name -like 'en-*' }} | Select-Object -First 1) }}
if(-not $info){{ $info=$all[0] }}
$r=New-Object System.Speech.Recognition.SpeechRecognitionEngine($info)
$c=New-Object System.Speech.Recognition.Choices
$c.Add([string[]]@({list}))
$gb=New-Object System.Speech.Recognition.GrammarBuilder($c)
$gb.Culture=$info.Culture
$r.LoadGrammar((New-Object System.Speech.Recognition.Grammar($gb)))
try {{ $r.SetInputToDefaultAudioDevice() }} catch {{ Write-Output '{{"error":"nomic"}}'; exit }}
$res=$r.Recognize([TimeSpan]::FromSeconds({secs}))
$t=''; if($res -and $res.Confidence -ge 0.4){{ $t=$res.Text }}
@{{text=$t;culture=$info.Culture.Name}} | ConvertTo-Json -Compress"#
    );
    let out = crate::core::binaries::command(&std::path::PathBuf::from("powershell"))
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", &script])
        .output()
        .await?;
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let v: serde_json::Value = serde_json::from_str(text.lines().last().unwrap_or("")).map_err(|_| {
        crate::error::AppError::Msg(format!("ตัวรู้จำเสียงของ Windows ทำงานไม่สำเร็จ: {}", String::from_utf8_lossy(&out.stderr).lines().next().unwrap_or("")))
    })?;
    match v.get("error").and_then(|e| e.as_str()) {
        Some("norecognizer") => Err(crate::error::AppError::Msg("Windows เครื่องนี้ไม่มีตัวรู้จำเสียง — ติดตั้งได้ที่ Settings → Time & Language → Speech".into())),
        Some("nomic") => Err(crate::error::AppError::Msg("ไม่พบไมโครโฟน".into())),
        _ => Ok(v),
    }
}

/// รายชื่อหน้าต่างที่เปิดอยู่ (สำหรับจับภาพเฉพาะหน้าต่าง)
#[tauri::command(async)]
pub fn list_windows() -> Vec<String> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::{HWND, LPARAM};
        use windows_sys::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindowTextLengthW, GetWindowTextW, IsIconic, IsWindowVisible};
        unsafe extern "system" fn cb(h: HWND, l: LPARAM) -> i32 {
            let v = &mut *(l as *mut Vec<String>);
            if IsWindowVisible(h) != 0 && IsIconic(h) == 0 {
                let n = GetWindowTextLengthW(h);
                if n > 0 {
                    let mut buf = vec![0u16; n as usize + 1];
                    let got = GetWindowTextW(h, buf.as_mut_ptr(), buf.len() as i32);
                    let t = String::from_utf16_lossy(&buf[..got as usize]);
                    if !t.trim().is_empty() && t != "Program Manager" && !v.contains(&t) {
                        v.push(t);
                    }
                }
            }
            1
        }
        let mut v: Vec<String> = Vec::new();
        unsafe {
            EnumWindows(Some(cb), &mut v as *mut _ as LPARAM);
        }
        v
    }
    #[cfg(not(windows))]
    vec![]
}

// ---------- ส่งขึ้นทีวี (DLNA) ----------
use crate::core::dlna;

#[tauri::command]
pub async fn dlna_discover() -> Vec<dlna::Renderer> {
    tauri::async_runtime::spawn_blocking(|| dlna::discover(3)).await.unwrap_or_default()
}

#[tauri::command]
pub async fn dlna_cast(control: String, url: String, title: String) -> AppResult<()> {
    let path = url.split('?').next().unwrap_or("").to_string();
    let mime = mime_guess::from_path(urlencoding::decode(&path).map(|s| s.into_owned()).unwrap_or(path)).first_or_octet_stream().to_string();
    tauri::async_runtime::spawn_blocking(move || dlna::cast(&control, &url, &title, &mime))
        .await
        .map_err(|e| crate::error::AppError::Msg(e.to_string()))?
        .map_err(crate::error::AppError::Msg)
}

#[tauri::command]
pub async fn dlna_control(control: String, action: String, rendering: Option<String>, volume: Option<u32>) -> AppResult<()> {
    tauri::async_runtime::spawn_blocking(move || match (rendering, volume) {
        (Some(r), Some(v)) if action == "volume" => dlna::volume(&r, v),
        _ => dlna::control(&control, &action),
    })
    .await
    .map_err(|e| crate::error::AppError::Msg(e.to_string()))?
    .map_err(crate::error::AppError::Msg)
}

#[cfg(test)]
mod tests {
    #[test]
    fn windows_listed() {
        let _ = super::list_windows();
    }

    #[tokio::test]
    async fn voice_script_runs() {
        // เงียบ 2 วินาที → ต้องได้ JSON (text ว่าง) หรือ error ภาษาไทยที่อ่านรู้เรื่อง ไม่ใช่สคริปต์พัง
        let r = super::voice_listen(vec!["home".into(), "it's settings".into()], Some(2)).await;
        println!("voice: {r:?}");
        match r {
            Ok(v) => assert!(v.get("culture").is_some(), "{v}"),
            Err(e) => assert!(e.to_string().contains("ไมโครโฟน") || e.to_string().contains("ตัวรู้จำเสียง"), "{e}"),
        }
    }
}
