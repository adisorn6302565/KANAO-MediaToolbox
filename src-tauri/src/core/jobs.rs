//! ระบบคิวงาน — รัน yt-dlp / ffmpeg เป็น process ลูก, อ่านความคืบหน้า แล้วส่ง event ให้หน้าบ้าน
//!
//! event ที่ส่ง: `job-update` (payload = Job) ทุกครั้งที่สถานะหรือความคืบหน้าเปลี่ยน
use crate::core::binaries;
use crate::core::db::HistoryItem;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::Notify;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum JobSpec {
    /// โหลดด้วย yt-dlp — args คืออาร์กิวเมนต์ทั้งหมดยกเว้น URL
    #[serde(rename_all = "camelCase")]
    Download { url: String, args: Vec<String> },
    /// รัน ffmpeg หนึ่งรอบหรือหลายรอบ (two-pass) — duration ใช้คำนวณ %
    #[serde(rename_all = "camelCase")]
    Ffmpeg {
        passes: Vec<Vec<String>>,
        duration: f64,
        /// งานอัด (หน้าจอ/ไลฟ์) — กดหยุดจะส่ง q ให้ ffmpeg ปิดไฟล์อย่างถูกต้อง
        #[serde(default)]
        graceful_stop: bool,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    pub kind: String,
    pub title: String,
    /// queued | running | paused | done | failed | cancelled
    pub status: String,
    pub progress: f64,
    pub speed: String,
    pub eta: String,
    pub message: String,
    pub input: String,
    pub output: String,
    pub size_before: i64,
    pub size_after: i64,
    pub created_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    /// เวลาเริ่มงาน (RFC3339) — ใช้ตั้งเวลาโหลด
    pub start_at: Option<String>,
    pub priority: i64,
    pub spec: JobSpec,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewJob {
    pub kind: String,
    pub title: String,
    pub input: String,
    pub output: String,
    pub start_at: Option<String>,
    pub spec: JobSpec,
}

struct Control {
    kill: Arc<Notify>,
    reason: Arc<Mutex<String>>,
}

#[derive(Default)]
pub struct JobManager {
    jobs: Mutex<HashMap<String, Job>>,
    controls: Mutex<HashMap<String, Control>>,
    counter: Mutex<i64>,
}

fn now() -> String {
    chrono::Local::now().to_rfc3339()
}

fn file_size(p: &str) -> i64 {
    std::fs::metadata(p).map(|m| m.len() as i64).unwrap_or(0)
}

impl JobManager {
    pub fn add(&self, app: &AppHandle, n: NewJob) -> Job {
        let mut c = self.counter.lock().unwrap();
        *c += 1;
        let job = Job {
            id: uuid::Uuid::new_v4().to_string(),
            kind: n.kind,
            title: n.title,
            status: "queued".into(),
            progress: 0.0,
            speed: String::new(),
            eta: String::new(),
            message: String::new(),
            size_before: file_size(&n.input),
            input: n.input,
            output: n.output,
            size_after: 0,
            created_at: now(),
            started_at: None,
            finished_at: None,
            start_at: n.start_at.filter(|s| !s.is_empty()),
            priority: *c,
            spec: n.spec,
        };
        self.jobs.lock().unwrap().insert(job.id.clone(), job.clone());
        let _ = app.emit("job-update", &job);
        job
    }

    pub fn list(&self) -> Vec<Job> {
        let mut v: Vec<Job> = self.jobs.lock().unwrap().values().cloned().collect();
        v.sort_by_key(|j| j.priority);
        v
    }

    fn update<F: FnOnce(&mut Job)>(&self, app: &AppHandle, id: &str, f: F) -> Option<Job> {
        let mut jobs = self.jobs.lock().unwrap();
        let j = jobs.get_mut(id)?;
        f(j);
        let out = j.clone();
        drop(jobs);
        let _ = app.emit("job-update", &out);
        Some(out)
    }

    /// หยุด process ที่รันอยู่ พร้อมเหตุผล (paused / cancelled / stopped)
    fn signal(&self, id: &str, reason: &str) -> bool {
        if let Some(c) = self.controls.lock().unwrap().get(id) {
            *c.reason.lock().unwrap() = reason.to_string();
            c.kill.notify_one();
            return true;
        }
        false
    }

    pub fn pause(&self, app: &AppHandle, id: &str) {
        if self.signal(id, "paused") {
            self.update(app, id, |j| j.message = "กำลังหยุดชั่วคราว...".into());
        } else {
            self.update(app, id, |j| {
                if j.status == "queued" {
                    j.status = "paused".into()
                }
            });
        }
    }

    pub fn resume(&self, app: &AppHandle, id: &str) {
        self.update(app, id, |j| {
            if j.status == "paused" {
                j.status = "queued".into();
                j.message.clear();
            }
        });
    }

    pub fn cancel(&self, app: &AppHandle, id: &str) {
        if self.signal(id, "cancelled") {
            self.update(app, id, |j| j.message = "กำลังยกเลิก...".into());
        } else {
            self.update(app, id, |j| {
                if j.status == "queued" || j.status == "paused" {
                    j.status = "cancelled".into()
                }
            });
        }
    }

    /// หยุดงานอัดแบบปกติ (ไฟล์ยังใช้ได้)
    pub fn stop(&self, id: &str) {
        self.signal(id, "stopped");
    }

    pub fn retry(&self, app: &AppHandle, id: &str) {
        self.update(app, id, |j| {
            if matches!(j.status.as_str(), "failed" | "cancelled" | "paused") {
                j.status = "queued".into();
                j.progress = 0.0;
                j.message.clear();
            }
        });
    }

    pub fn remove(&self, app: &AppHandle, id: &str) {
        self.cancel(app, id);
        self.jobs.lock().unwrap().remove(id);
        let _ = app.emit("job-removed", id);
    }

    pub fn clear_finished(&self, app: &AppHandle) {
        self.jobs
            .lock()
            .unwrap()
            .retain(|_, j| !matches!(j.status.as_str(), "done" | "failed" | "cancelled"));
        let _ = app.emit("job-removed", "*");
    }

    /// เลื่อนลำดับงาน (delta -1 = ขึ้น, +1 = ลง)
    pub fn reorder(&self, app: &AppHandle, id: &str, delta: i64) {
        let mut list = self.list();
        let Some(pos) = list.iter().position(|j| j.id == id) else { return };
        let target = (pos as i64 + delta).clamp(0, list.len() as i64 - 1) as usize;
        let j = list.remove(pos);
        list.insert(target, j);
        let mut jobs = self.jobs.lock().unwrap();
        for (i, j) in list.iter().enumerate() {
            if let Some(x) = jobs.get_mut(&j.id) {
                x.priority = i as i64;
            }
        }
        drop(jobs);
        let _ = app.emit("job-removed", "*");
    }

    /// เลือกงานถัดไปที่พร้อมรัน
    fn next_ready(&self, limit: usize) -> Option<Job> {
        let jobs = self.jobs.lock().unwrap();
        let running = jobs.values().filter(|j| j.status == "running").count();
        if running >= limit {
            return None;
        }
        let now = chrono::Local::now();
        jobs.values()
            .filter(|j| j.status == "queued")
            .filter(|j| match &j.start_at {
                Some(s) => chrono::DateTime::parse_from_rfc3339(s)
                    .map(|t| t <= now)
                    .unwrap_or(true),
                None => true,
            })
            .min_by_key(|j| j.priority)
            .cloned()
    }
}

/// ลูปหลักของคิว — ทำงานตลอดอายุโปรแกรม (แม้หน้าต่างถูกซ่อน)
pub fn start_scheduler(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(400)).await;
            let state = app.state::<AppState>();
            let limit = state.settings.lock().unwrap().concurrent_jobs.max(1);
            while let Some(job) = state.jobs.next_ready(limit) {
                // ลงทะเบียนตัวควบคุมก่อนเปลี่ยนเป็น running — กดหยุด/ยกเลิกทันทีหลังเริ่มจะได้ไม่หาย
                let kill = Arc::new(Notify::new());
                let reason = Arc::new(Mutex::new(String::new()));
                state.jobs.controls.lock().unwrap().insert(
                    job.id.clone(),
                    Control { kill: kill.clone(), reason: reason.clone() },
                );
                state.jobs.update(&app, &job.id, |j| {
                    j.status = "running".into();
                    j.started_at = Some(now());
                    j.message = "กำลังเริ่ม...".into();
                });
                let app2 = app.clone();
                tauri::async_runtime::spawn(async move { run_job(app2, job, kill, reason).await });
            }
        }
    });
}

