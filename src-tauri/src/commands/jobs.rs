//! คำสั่งจัดการคิวงาน + โหลดคลิป + ffmpeg
use crate::core::binaries;
use crate::core::jobs::{Job, JobSpec, NewJob};
use crate::error::{msg, AppError, AppResult};
use crate::state::AppState;
use serde::Deserialize;
use std::time::Duration;
use tauri::{AppHandle, Manager, State};

#[tauri::command(async)]
pub fn list_jobs(state: State<AppState>) -> Vec<Job> {
    state.jobs.list()
}

#[tauri::command(async)]
pub fn job_action(app: AppHandle, state: State<AppState>, id: String, action: String) -> AppResult<()> {
    let j = &state.jobs;
    match action.as_str() {
        "pause" => j.pause(&app, &id),
        "resume" => j.resume(&app, &id),
        "cancel" => j.cancel(&app, &id),
        "stop" => j.stop(&id),
        "retry" => j.retry(&app, &id),
        "remove" => j.remove(&app, &id),
        "up" => j.reorder(&app, &id, -1),
        "down" => j.reorder(&app, &id, 1),
        "clear" => j.clear_finished(&app),
        _ => return msg(format!("ไม่รู้จักคำสั่ง {action}")),
    }
    Ok(())
}

#[tauri::command(async)]
pub fn add_job(app: AppHandle, state: State<AppState>, job: NewJob) -> Job {
    state.jobs.add(&app, job)
}

#[derive(Debug, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct DownloadOptions {
    pub urls: Vec<String>,
    /// video | audio | subs | thumbnail
    pub mode: String,
    /// best | 4320 | 2160 | 1440 | 1080 | 720 | 480 | 360 | 240 | 144
    pub quality: String,
    pub format: String,
    pub subtitles: bool,
    pub sub_langs: String,
    pub thumbnail: bool,
    pub metadata: bool,
    pub playlist: bool,
    pub live_from_start: bool,
    pub start_at: Option<String>,
    pub output_dir: String,
    pub template: String,
    pub extra_args: Vec<String>,
}

/// สร้างอาร์กิวเมนต์ yt-dlp จากตัวเลือกในหน้าจอ
pub fn build_download_args(o: &DownloadOptions, s: &crate::core::settings::Settings) -> Vec<String> {
    let mut a: Vec<String> = Vec::new();
    let mut push = |xs: &[&str]| a.extend(xs.iter().map(|x| x.to_string()));
    let fmt = if o.format.is_empty() { "mp4" } else { o.format.as_str() };
    match o.mode.as_str() {
        "audio" => push(&["-x", "--audio-format", fmt, "--audio-quality", "0"]),
        "subs" => push(&["--skip-download", "--write-subs", "--write-auto-subs", "--convert-subs", "srt"]),
        "thumbnail" => push(&["--skip-download", "--write-thumbnail", "--convert-thumbnails", "jpg"]),
        _ => {
            let h = o.quality.parse::<u32>().ok();
            let sel = match h {
                Some(h) => format!("bv*[height<={h}]+ba/b[height<={h}]/bv*+ba/b"),
                None => "bv*+ba/b".to_string(),
            };
            push(&["-f", &sel]);
            // ความละเอียดมาก่อน แล้วค่อยเลือก h264/m4a ที่เข้ากับ mp4 (ถ้าเอา codec ขึ้นก่อน YouTube จะได้แค่ 1080p)
            if fmt == "mp4" {
                push(&["-S", "res,vcodec:h264,acodec:m4a"]);
            }
            push(&["--merge-output-format", fmt]);
        }
    }
    let langs = if o.sub_langs.trim().is_empty() { "th,en" } else { o.sub_langs.trim() };
    if o.mode == "subs" || o.subtitles {
        a.extend(["--sub-langs".to_string(), langs.to_string()]);
        if o.subtitles && o.mode == "video" {
            a.extend(["--write-subs".into(), "--write-auto-subs".into(), "--embed-subs".into()]);
        }
    }
    if o.thumbnail && o.mode != "thumbnail" {
        a.extend(["--write-thumbnail".into(), "--embed-thumbnail".into()]);
    }
    if o.metadata {
        // ฝังข้อมูลลงไฟล์พอ ไม่เขียน .info.json ทิ้งไว้ข้างคลิป (รกโฟลเดอร์)
        a.push("--embed-metadata".into());
    }
    a.push(if o.playlist { "--yes-playlist".into() } else { "--no-playlist".into() });
    if o.live_from_start {
        a.push("--live-from-start".into());
    }
    let tpl = if o.template.trim().is_empty() {
        if o.playlist {
            "%(playlist_title|เพลย์ลิสต์)s/%(playlist_index|0)03d - %(title).120B.%(ext)s"
        } else {
            "%(title).150B [%(id)s].%(ext)s"
        }
    } else {
        o.template.trim()
    };
    a.extend(["-o".into(), tpl.to_string(), "--no-mtime".into(), "--windows-filenames".into()]);
    if !s.proxy.trim().is_empty() {
        a.extend(["--proxy".into(), s.proxy.trim().to_string()]);
    }
    if !s.rate_limit.trim().is_empty() {
        a.extend(["-r".into(), s.rate_limit.trim().to_string()]);
    }
    if !s.cookies_file.trim().is_empty() {
        a.extend(["--cookies".into(), s.cookies_file.trim().to_string()]);
    } else if !s.cookies_browser.trim().is_empty() {
        a.extend(["--cookies-from-browser".into(), s.cookies_browser.trim().to_string()]);
    }
    a.extend(o.extra_args.iter().cloned());
    a
}

