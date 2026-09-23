//! คำสั่งระบบ: สถิติเครื่อง, ประวัติ, log, PDF, ความปลอดภัย, Media Server
use crate::core::{crypto, db::HistoryItem, db::LogItem, pdf, server};
use crate::error::{msg, AppError, AppResult};
use crate::state::AppState;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Instant;
use tauri::{AppHandle, Manager, State};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfo {
    name: String,
    mount: String,
    total: u64,
    available: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemStats {
    cpu: f32,
    cores: Vec<f32>,
    cpu_name: String,
    mem_used: u64,
    mem_total: u64,
    app_mem: u64,
    disks: Vec<DiskInfo>,
    net_rx: u64,
    net_tx: u64,
    uptime: u64,
    os: String,
    host: String,
}

static LAST_NET: OnceLock<std::sync::Mutex<Instant>> = OnceLock::new();
type DiskCache = std::sync::Mutex<Option<(Instant, Vec<DiskInfo>)>>;
static DISK_CACHE: OnceLock<DiskCache> = OnceLock::new();

#[tauri::command(async)]
pub fn system_stats(state: State<AppState>) -> SystemStats {
    use sysinfo::{Disks, ProcessRefreshKind, RefreshKind, CpuRefreshKind, MemoryRefreshKind};
    let mut sys = state.sys.lock().unwrap();
    sys.refresh_specifics(
        RefreshKind::nothing()
            .with_cpu(CpuRefreshKind::nothing().with_cpu_usage())
            .with_memory(MemoryRefreshKind::everything()),
    );
    let pid = sysinfo::get_current_pid().ok();
    if let Some(p) = pid {
        sys.refresh_processes_specifics(sysinfo::ProcessesToUpdate::Some(&[p]), true, ProcessRefreshKind::nothing().with_memory());
    }
    let app_mem = pid.and_then(|p| sys.process(p)).map(|p| p.memory()).unwrap_or(0);

    let mut nets = state.nets.lock().unwrap();
    nets.refresh(true);
    // ครั้งแรก: ตัวนับยังสะสมมาตั้งแต่เปิดโปรแกรม — ไม่ใช่ความเร็วจริง ให้แสดง 0 ไปก่อน
    let first = LAST_NET.get().is_none();
    let last = LAST_NET.get_or_init(|| std::sync::Mutex::new(Instant::now()));
    let secs = {
        let mut l = last.lock().unwrap();
        let s = l.elapsed().as_secs_f64().max(0.5);
        *l = Instant::now();
        s
    };
    let (rx, tx) = if first {
        (0, 0)
    } else {
        nets.iter().fold((0u64, 0u64), |(r, t), (_, d)| (r + d.received(), t + d.transmitted()))
    };

    // ไล่ดิสก์ทั้งเครื่องทุก 2 วิ เปลืองเกินไป — เก็บไว้ใช้ซ้ำ 30 วิ
    let disks = {
        let cache = DISK_CACHE.get_or_init(|| std::sync::Mutex::new(None));
        let mut c = cache.lock().unwrap();
        match c.as_ref() {
            Some((at, list)) if at.elapsed() < std::time::Duration::from_secs(30) => list.clone(),
            _ => {
                let list: Vec<DiskInfo> = Disks::new_with_refreshed_list()
                    .iter()
                    .map(|d| DiskInfo {
                        name: d.name().to_string_lossy().to_string(),
                        mount: d.mount_point().to_string_lossy().to_string(),
                        total: d.total_space(),
                        available: d.available_space(),
                    })
                    .collect();
                *c = Some((Instant::now(), list.clone()));
                list
            }
        }
    };

    SystemStats {
        cpu: sys.global_cpu_usage(),
        cores: sys.cpus().iter().map(|c| c.cpu_usage()).collect(),
        cpu_name: sys.cpus().first().map(|c| c.brand().trim().to_string()).unwrap_or_default(),
        mem_used: sys.used_memory(),
        mem_total: sys.total_memory(),
        app_mem,
        disks,
        net_rx: (rx as f64 / secs) as u64,
        net_tx: (tx as f64 / secs) as u64,
        uptime: sysinfo::System::uptime(),
        os: sysinfo::System::long_os_version().unwrap_or_default(),
        host: sysinfo::System::host_name().unwrap_or_default(),
    }
}

/// ชื่อการ์ดจอ + VRAM (ผ่าน PowerShell/CIM เพราะ sysinfo ไม่มีข้อมูล GPU)
#[tauri::command]
pub async fn gpu_info() -> Vec<String> {
    let ps = PathBuf::from("powershell");
    let out = crate::core::binaries::command(&ps)
        .args(["-NoProfile", "-Command", "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_VideoController | ForEach-Object { \"$($_.Name) | $([math]::Round($_.AdapterRAM/1MB)) MB | ไดรเวอร์ $($_.DriverVersion)\" }"])
        .output()
        .await;
    out.map(|o| String::from_utf8_lossy(&o.stdout).lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect())
        .unwrap_or_default()
}

// ---------- ประวัติ / log ----------

#[tauri::command(async)]
pub fn list_history(state: State<AppState>, limit: Option<i64>) -> AppResult<Vec<HistoryItem>> {
    state.db.lock().unwrap().list_history(limit.unwrap_or(5000))
}

#[tauri::command(async)]
pub fn delete_history(state: State<AppState>, ids: Vec<String>) -> AppResult<()> {
    state.db.lock().unwrap().delete_history(&ids)
}

#[tauri::command(async)]
pub fn clear_history(state: State<AppState>) -> AppResult<()> {
    state.db.lock().unwrap().clear_history()
}

#[tauri::command(async)]
pub fn list_logs(state: State<AppState>, limit: Option<i64>) -> AppResult<Vec<LogItem>> {
    state.db.lock().unwrap().list_logs(limit.unwrap_or(1000))
}

#[tauri::command(async)]
pub fn add_log(state: State<AppState>, level: String, source: String, message: String) {
    state.log(&level, &source, &message);
}

#[tauri::command(async)]
pub fn clear_logs(state: State<AppState>) -> AppResult<()> {
    state.db.lock().unwrap().clear_logs()
}

// ---------- PDF ----------

#[tauri::command]
pub async fn pdf_tool(app: AppHandle, action: String, inputs: Vec<String>, output: String, arg: String) -> AppResult<serde_json::Value> {
    tauri::async_runtime::spawn_blocking(move || -> AppResult<serde_json::Value> {
        let first = PathBuf::from(inputs.first().ok_or_else(|| AppError::Msg("ยังไม่ได้เลือกไฟล์".into()))?);
        let out = PathBuf::from(&output);
        let result = match action.as_str() {
            "info" => serde_json::json!({ "pages": pdf::page_count(&first)? }),
            "compress" => {
                // low = ไม่เสียคุณภาพ, medium/high = บีบรูปในไฟล์เอง (ถ้ามี Ghostscript ในเครื่องจะใช้ก่อนเพราะได้ผลดีกว่า)
                let level = arg.as_str();
                let mut method = "lopdf (ไม่เสียคุณภาพ)".to_string();
                let mut used_gs = false;
                if level != "low" {
                    if let Some(gs) = find_ghostscript() {
                        let setting = if level == "high" { "/screen" } else { "/ebook" };
                        let st = crate::core::binaries::std_command(&gs)
                            .args(["-sDEVICE=pdfwrite", "-dCompatibilityLevel=1.5", &format!("-dPDFSETTINGS={setting}"), "-dNOPAUSE", "-dQUIET", "-dBATCH"])
                            .arg(format!("-sOutputFile={}", out.display()))
                            .arg(&first)
                            .status();
                        used_gs = st.map(|s| s.success()).unwrap_or(false);
                    }
                }
                if used_gs {
                    pdf::compress_lossless(&out, &out, true)?;
                    method = "Ghostscript".into();
                } else if level == "low" {
                    pdf::compress_lossless(&first, &out, true)?;
                } else {
                    let (q, side) = if level == "high" { (45, 1100) } else { (68, 1700) };
                    let n = pdf::compress_images(&first, &out, q, side, true)?;
                    method = format!("บีบรูป {n} รูป (JPEG {q}%)");
                }
                let before = std::fs::metadata(&first)?.len();
                let after = std::fs::metadata(&out)?.len();
                let state = app.state::<AppState>();
                let _ = state.db.lock().unwrap().add_history(&HistoryItem {
                    id: uuid::Uuid::new_v4().to_string(),
                    kind: "compress".into(),
                    title: format!("บีบอัด PDF {}", first.file_name().unwrap_or_default().to_string_lossy()),
                    input: first.to_string_lossy().to_string(),
                    output: output.clone(),
                    status: "done".into(),
                    size_before: before as i64,
                    size_after: after as i64,
                    message: method.clone(),
                    created_at: chrono::Local::now().to_rfc3339(),
                });
                serde_json::json!({ "before": before, "after": after, "method": method })
            }
            "merge" => {
                let v: Vec<PathBuf> = inputs.iter().map(PathBuf::from).collect();
                pdf::merge(&v, &out)?;
                serde_json::json!({ "pages": pdf::page_count(&out)? })
            }
            "split" => {
                let files = pdf::split(&first, &out, &arg)?;
                serde_json::json!({ "files": files })
            }
            "rotate" => {
                let (deg, pages) = arg.split_once('|').unwrap_or((arg.as_str(), ""));
                pdf::rotate_pages(&first, &out, pages, deg.parse().unwrap_or(90))?;
                serde_json::json!({})
            }
            "delete" => {
                pdf::delete_pages(&first, &out, &arg)?;
                serde_json::json!({ "pages": pdf::page_count(&out)? })
            }
            "insert" => {
                pdf::insert_blank(&first, &out, arg.parse().unwrap_or(0))?;
                serde_json::json!({ "pages": pdf::page_count(&out)? })
            }
            "encrypt" => {
                pdf::encrypt(&first, &out, &arg, "")?;
                serde_json::json!({})
            }
            _ => return msg("ไม่รู้จักคำสั่ง PDF"),
        };
        Ok(result)
    })
    .await
    .map_err(|e| AppError::Msg(e.to_string()))?
}

fn find_ghostscript() -> Option<PathBuf> {
    for n in ["gswin64c", "gswin32c", "gs"] {
        if let Some(p) = crate::core::binaries::resolve(n, "", None) {
            return Some(p);
        }
    }
    let pf = std::env::var("ProgramFiles").ok()?;
    let root = Path::new(&pf).join("gs");
    std::fs::read_dir(root).ok()?.flatten().map(|e| e.path().join("bin").join("gswin64c.exe")).find(|p| p.is_file())
}

// ---------- ความปลอดภัย ----------

#[tauri::command]
pub async fn encrypt_file(src: String, password: String, decrypt: bool) -> AppResult<String> {
    if password.chars().count() < 4 {
        return msg("รหัสผ่านต้องยาวอย่างน้อย 4 ตัวอักษร");
    }
    tauri::async_runtime::spawn_blocking(move || {
        let s = PathBuf::from(&src);
        let dst = if decrypt {
            let base = src.strip_suffix(".mtbx").map(String::from).unwrap_or_else(|| format!("{src}.decrypted"));
            let p = PathBuf::from(&base);
            if p.exists() {
                let stem = p.file_stem().unwrap_or_default().to_string_lossy().to_string();
                let ext = p.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
                p.with_file_name(format!("{stem} (ถอดรหัส){ext}"))
            } else {
                p
            }
        } else {
            PathBuf::from(format!("{src}.mtbx"))
        };
        if decrypt {
            crypto::decrypt_file(&s, &dst, &password)?;
        } else {
            crypto::encrypt_file(&s, &dst, &password)?;
        }
        Ok(dst.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| AppError::Msg(e.to_string()))?
}

#[tauri::command]
pub async fn shred_files(paths: Vec<String>, passes: u32) -> AppResult<usize> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut n = 0;
        for p in &paths {
            crypto::shred_file(Path::new(p), passes)?;
            n += 1;
        }
        Ok(n)
    })
    .await
    .map_err(|e| AppError::Msg(e.to_string()))?
}

