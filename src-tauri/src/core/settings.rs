//! การตั้งค่าโปรแกรม — เก็บเป็นไฟล์ JSON ใน AppData
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub download_dir: String,
    pub concurrent_jobs: usize,
    pub ffmpeg_path: String,
    pub ytdlp_path: String,
    pub proxy: String,
    pub rate_limit: String,
    pub cookies_browser: String,
    pub cookies_file: String,
    pub theme: String,
    pub accent: String,
    pub language: String,
    pub sound: bool,
    pub notify: bool,
    pub auto_update: bool,
    pub autostart: bool,
    pub minimize_to_tray: bool,
    pub buddhist_era: bool,
    /// hash ของ PIN (pbkdf2) — ว่าง = ไม่ใช้ PIN
    pub pin_hash: String,
    pub auto_lock_minutes: u32,
    pub display_name: String,
    pub avatar: String,
    pub notify_sound: String,
    pub shortcuts: serde_json::Value,
    pub widgets: Vec<String>,
    pub custom_theme: serde_json::Value,
    pub webhook_url: String,
    pub onboarded: bool,
    /// เอฟเฟกต์เต็ม (กระจกฝ้า + อนุภาค) — ปิด = โหมดประหยัดเครื่อง (ค่าเริ่มต้น)
    pub full_effects: bool,
}

pub fn default_download_dir() -> String {
    // ค่าเริ่มต้นสำหรับคนไทย: Documents/MediaToolbox
    let base = dirs::document_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("MediaToolbox").to_string_lossy().to_string()
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            download_dir: default_download_dir(),
            concurrent_jobs: 3,
            ffmpeg_path: String::new(),
            ytdlp_path: String::new(),
            proxy: String::new(),
            rate_limit: String::new(),
            cookies_browser: String::new(),
            cookies_file: String::new(),
            theme: "dark".into(),
            accent: "#a855f7".into(),
            language: "th".into(),
            sound: true,
            notify: true,
            auto_update: false,
            autostart: false,
            minimize_to_tray: false,
            buddhist_era: true,
            pin_hash: String::new(),
            auto_lock_minutes: 0,
            display_name: "ผู้ใช้".into(),
            avatar: String::new(),
            notify_sound: "ding".into(),
            shortcuts: serde_json::json!({}),
            widgets: ["stats", "quick", "activity", "system", "recent", "storage"]
                .iter()
                .map(|s| s.to_string())
                .collect(),
            custom_theme: serde_json::json!({}),
            webhook_url: String::new(),
            onboarded: false,
            full_effects: false,
        }
    }
}

impl Settings {
    pub fn load(path: &PathBuf) -> Self {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &PathBuf) -> std::io::Result<()> {
        if let Some(p) = path.parent() {
            std::fs::create_dir_all(p)?;
        }
        std::fs::write(path, serde_json::to_string_pretty(self).unwrap_or_default())
    }
}