/// ตัด `--cookies-from-browser <ชื่อ>` ออก (ใช้ตอนเบราว์เซอร์ล็อกไฟล์คุกกี้ไว้)
pub fn strip_browser_cookies(args: &[String]) -> Vec<String> {
    let mut out = Vec::with_capacity(args.len());
    let mut skip = false;
    for a in args {
        if skip {
            skip = false;
            continue;
        }
        if a == "--cookies-from-browser" {
            skip = true;
            continue;
        }
        out.push(a.clone());
    }
    out
}

/// JS runtime ให้ yt-dlp (YouTube ต้องใช้ ไม่งั้นบางความละเอียดจะหาย) — ใช้ deno ถ้ามี ไม่งั้นใช้ node
pub fn js_runtime_args(state: &AppState) -> Vec<String> {
    for name in ["deno", "node"] {
        if let Some(p) = binaries::resolve(name, "", state.resource_dir.as_ref()) {
            return vec!["--js-runtimes".into(), format!("{name}:{}", p.to_string_lossy())];
        }
    }
    Vec::new()
}

pub fn platform_of(url: &str) -> &'static str {
    let u = url.to_lowercase();
    let table = [
        ("youtu", "YouTube"),
        ("facebook.", "Facebook"),
        ("fb.watch", "Facebook"),
        ("instagram.", "Instagram"),
        ("tiktok.", "TikTok"),
        ("twitter.", "X"),
        ("x.com", "X"),
        ("reddit.", "Reddit"),
        ("pinterest.", "Pinterest"),
        ("pin.it", "Pinterest"),
        ("vimeo.", "Vimeo"),
        ("dailymotion.", "Dailymotion"),
        ("bilibili.", "Bilibili"),
        ("twitch.", "Twitch"),
        ("soundcloud.", "SoundCloud"),
    ];
    table.iter().find(|(k, _)| u.contains(k)).map(|(_, v)| *v).unwrap_or("เว็บอื่น")
}

#[tauri::command(async)]
pub fn start_download(app: AppHandle, state: State<AppState>, options: DownloadOptions) -> AppResult<Vec<Job>> {
    let s = state.settings.lock().unwrap().clone();
    let args = build_download_args(&options, &s);
    let out = if options.output_dir.trim().is_empty() { s.download_dir.clone() } else { options.output_dir.clone() };
    let urls: Vec<String> = options
        .urls
        .iter()
        .map(|u| u.trim().to_string())
        .filter(|u| u.starts_with("http://") || u.starts_with("https://"))
        .collect();
    if urls.is_empty() {
        return msg("ไม่พบลิงก์ที่ถูกต้อง (ต้องขึ้นต้นด้วย http:// หรือ https://)");
    }
    Ok(urls
        .into_iter()
        .map(|url| {
            state.jobs.add(
                &app,
                NewJob {
                    kind: "download".into(),
                    title: format!("[{}] {}", platform_of(&url), url),
                    input: url.clone(),
                    output: out.clone(),
                    start_at: options.start_at.clone(),
                    spec: JobSpec::Download { url, args: args.clone() },
                },
            )
        })
        .collect())
}