#[tauri::command(async)]
pub fn set_pin(state: State<AppState>, pin: String) -> AppResult<()> {
    if !pin.is_empty() && (pin.len() < 4 || !pin.chars().all(|c| c.is_ascii_digit())) {
        return msg("PIN ต้องเป็นตัวเลขอย่างน้อย 4 หลัก");
    }
    let mut s = state.settings.lock().unwrap();
    s.pin_hash = if pin.is_empty() { String::new() } else { crypto::hash_pin(&pin) };
    s.save(&state.settings_path)?;
    drop(s);
    state.log("info", "access", if pin.is_empty() { "ปิดการใช้ PIN" } else { "ตั้ง PIN ใหม่" });
    Ok(())
}

#[tauri::command(async)]
pub fn verify_pin(state: State<AppState>, pin: String) -> bool {
    let hash = state.settings.lock().unwrap().pin_hash.clone();
    let ok = hash.is_empty() || crypto::verify_pin(&pin, &hash);
    state.log(if ok { "info" } else { "warn" }, "access", if ok { "ปลดล็อกสำเร็จ" } else { "ใส่ PIN ผิด" });
    ok
}

#[tauri::command(async)]
pub fn has_pin(state: State<AppState>) -> bool {
    !state.settings.lock().unwrap().pin_hash.is_empty()
}