async fn run_job(app: AppHandle, job: Job, kill: Arc<Notify>, reason: Arc<Mutex<String>>) {
    let state = app.state::<AppState>();
    let result = match &job.spec {
        JobSpec::Download { url, args } => run_download(&app, &job, url, args, &kill).await,
        JobSpec::Ffmpeg { passes, duration, graceful_stop } => {
            run_ffmpeg(&app, &job, passes, *duration, *graceful_stop, &kill).await
        }
    };
    state.jobs.controls.lock().unwrap().remove(&job.id);
    let why = reason.lock().unwrap().clone();

    let (status, message) = match (&result, why.as_str()) {
        (_, "paused") => ("paused", "หยุดชั่วคราว".to_string()),
        (_, "cancelled") => ("cancelled", "ยกเลิกแล้ว".to_string()),
        (Ok(_), _) | (_, "stopped") => ("done", "เสร็จแล้ว ✓".to_string()),
        (Err(e), _) => ("failed", e.clone()),
    };
    let final_output = match &result {
        Ok(Some(p)) => p.clone(),
        _ => job.output.clone(),
    };
    let updated = state.jobs.update(&app, &job.id, |j| {
        j.status = status.into();
        j.message = message.clone();
        j.output = final_output.clone();
        j.speed.clear();
        j.eta.clear();
        if status == "done" {
            j.progress = 100.0;
            j.size_after = file_size(&final_output);
        }
        if status != "paused" {
            j.finished_at = Some(now());
        }
    });

    if let Some(j) = updated {
        if status == "paused" {
            return;
        }
        {
            let db = state.db.lock().unwrap();
            let _ = db.add_history(&HistoryItem {
                id: j.id.clone(),
                kind: j.kind.clone(),
                title: j.title.clone(),
                input: j.input.clone(),
                output: j.output.clone(),
                status: j.status.clone(),
                size_before: j.size_before,
                size_after: j.size_after,
                message: j.message.clone(),
                created_at: now(),
            });
            let lvl = if status == "failed" { "error" } else { "info" };
            db.log(lvl, &j.kind, &format!("{} — {}", j.title, j.message));
        }
        let _ = app.emit("history-changed", ());
        notify_done(&app, &j);
    }
}

