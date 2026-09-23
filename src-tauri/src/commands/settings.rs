//! คำสั่งเกี่ยวกับการตั้งค่า, สำรอง/กู้คืน, สถานะเครื่องมือภายนอก
use crate::core::binaries;
use crate::core::settings::Settings;
use crate::error::{msg, AppResult};
use crate::state::AppState;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

#[tauri::command(async)]
pub fn get_settings(state: State<AppState>) -> Settings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command(async)]
pub fn save_settings(app: AppHandle, state: State<AppState>, settings: Settings) -> AppResult<Settings> {
    let mut s = settings;
    // PIN เปลี่ยนได้เฉพาะผ่านคำสั่ง set_pin
    s.pin_hash = state.settings.lock().unwrap().pin_hash.clone();
    s.concurrent_jobs = s.concurrent_jobs.clamp(1, 16);
    if s.download_dir.trim().is_empty() {
        s.download_dir = crate::core::settings::default_download_dir();
    }
    std::fs::create_dir_all(&s.download_dir)?;
    s.save(&state.settings_path)?;
    let autostart_changed = state.settings.lock().unwrap().autostart != s.autostart;
    *state.settings.lock().unwrap() = s.clone();
    if autostart_changed {
        use tauri_plugin_autostart::ManagerExt;
        let m = app.autolaunch();
        let _ = if s.autostart { m.enable() } else { m.disable() };
    }
    Ok(s)
}

#[tauri::command(async)]
pub fn reset_settings(state: State<AppState>) -> AppResult<Settings> {
    // คง PIN เดิมไว้ — รีเซ็ตการตั้งค่าไม่ควรเป็นทางปลดล็อก
    let s = Settings {
        onboarded: true,
        pin_hash: state.settings.lock().unwrap().pin_hash.clone(),
        ..Settings::default()
    };
    s.save(&state.settings_path)?;
    *state.settings.lock().unwrap() = s.clone();
    Ok(s)
}

/// สำรองการตั้งค่า + ข้อมูล key-value ทั้งหมดเป็นไฟล์ JSON
#[tauri::command(async)]
pub fn backup_settings(state: State<AppState>, path: String) -> AppResult<()> {
    let mut settings = state.settings.lock().unwrap().clone();
    // ไม่ใส่ hash ของ PIN ลงไฟล์สำรอง (ไฟล์อาจถูกส่งต่อ/เก็บไว้ที่อื่น)
    settings.pin_hash.clear();
    let db = state.db.lock().unwrap();
    let mut st = db.conn.prepare("SELECT key, value FROM kv")?;
    let kv: serde_json::Map<String, serde_json::Value> = st
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        .filter_map(Result::ok)
        .map(|(k, v)| (k, serde_json::Value::String(v)))
        .collect();
    let out = serde_json::json!({
        "app": "MediaToolbox",
        "version": env!("CARGO_PKG_VERSION"),
        "createdAt": chrono::Local::now().to_rfc3339(),
        "settings": settings,
        "kv": kv,
    });
    std::fs::write(path, serde_json::to_string_pretty(&out)?)?;
    Ok(())
}

#[tauri::command(async)]
pub fn restore_settings(state: State<AppState>, path: String) -> AppResult<Settings> {
    let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(path)?)?;
    if v.get("app").and_then(|a| a.as_str()) != Some("MediaToolbox") {
        return msg("ไฟล์นี้ไม่ใช่ไฟล์สำรองของมีเดียทูลบ็อกซ์");
    }
    let mut s: Settings = serde_json::from_value(v["settings"].clone())?;
    // PIN เปลี่ยนได้เฉพาะผ่าน set_pin — กู้คืนไฟล์สำรองต้องไม่ลบ/เปลี่ยน PIN
    s.pin_hash = state.settings.lock().unwrap().pin_hash.clone();
    s.concurrent_jobs = s.concurrent_jobs.clamp(1, 16);
    s.save(&state.settings_path)?;
    *state.settings.lock().unwrap() = s.clone();
    if let Some(kv) = v.get("kv").and_then(|k| k.as_object()) {
        let db = state.db.lock().unwrap();
        for (k, val) in kv {
            db.kv_set(k, val.as_str().unwrap_or_default())?;
        }
    }
    Ok(s)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolInfo {
    name: String,
    path: Option<String>,
    version: Option<String>,
}

fn version_of(path: &std::path::PathBuf, arg: &str) -> Option<String> {
    let out = binaries::std_command(path).arg(arg).output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout).to_string();
    text.lines().next().map(|l| l.trim().to_string())
}

#[tauri::command]
pub async fn tool_status(app: AppHandle) -> Vec<ToolInfo> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        ["ffmpeg", "ffprobe", "yt-dlp"]
            .iter()
            .map(|n| {
                let p = state.tool(n).ok();
                let arg = if *n == "yt-dlp" { "--version" } else { "-version" };
                ToolInfo {
                    name: n.to_string(),
                    version: p.as_ref().and_then(|p| version_of(p, arg)),
                    path: p.map(|p| p.to_string_lossy().to_string()),
                }
            })
            .collect()
    })
    .await
    .unwrap_or_default()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: String,
    data_dir: String,
    download_dir: String,
    args: Vec<String>,
}

#[tauri::command(async)]
pub fn app_info(state: State<AppState>) -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION").into(),
        data_dir: state.data_dir.to_string_lossy().to_string(),
        download_dir: state.settings.lock().unwrap().download_dir.clone(),
        args: std::env::args().skip(1).collect(),
    }
}

#[tauri::command(async)]
pub fn kv_get(state: State<AppState>, key: String) -> AppResult<Option<String>> {
    state.db.lock().unwrap().kv_get(&key)
}

#[tauri::command(async)]
pub fn kv_set(state: State<AppState>, key: String, value: String) -> AppResult<()> {
    state.db.lock().unwrap().kv_set(&key, &value)
}