// ---------- Media Server ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerStatus {
    running: bool,
    url: String,
    root: String,
    port: u16,
}

fn status_of(s: &Option<server::MediaServer>) -> ServerStatus {
    match s {
        Some(m) => ServerStatus { running: true, url: m.url.clone(), root: m.root.to_string_lossy().to_string(), port: m.port },
        None => ServerStatus { running: false, url: String::new(), root: String::new(), port: 0 },
    }
}

#[tauri::command(async)]
pub fn start_server(state: State<AppState>, dir: String, port: u16) -> AppResult<ServerStatus> {
    let mut g = state.server.lock().unwrap();
    *g = None; // ปิดตัวเก่าก่อน
    if !Path::new(&dir).is_dir() {
        return Err(AppError::NotFound(dir));
    }
    let s = server::start(PathBuf::from(&dir), port).map_err(AppError::Msg)?;
    *g = Some(s);
    drop(g);
    state.log("info", "server", &format!("เปิด Media Server ที่ {dir}"));
    Ok(status_of(&state.server.lock().unwrap()))
}

#[tauri::command(async)]
pub fn stop_server(state: State<AppState>) -> ServerStatus {
    *state.server.lock().unwrap() = None;
    status_of(&None)
}

#[tauri::command(async)]
pub fn server_status(state: State<AppState>) -> ServerStatus {
    status_of(&state.server.lock().unwrap())
}

#[tauri::command(async)]
pub fn notify(app: AppHandle, title: String, body: String) {
    use tauri_plugin_notification::NotificationExt;
    let _ = app.notification().builder().title(title).body(body).show();
}

/// ปุ่มฉุกเฉิน — ซ่อนหน้าต่างทันที (เรียกคืนได้จากถาดระบบ)
#[tauri::command(async)]
pub fn panic_hide(app: AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
}

// ---------- FTP (อ่านอย่างเดียว) ----------

#[tauri::command(async)]
pub fn ftp_control(state: State<AppState>, start: bool, dir: String, port: u16) -> AppResult<ServerStatus> {
    let mut g = state.ftp.lock().unwrap();
    *g = None;
    if start {
        if !Path::new(&dir).is_dir() {
            return Err(AppError::NotFound(dir));
        }
        *g = Some(crate::core::ftp::start(PathBuf::from(&dir), port).map_err(AppError::Msg)?);
    }
    Ok(match g.as_ref() {
        Some(f) => ServerStatus { running: true, url: f.url.clone(), root: f.root.to_string_lossy().to_string(), port: f.port },
        None => status_of(&None),
    })
}