fn notify_done(app: &AppHandle, j: &Job) {
    let state = app.state::<AppState>();
    let (notify, webhook) = {
        let s = state.settings.lock().unwrap();
        (s.notify, s.webhook_url.clone())
    };
    if notify && (j.status == "done" || j.status == "failed") {
        use tauri_plugin_notification::NotificationExt;
        let title = if j.status == "done" { "งานเสร็จแล้ว 🎉" } else { "งานไม่สำเร็จ ⚠️" };
        let _ = app
            .notification()
            .builder()
            .title(title)
            .body(&j.title)
            .show();
    }
    if !webhook.is_empty() && j.status == "done" {
        crate::commands::dev::send_webhook_blocking(&webhook, &format!("✅ {} เสร็จแล้ว", j.title));
    }
}

/// รอ process จบ หรือถูกสั่งหยุด
async fn wait_or_kill(
    child: &mut tokio::process::Child,
    kill: &Notify,
    graceful: bool,
) -> std::io::Result<Option<std::process::ExitStatus>> {
    tokio::select! {
        st = child.wait() => st.map(Some),
        _ = kill.notified() => {
            if graceful {
                if let Some(mut stdin) = child.stdin.take() {
                    let _ = stdin.write_all(b"q\n").await;
                    let _ = stdin.flush().await;
                }
                if let Ok(r) = tokio::time::timeout(Duration::from_secs(8), child.wait()).await {
                    return r.map(|_| None);
                }
            }
            if let Some(pid) = child.id() {
                tokio::task::spawn_blocking(move || binaries::kill_tree(pid)).await.ok();
            }
            let _ = child.kill().await;
            let _ = tokio::time::timeout(Duration::from_secs(3), child.wait()).await;
            Ok(None)
        }
    }
}

/// รอตัวอ่าน stdout/stderr จบ — ถ้ามี process หลานค้างถือ pipe ไว้ ไม่รอเกิน 3 วิ (งานจะได้ไม่ค้างสถานะ "กำลังทำ")
async fn drain(task: tokio::task::JoinHandle<()>) {
    let abort = task.abort_handle();
    if tokio::time::timeout(Duration::from_secs(3), task).await.is_err() {
        abort.abort();
    }
}