/// ดึงข้อมูลคลิป (ชื่อ, ภาพปก, ความยาว, จำนวนในเพลย์ลิสต์) โดยไม่โหลด
#[tauri::command]
pub async fn fetch_info(app: AppHandle, url: String) -> AppResult<serde_json::Value> {
    let state = app.state::<AppState>();
    let bin = state.tool("yt-dlp")?;
    let s = state.settings.lock().unwrap().clone();
    let js = js_runtime_args(&state);
    let run = |browser_cookies: bool| {
        let mut cmd = binaries::command(&bin);
        cmd.env("PYTHONIOENCODING", "utf-8")
            .args(["-J", "--flat-playlist", "--no-warnings", "--encoding", "utf-8"])
            .args(&js);
        if !s.cookies_file.trim().is_empty() {
            cmd.args(["--cookies", s.cookies_file.trim()]);
        } else if browser_cookies && !s.cookies_browser.trim().is_empty() {
            cmd.args(["--cookies-from-browser", s.cookies_browser.trim()]);
        }
        if !s.proxy.trim().is_empty() {
            cmd.args(["--proxy", s.proxy.trim()]);
        }
        cmd.arg("--").arg(&url);
        async move {
            tokio::time::timeout(Duration::from_secs(90), cmd.output())
                .await
                .map_err(|_| AppError::Msg("ใช้เวลานานเกินไป — ลองใหม่อีกครั้ง".into()))?
                .map_err(AppError::from)
        }
    };
    let mut out = run(true).await?;
    let stderr_lines = |o: &std::process::Output| -> Vec<String> {
        String::from_utf8_lossy(&o.stderr).lines().map(String::from).collect()
    };
    if !out.status.success() && crate::core::jobs::is_cookie_error(&stderr_lines(&out)) {
        // เบราว์เซอร์เปิดอยู่/เข้ารหัสคุกกี้ — ลองใหม่แบบไม่ใช้คุกกี้
        state.log("warn", "download", "อ่านคุกกี้จากเบราว์เซอร์ไม่ได้ — ดึงข้อมูลแบบไม่ใช้คุกกี้แทน");
        out = run(false).await?;
    }
    if !out.status.success() {
        return msg(crate::core::jobs::explain_ytdlp_error(&stderr_lines(&out)));
    }
    let v: serde_json::Value = serde_json::from_slice(&out.stdout)?;
    let mut heights: Vec<i64> = v["formats"]
        .as_array()
        .map(|f| f.iter().filter_map(|x| x["height"].as_i64()).collect())
        .unwrap_or_default();
    heights.sort();
    heights.dedup();
    let subs: Vec<String> = v["subtitles"].as_object().map(|m| m.keys().cloned().collect()).unwrap_or_default();
    Ok(serde_json::json!({
        "title": v["title"],
        "uploader": v["uploader"].as_str().or(v["channel"].as_str()),
        "thumbnail": v["thumbnail"].as_str().map(String::from).or_else(|| v["thumbnails"].as_array().and_then(|t| t.last()).and_then(|t| t["url"].as_str()).map(String::from)),
        "duration": v["duration"],
        "description": v["description"],
        "tags": v["tags"],
        "viewCount": v["view_count"],
        "likeCount": v["like_count"],
        "isLive": v["is_live"],
        "type": v["_type"],
        "entries": v["entries"].as_array().map(|e| e.len()),
        "heights": heights,
        "subtitles": subs,
        "platform": platform_of(&url),
        "webpage": v["webpage_url"],
        "thumbnails": v["thumbnails"].as_array().map(|t| t.iter().filter_map(|x| Some(serde_json::json!({ "id": x["id"], "url": x["url"].as_str()?, "width": x["width"] }))).collect::<Vec<_>>()),
    }))
}

#[tauri::command]
pub async fn update_ytdlp(app: AppHandle) -> AppResult<String> {
    let bin = app.state::<AppState>().tool("yt-dlp")?;
    let out = binaries::command(&bin).arg("-U").output().await?;
    let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    Ok(text.trim().to_string())
}

