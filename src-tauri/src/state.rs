//! สถานะกลางของโปรแกรม (แชร์ระหว่างทุก command)
use crate::core::{binaries, db::Db, jobs::JobManager, server::MediaServer, settings::Settings};
use crate::error::{AppError, AppResult};
use std::path::PathBuf;
use std::sync::Mutex;

pub struct AppState {
    pub settings: Mutex<Settings>,
    pub settings_path: PathBuf,
    pub data_dir: PathBuf,
    pub resource_dir: Option<PathBuf>,
    pub db: Mutex<Db>,
    pub jobs: JobManager,
    pub server: Mutex<Option<MediaServer>>,
    pub ftp: Mutex<Option<crate::core::ftp::FtpServer>>,
    pub sys: Mutex<sysinfo::System>,
    pub nets: Mutex<sysinfo::Networks>,
}

impl AppState {
    pub fn new(data_dir: PathBuf, resource_dir: Option<PathBuf>) -> AppResult<Self> {
        std::fs::create_dir_all(&data_dir)?;
        let settings_path = data_dir.join("settings.json");
        let settings = Settings::load(&settings_path);
        let _ = std::fs::create_dir_all(&settings.download_dir);
        let db = Db::open(&data_dir.join("mediatoolbox.db"))?;
        Ok(Self {
            settings: Mutex::new(settings),
            settings_path,
            data_dir,
            resource_dir,
            db: Mutex::new(db),
            jobs: JobManager::default(),
            server: Mutex::new(None),
            ftp: Mutex::new(None),
            sys: Mutex::new(sysinfo::System::new()),
            nets: Mutex::new(sysinfo::Networks::new_with_refreshed_list()),
        })
    }

    /// หาพาธของเครื่องมือภายนอก (ffmpeg, ffprobe, yt-dlp)
    pub fn tool(&self, name: &str) -> AppResult<PathBuf> {
        let s = self.settings.lock().unwrap();
        let custom = match name {
            "ffmpeg" => s.ffmpeg_path.clone(),
            "yt-dlp" => s.ytdlp_path.clone(),
            "ffprobe" => {
                // ถ้าตั้งพาธ ffmpeg เอง ให้หา ffprobe ในโฟลเดอร์เดียวกัน
                let p = PathBuf::from(&s.ffmpeg_path);
                p.parent()
                    .map(|d| d.join(format!("ffprobe{}", std::env::consts::EXE_SUFFIX)))
                    .filter(|p| p.is_file())
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_default()
            }
            _ => String::new(),
        };
        drop(s);
        binaries::resolve(name, &custom, self.resource_dir.as_ref())
            .ok_or_else(|| AppError::MissingTool(name.to_string()))
    }

    pub fn log(&self, level: &str, source: &str, message: &str) {
        self.db.lock().unwrap().log(level, source, message);
    }
}