/// อ่านทีละบรรทัดแบบ bytes (รองรับข้อความไทย/อักขระเสีย)
async fn read_lines<R: tokio::io::AsyncRead + Unpin>(r: R, mut f: impl FnMut(String)) {
    let mut reader = BufReader::new(r);
    let mut buf = Vec::new();
    loop {
        buf.clear();
        match reader.read_until(b'\n', &mut buf).await {
            Ok(0) | Err(_) => break,
            Ok(_) => {
                let line = String::from_utf8_lossy(&buf);
                for part in line.split('\r') {
                    let t = part.trim();
                    if !t.is_empty() {
                        f(t.to_string());
                    }
                }
            }
        }
    }
}

async fn run_download(
    app: &AppHandle,
    job: &Job,
    url: &str,
    args: &[String],
    kill: &Notify,
) -> Result<Option<String>, String> {
    let state = app.state::<AppState>();
    let bin = state.tool("yt-dlp").map_err(|e| e.to_string())?;
    match run_download_once(app, job, &bin, url, args, kill).await {
        Err(errs) if is_cookie_error(&errs) && args.iter().any(|a| a == "--cookies-from-browser") => {
            // เบราว์เซอร์เปิดอยู่จนอ่านคุกกี้ไม่ได้ — โหลดต่อแบบไม่ใช้คุกกี้
            state.log("warn", "download", "อ่านคุกกี้จากเบราว์เซอร์ไม่ได้ — โหลดแบบไม่ใช้คุกกี้แทน");
            state.jobs.update(app, &job.id, |j| j.message = "อ่านคุกกี้เบราว์เซอร์ไม่ได้ — ลองโหลดแบบไม่ใช้คุกกี้...".into());
            let plain = crate::commands::jobs::strip_browser_cookies(args);
            run_download_once(app, job, &bin, url, &plain, kill)
                .await
                .map_err(|e| explain_ytdlp_error(&e))
        }
        r => r.map_err(|e| explain_ytdlp_error(&e)),
    }
}

/// รัน yt-dlp หนึ่งครั้ง — Err คือบรรทัด error ของ yt-dlp (ให้ผู้เรียกตัดสินใจลองใหม่)
async fn run_download_once(
    app: &AppHandle,
    job: &Job,
    bin: &PathBuf,
    url: &str,
    args: &[String],
    kill: &Notify,
) -> Result<Option<String>, Vec<String>> {
    let state = app.state::<AppState>();
    let ffmpeg = state.tool("ffmpeg").ok();
    let out_dir = job.output.clone();
    let _ = std::fs::create_dir_all(&out_dir);

    let mut cmd = binaries::job_command(bin);
    cmd.env("PYTHONIOENCODING", "utf-8")
        .arg("--newline")
        .arg("--progress")
        .arg("--encoding")
        .arg("utf-8")
        .arg("--no-colors")
        .args(["--progress-template", "download:MTBP|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s"])
        .args(["--print", "before_dl:MTBT|%(title)s"])
        .args(["--print", "after_move:MTBF|%(filepath)s"])
        .args(["-P", &out_dir]);
    if let Some(f) = ffmpeg {
        cmd.arg("--ffmpeg-location").arg(f);
    }
    cmd.args(crate::commands::jobs::js_runtime_args(&state));
    cmd.args(args)
        .arg("--")
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| vec![format!("เปิด yt-dlp ไม่ได้: {e}")])?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let last_file = Arc::new(Mutex::new(None::<String>));
    let errors = Arc::new(Mutex::new(Vec::<String>::new()));

    let (a, id, lf) = (app.clone(), job.id.clone(), last_file.clone());
    let out_task = tokio::spawn(async move {
        let st = a.state::<AppState>();
        let mut last_emit = Instant::now() - Duration::from_secs(1);
        read_lines(stdout, |line| {
            if let Some(rest) = line.strip_prefix("MTBP|") {
                let p: Vec<&str> = rest.split('|').collect();
                let pct = p.first().map(|s| s.trim().trim_end_matches('%').trim()).and_then(|s| s.parse::<f64>().ok());
                if last_emit.elapsed() > Duration::from_millis(250) {
                    last_emit = Instant::now();
                    st.jobs.update(&a, &id, |j| {
                        if let Some(v) = pct {
                            j.progress = v;
                        }
                        j.speed = p.get(1).map(|s| s.trim().to_string()).unwrap_or_default();
                        j.eta = p.get(2).map(|s| s.trim().to_string()).unwrap_or_default();
                        j.message = "กำลังโหลด...".into();
                    });
                }
            } else if let Some(t) = line.strip_prefix("MTBT|") {
                let t = t.to_string();
                st.jobs.update(&a, &id, |j| j.title = t);
            } else if let Some(f) = line.strip_prefix("MTBF|") {
                *lf.lock().unwrap() = Some(f.to_string());
            } else if line.contains("[Merger]") || line.contains("[ExtractAudio]") {
                st.jobs.update(&a, &id, |j| j.message = "กำลังรวมไฟล์/แปลงเสียง...".into());
            }
        })
        .await;
    });
    let errs = errors.clone();
    let err_task = tokio::spawn(async move {
        read_lines(stderr, |line| {
            if line.contains("ERROR") {
                errs.lock().unwrap().push(line);
            }
        })
        .await;
    });

    let status = wait_or_kill(&mut child, kill, false).await.map_err(|e| vec![e.to_string()])?;
    drain(out_task).await;
    drain(err_task).await;
    let result = match status {
        Some(s) if s.success() => Ok(last_file.lock().unwrap().clone()),
        Some(_) => Err(errors.lock().unwrap().clone()),
        None => Ok(None),
    };
    result
}