async fn probe_duration(app: &AppHandle, path: &str) -> f64 {
    let Ok(bin) = app.state::<AppState>().tool("ffprobe") else { return 0.0 };
    let out = binaries::command(&bin)
        .args(["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1"])
        .arg(path)
        .output()
        .await;
    out.ok()
        .and_then(|o| String::from_utf8_lossy(&o.stdout).trim().parse::<f64>().ok())
        .unwrap_or(0.0)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegJobReq {
    pub kind: String,
    pub title: String,
    pub input: String,
    pub output: String,
    pub passes: Vec<Vec<String>>,
    #[serde(default)]
    pub duration: f64,
    #[serde(default)]
    pub graceful_stop: bool,
    #[serde(default)]
    pub start_at: Option<String>,
}

/// เพิ่มงาน ffmpeg เข้าคิว (หาความยาวไฟล์ให้อัตโนมัติเพื่อแสดง %)
#[tauri::command]
pub async fn ffmpeg_job(app: AppHandle, req: FfmpegJobReq) -> AppResult<Job> {
    if req.passes.is_empty() {
        return msg("ไม่มีคำสั่งให้ทำงาน");
    }
    ensure_parent(&req.output);
    let mut duration = req.duration;
    if duration <= 0.0 && std::path::Path::new(&req.input).is_file() {
        duration = probe_duration(&app, &req.input).await;
    }
    let state = app.state::<AppState>();
    Ok(state.jobs.add(
        &app,
        NewJob {
            kind: req.kind,
            title: req.title,
            input: req.input,
            output: req.output,
            start_at: req.start_at,
            spec: JobSpec::Ffmpeg { passes: req.passes, duration, graceful_stop: req.graceful_stop },
        },
    ))
}

/// สร้างโฟลเดอร์ปลายทางให้ก่อน (ffmpeg ไม่สร้างเอง)
fn ensure_parent(path: &str) {
    if path.is_empty() || path.eq_ignore_ascii_case("NUL") || !(path.contains('\\') || path.contains('/')) {
        return;
    }
    if let Some(d) = std::path::Path::new(path).parent() {
        let _ = std::fs::create_dir_all(d);
    }
}

/// รายชื่อกล้อง/ไมค์ (DirectShow) สำหรับอัดหน้าจอ
#[tauri::command]
pub async fn list_devices(app: AppHandle) -> AppResult<String> {
    let bin = app.state::<AppState>().tool("ffmpeg")?;
    let out = binaries::command(&bin).args(["-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"]).output().await?;
    Ok(String::from_utf8_lossy(&out.stderr).to_string())
}

/// รัน ffmpeg ทันทีแบบรอผล (งานสั้น ๆ เช่น ดึงเฟรม, ภาพย่อ, คลื่นเสียง)
#[tauri::command]
pub async fn ffmpeg_exec(app: AppHandle, args: Vec<String>) -> AppResult<String> {
    let bin = app.state::<AppState>().tool("ffmpeg")?;
    if let Some(last) = args.last() {
        ensure_parent(last);
    }
    let out = tokio::time::timeout(
        Duration::from_secs(300),
        binaries::command(&bin).args(["-hide_banner", "-y"]).args(&args).output(),
    )
    .await
    .map_err(|_| AppError::Msg("ffmpeg ใช้เวลานานเกินไป".into()))??;
    let err = String::from_utf8_lossy(&out.stderr).to_string();
    if !out.status.success() {
        let tail: Vec<&str> = err.lines().rev().take(3).collect();
        return msg(format!("ประมวลผลไม่สำเร็จ: {}", tail.into_iter().rev().collect::<Vec<_>>().join(" | ")));
    }
    Ok(err)
}

/// อ่านข้อมูลไฟล์มีเดีย (ความยาว, ความละเอียด, codec, bitrate, แทร็กเสียง/ซับ)
#[tauri::command]
pub async fn probe_media(app: AppHandle, path: String) -> AppResult<serde_json::Value> {
    let bin = app.state::<AppState>().tool("ffprobe")?;
    let out = binaries::command(&bin)
        .args(["-v", "error", "-print_format", "json", "-show_format", "-show_streams", "-show_chapters"])
        .arg(&path)
        .output()
        .await?;
    if !out.status.success() {
        return msg("อ่านข้อมูลไฟล์ไม่ได้ — ไฟล์อาจเสียหรือไม่ใช่ไฟล์มีเดีย");
    }
    Ok(serde_json::from_slice(&out.stdout)?)
}

/// สร้างภาพย่อ (cache ไว้ในโฟลเดอร์ข้อมูลโปรแกรม)
#[tauri::command]
pub async fn make_thumbnail(app: AppHandle, path: String) -> AppResult<String> {
    use sha2::{Digest, Sha256};
    let state = app.state::<AppState>();
    let dir = state.data_dir.join("thumbs");
    std::fs::create_dir_all(&dir)?;
    let modified = std::fs::metadata(&path)?.modified().ok().map(|t| format!("{t:?}")).unwrap_or_default();
    let key = hex::encode(Sha256::digest(format!("{path}|{modified}").as_bytes()));
    let dst = dir.join(format!("{}.jpg", &key[..24]));
    if dst.is_file() {
        return Ok(dst.to_string_lossy().to_string());
    }
    // จำกัดสร้างภาพย่อพร้อมกันไม่เกิน 3 — กันเปิด ffmpeg หลายสิบตัวตอนสลับหน้าเร็ว ๆ จนเครื่องค้าง
    static THUMB_SLOTS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(3);
    let _slot = THUMB_SLOTS.acquire().await.map_err(|e| AppError::Msg(e.to_string()))?;
    if dst.is_file() {
        return Ok(dst.to_string_lossy().to_string());
    }
    let bin = state.tool("ffmpeg")?;
    let lower = path.to_lowercase();
    let is_image = [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".tif", ".tiff", ".avif", ".heic"]
        .iter()
        .any(|e| lower.ends_with(e));
    let mut cmd = binaries::command(&bin);
    cmd.args(["-hide_banner", "-y"]);
    if !is_image {
        cmd.args(["-ss", "3"]);
    }
    cmd.arg("-i").arg(&path).args(["-frames:v", "1", "-vf", "scale=360:-2", "-q:v", "5"]).arg(&dst);
    let out = tokio::time::timeout(Duration::from_secs(30), cmd.output())
        .await
        .map_err(|_| AppError::Msg("สร้างภาพย่อไม่ทัน".into()))??;
    if !out.status.success() || !dst.is_file() {
        // คลิปสั้นกว่า 3 วินาที — ลองเฟรมแรก
        let out2 = binaries::command(&bin)
            .args(["-hide_banner", "-y", "-i"])
            .arg(&path)
            .args(["-frames:v", "1", "-vf", "scale=360:-2"])
            .arg(&dst)
            .output()
            .await?;
        if !out2.status.success() {
            return msg("สร้างภาพย่อไม่ได้");
        }
    }
    Ok(dst.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn args_video() {
        let o = DownloadOptions { mode: "video".into(), quality: "1080".into(), format: "mp4".into(), subtitles: true, ..Default::default() };
        let s = crate::core::settings::Settings { proxy: "http://p:1".into(), cookies_browser: "chrome".into(), ..Default::default() };
        let a = build_download_args(&o, &s);
        assert!(a.contains(&"bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/b".to_string()));
        assert!(a.contains(&"--embed-subs".to_string()));
        assert!(a.contains(&"--cookies-from-browser".to_string()));
        assert!(a.contains(&"--no-playlist".to_string()));
    }

    #[test]
    fn args_audio() {
        let o = DownloadOptions { mode: "audio".into(), format: "mp3".into(), playlist: true, ..Default::default() };
        let a = build_download_args(&o, &Default::default());
        assert_eq!(&a[..3], &["-x", "--audio-format", "mp3"]);
        assert!(a.contains(&"--yes-playlist".to_string()));
    }

    #[test]
    fn platforms() {
        assert_eq!(platform_of("https://www.facebook.com/groups/123"), "Facebook");
        assert_eq!(platform_of("https://vt.tiktok.com/x"), "TikTok");
        assert_eq!(platform_of("https://youtu.be/abc"), "YouTube");
        assert_eq!(platform_of("https://example.com"), "เว็บอื่น");
    }
}