/// yt-dlp อ่านคุกกี้จากเบราว์เซอร์ไม่ได้ (เบราว์เซอร์เปิดอยู่ล็อกไฟล์ / ถอดรหัสไม่ได้)
pub fn is_cookie_error(errs: &[String]) -> bool {
    let lower = errs.join("\n").to_lowercase();
    lower.contains("cookie database")
        || lower.contains("failed to decrypt")
        || lower.contains("dpapi")
        || (lower.contains("cookies") && lower.contains("could not find"))
}

/// แปลง error ของ yt-dlp ให้เป็นภาษาไทยที่เข้าใจง่าย
pub fn explain_ytdlp_error(errs: &[String]) -> String {
    let all = errs.join("\n");
    let lower = all.to_lowercase();
    let hint = if is_cookie_error(errs) {
        "อ่านคุกกี้จากเบราว์เซอร์ไม่ได้ — ปิดเบราว์เซอร์ก่อน หรือใช้ไฟล์ cookies.txt แทนในหน้า ตั้งค่า"
    } else if lower.contains("private") || lower.contains("login") || lower.contains("cookies") {
        "คลิปนี้ต้องล็อกอิน — ลองตั้งค่าคุกกี้จากเบราว์เซอร์ในหน้า ตั้งค่า"
    } else if lower.contains("unsupported url") {
        "ยังไม่รองรับลิงก์นี้"
    } else if lower.contains("unable to download") || lower.contains("timed out") || lower.contains("getaddrinfo") {
        "เชื่อมต่ออินเทอร์เน็ตไม่ได้ หรือเว็บไม่ตอบสนอง"
    } else if lower.contains("not available") || lower.contains("removed") || lower.contains("404") {
        "คลิปนี้ถูกลบหรือไม่เปิดให้ดูในประเทศไทย"
    } else if lower.contains("requested format") {
        "ไม่มีคุณภาพ/รูปแบบที่เลือก — ลองเลือก 'ดีที่สุด'"
    } else {
        "โหลดไม่สำเร็จ"
    };
    let detail = errs.last().cloned().unwrap_or_default();
    if detail.is_empty() {
        hint.to_string()
    } else {
        format!("{hint} ({detail})")
    }
}

fn parse_ffmpeg_time(v: &str) -> Option<f64> {
    // out_time=00:01:02.345
    let mut parts = v.split(':');
    let h: f64 = parts.next()?.parse().ok()?;
    let m: f64 = parts.next()?.parse().ok()?;
    let s: f64 = parts.next()?.parse().ok()?;
    Some(h * 3600.0 + m * 60.0 + s)
}

async fn run_ffmpeg(
    app: &AppHandle,
    job: &Job,
    passes: &[Vec<String>],
    duration: f64,
    graceful: bool,
    kill: &Notify,
) -> Result<Option<String>, String> {
    let result = run_ffmpeg_passes(app, job, passes, duration, graceful, kill).await;
    cleanup_passlogs(passes);
    result
}

/// ลบไฟล์ log ของ two-pass (xxx.passlog-0.log, .mbtree) ที่ ffmpeg ทิ้งไว้
fn cleanup_passlogs(passes: &[Vec<String>]) {
    for pass in passes {
        let Some(i) = pass.iter().position(|a| a == "-passlogfile") else { continue };
        let Some(prefix) = pass.get(i + 1).map(PathBuf::from) else { continue };
        let (Some(dir), Some(name)) = (prefix.parent(), prefix.file_name()) else { continue };
        let name = name.to_string_lossy().to_string();
        let dir = if dir.as_os_str().is_empty() { std::path::Path::new(".") } else { dir };
        for e in std::fs::read_dir(dir).into_iter().flatten().flatten() {
            if e.file_name().to_string_lossy().starts_with(&format!("{name}-")) {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
}

async fn run_ffmpeg_passes(
    app: &AppHandle,
    job: &Job,
    passes: &[Vec<String>],
    duration: f64,
    graceful: bool,
    kill: &Notify,
) -> Result<Option<String>, String> {
    let state = app.state::<AppState>();
    let bin = state.tool("ffmpeg").map_err(|e| e.to_string())?;
    if let Some(parent) = PathBuf::from(&job.output).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let total = passes.len().max(1) as f64;
    for (idx, pass) in passes.iter().enumerate() {
        let mut cmd = binaries::job_command(&bin);
        cmd.args(["-hide_banner", "-nostats", "-progress", "pipe:1"])
            .args(pass)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = cmd.spawn().map_err(|e| format!("เปิด ffmpeg ไม่ได้: {e}"))?;
        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();
        let (a, id) = (app.clone(), job.id.clone());
        let started = Instant::now();
        let out_task = tokio::spawn(async move {
            let st = a.state::<AppState>();
            let mut cur = 0.0f64;
            let mut speed = String::new();
            read_lines(stdout, |line| {
                if let Some(v) = line.strip_prefix("out_time=") {
                    cur = parse_ffmpeg_time(v).unwrap_or(cur);
                } else if let Some(v) = line.strip_prefix("speed=") {
                    speed = v.trim().to_string();
                } else if line.starts_with("progress=") {
                    let pct = if duration > 0.0 {
                        ((idx as f64 + (cur / duration).min(1.0)) / total * 100.0).min(99.9)
                    } else {
                        0.0
                    };
                    // ไม่รู้ความยาวไฟล์ = ประเมินเวลาที่เหลือไม่ได้
                    let eta = if duration > 0.0 && cur > 0.0 {
                        let el = started.elapsed().as_secs_f64();
                        let rem = el / (cur / duration) - el;
                        format!("{:.0} วิ", rem.max(0.0))
                    } else {
                        String::new()
                    };
                    st.jobs.update(&a, &id, |j| {
                        j.progress = pct;
                        j.speed = speed.clone();
                        j.eta = eta;
                        j.message = if total > 1.0 {
                            format!("กำลังประมวลผล รอบที่ {}/{}", idx + 1, total)
                        } else {
                            "กำลังประมวลผล...".into()
                        };
                    });
                }
            })
            .await;
        });
        let tail = Arc::new(Mutex::new(Vec::<String>::new()));
        let t2 = tail.clone();
        let err_task = tokio::spawn(async move {
            read_lines(stderr, |l| {
                let mut t = t2.lock().unwrap();
                t.push(l);
                if t.len() > 6 {
                    t.remove(0);
                }
            })
            .await;
        });
        let status = wait_or_kill(&mut child, kill, graceful)
            .await
            .map_err(|e| e.to_string())?;
        drain(out_task).await;
        drain(err_task).await;
        match status {
            Some(s) if s.success() => continue,
            Some(_) => {
                let t = tail.lock().unwrap().join(" | ");
                return Err(format!("แปลงไฟล์ไม่สำเร็จ — ตรวจสอบว่าไฟล์ต้นฉบับไม่เสียและรูปแบบที่เลือกรองรับ ({t})"));
            }
            None => return Ok(None),
        }
    }
    Ok(None)
}
