//! ล้างไฟล์ขยะในเครื่อง + จัดการโปรแกรมเปิดพร้อม Windows
//! ลบเฉพาะที่ปลอดภัย (แคช/ไฟล์ชั่วคราว/รายงานแครช) ไฟล์ที่ถูกใช้อยู่จะข้ามไปเอง ไม่ทำให้โปรแกรมอื่นพัง
use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: String,
    pub group: String,
    pub label: String,
    pub desc: String,
    pub size: u64,
    pub count: u64,
    /// เลือกไว้ให้ตั้งแต่แรก (ปลอดภัยแน่นอน)
    pub recommended: bool,
    pub needs_admin: bool,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CleanResult {
    pub freed: u64,
    pub deleted: u64,
    pub skipped: u64,
}

/// แหล่งไฟล์ขยะหนึ่งแหล่ง: ลบ "ของข้างใน" โฟลเดอร์ (ไม่ลบตัวโฟลเดอร์) หรือไฟล์ตามรูปแบบชื่อ
struct Target {
    dir: PathBuf,
    /// None = ทุกไฟล์ในโฟลเดอร์, Some = เฉพาะชื่อที่ขึ้นต้น/ลงท้ายตามนี้
    pattern: Option<(&'static str, &'static str)>,
    /// ลบเฉพาะไฟล์ที่เก่ากว่านี้ (กันลบไฟล์ที่ตัวติดตั้งกำลังใช้)
    min_age: Duration,
    recursive: bool,
}

/// โฟลเดอร์ของโปรแกรมเราเอง
#[derive(Default)]
pub struct AppDirs {
    /// ลบของข้างในได้ทั้งหมด (ภาพย่อ, temp)
    pub scratch: Vec<PathBuf>,
    /// โฟลเดอร์ดาวน์โหลด — ลบเฉพาะไฟล์โหลดค้าง .part/.ytdl ที่เก่ากว่า 1 วัน
    pub downloads: Option<PathBuf>,
}

struct Def {
    id: &'static str,
    group: &'static str,
    label: &'static str,
    desc: &'static str,
    recommended: bool,
    needs_admin: bool,
}

const DEFS: &[Def] = &[
    Def { id: "user_temp", group: "Windows", label: "ไฟล์ชั่วคราวของผู้ใช้", desc: "%TEMP% — ไฟล์ที่โปรแกรมต่าง ๆ ทิ้งไว้ (เฉพาะที่เก่ากว่า 1 วัน)", recommended: true, needs_admin: false },
    Def { id: "win_temp", group: "Windows", label: "ไฟล์ชั่วคราวของ Windows", desc: "C:\\Windows\\Temp", recommended: true, needs_admin: true },
    Def { id: "recycle", group: "Windows", label: "ถังขยะ", desc: "ไฟล์ที่ลบไว้ในถังขยะทุกไดรฟ์ (ลบแล้วกู้คืนไม่ได้)", recommended: false, needs_admin: false },
    Def { id: "thumbs", group: "Windows", label: "แคชภาพย่อ/ไอคอน", desc: "Explorer จะสร้างใหม่เองเมื่อเปิดโฟลเดอร์", recommended: true, needs_admin: false },
    Def { id: "crash", group: "Windows", label: "รายงานแครช / Memory dump", desc: "WER, CrashDumps, Minidump — ไม่จำเป็นต่อการใช้งาน", recommended: true, needs_admin: false },
    Def { id: "update", group: "Windows", label: "ไฟล์ดาวน์โหลด Windows Update", desc: "SoftwareDistribution\\Download + Delivery Optimization (อัปเดตที่ติดตั้งแล้ว)", recommended: true, needs_admin: true },
    Def { id: "shader", group: "Windows", label: "แคช Shader การ์ดจอ", desc: "DirectX/NVIDIA/AMD — เกมจะสร้างใหม่ (ครั้งแรกอาจกระตุกนิดหน่อย)", recommended: false, needs_admin: false },
    Def { id: "chrome", group: "เบราว์เซอร์", label: "Google Chrome — แคช", desc: "ไม่ลบรหัสผ่าน ประวัติ หรือการล็อกอิน", recommended: true, needs_admin: false },
    Def { id: "edge", group: "เบราว์เซอร์", label: "Microsoft Edge — แคช", desc: "ไม่ลบรหัสผ่าน ประวัติ หรือการล็อกอิน", recommended: true, needs_admin: false },
    Def { id: "brave", group: "เบราว์เซอร์", label: "Brave — แคช", desc: "ไม่ลบรหัสผ่าน ประวัติ หรือการล็อกอิน", recommended: true, needs_admin: false },
    Def { id: "firefox", group: "เบราว์เซอร์", label: "Firefox — แคช", desc: "ไม่ลบรหัสผ่าน ประวัติ หรือการล็อกอิน", recommended: true, needs_admin: false },
    Def { id: "apps", group: "แอปอื่น", label: "แคช Discord / Teams / Spotify / LINE / VS Code", desc: "แอปจะโหลดใหม่เมื่อใช้", recommended: false, needs_admin: false },
    Def { id: "dev", group: "แอปอื่น", label: "แคชนักพัฒนา (npm, pip, yarn, NuGet)", desc: "แพ็กเกจที่โหลดเก็บไว้ — ติดตั้งครั้งหน้าจะโหลดใหม่", recommended: false, needs_admin: false },
    Def { id: "media_toolbox", group: "มีเดียทูลบ็อกซ์", label: "ไฟล์ค้างของโปรแกรมนี้", desc: "ภาพย่อ, ไฟล์แปลงชั่วคราว, ไฟล์โหลดค้าง (.part)", recommended: true, needs_admin: false },
];

fn env(k: &str) -> PathBuf {
    std::env::var_os(k).map(PathBuf::from).unwrap_or_default()
}

fn all(dir: PathBuf) -> Target {
    Target { dir, pattern: None, min_age: Duration::ZERO, recursive: true }
}

/// โปรไฟล์ของเบราว์เซอร์ตระกูล Chromium: Default, Profile 1, ...
fn chromium(base: PathBuf) -> Vec<Target> {
    let mut v = Vec::new();
    let Ok(rd) = std::fs::read_dir(&base) else { return v };
    for e in rd.flatten() {
        let p = e.path();
        if !p.join("Preferences").is_file() {
            continue;
        }
        for sub in ["Cache", "Code Cache", "GPUCache", "Service Worker\\CacheStorage", "DawnWebGPUCache", "DawnGraphiteCache"] {
            v.push(all(p.join(sub)));
        }
    }
    for sub in ["ShaderCache", "GrShaderCache", "GraphiteDawnCache", "component_crx_cache"] {
        v.push(all(base.join(sub)));
    }
    v
}

fn targets(id: &str, app: &AppDirs) -> Vec<Target> {
    let local = env("LOCALAPPDATA");
    let roaming = env("APPDATA");
    let win = env("SystemRoot");
    let pd = env("ProgramData");
    let day = Duration::from_secs(24 * 3600);
    match id {
        "user_temp" => vec![Target { dir: env("TEMP"), pattern: None, min_age: day, recursive: true }],
        "win_temp" => vec![Target { dir: win.join("Temp"), pattern: None, min_age: day, recursive: true }],
        "thumbs" => vec![
            Target { dir: local.join("Microsoft\\Windows\\Explorer"), pattern: Some(("thumbcache_", ".db")), min_age: Duration::ZERO, recursive: false },
            Target { dir: local.join("Microsoft\\Windows\\Explorer"), pattern: Some(("iconcache_", ".db")), min_age: Duration::ZERO, recursive: false },
        ],
        "crash" => vec![
            all(local.join("CrashDumps")),
            all(local.join("Microsoft\\Windows\\WER")),
            all(pd.join("Microsoft\\Windows\\WER\\ReportArchive")),
            all(pd.join("Microsoft\\Windows\\WER\\ReportQueue")),
            all(win.join("Minidump")),
            Target { dir: win.clone(), pattern: Some(("MEMORY", ".DMP")), min_age: Duration::ZERO, recursive: false },
        ],
        "update" => vec![
            Target { dir: win.join("SoftwareDistribution\\Download"), pattern: None, min_age: day, recursive: true },
            all(win.join("ServiceProfiles\\NetworkService\\AppData\\Local\\Microsoft\\Windows\\DeliveryOptimization\\Cache")),
        ],
        "shader" => vec![
            all(local.join("D3DSCache")),
            all(local.join("NVIDIA\\DXCache")),
            all(local.join("NVIDIA\\GLCache")),
            all(local.join("AMD\\DxCache")),
            all(local.join("AMD\\DxcCache")),
            all(local.join("AMD\\VkCache")),
            all(local.join("Intel\\ShaderCache")),
        ],
        "chrome" => chromium(local.join("Google\\Chrome\\User Data")),
        "edge" => chromium(local.join("Microsoft\\Edge\\User Data")),
        "brave" => chromium(local.join("BraveSoftware\\Brave-Browser\\User Data")),
        "firefox" => std::fs::read_dir(local.join("Mozilla\\Firefox\\Profiles"))
            .map(|rd| rd.flatten().flat_map(|e| [all(e.path().join("cache2")), all(e.path().join("startupCache")), all(e.path().join("thumbnails"))]).collect())
            .unwrap_or_default(),
        "apps" => {
            let mut v = Vec::new();
            for app in ["discord", "discordptb", "discordcanary", "Microsoft\\Teams", "Code", "Slack", "LINE"] {
                for sub in ["Cache", "Code Cache", "GPUCache", "CachedData", "Service Worker\\CacheStorage"] {
                    v.push(all(roaming.join(app).join(sub)));
                }
            }
            v.push(all(local.join("Spotify\\Data")));
            v.push(all(local.join("Packages\\MSTeams_8wekyb3d8bbwe\\LocalCache\\Microsoft\\MSTeams\\EBWebView\\Default\\Cache")));
            v.push(all(local.join("LINE\\Cache")));
            v
        }
        "dev" => vec![
            all(local.join("npm-cache")),
            all(local.join("pip\\Cache")),
            all(local.join("Yarn\\Cache")),
            all(local.join("pnpm-cache")),
            all(env("USERPROFILE").join(".nuget\\packages")),
            all(local.join("NuGet\\v3-cache")),
        ],
        "media_toolbox" => {
            let mut v: Vec<Target> = app.scratch.iter().cloned().map(all).collect();
            if let Some(d) = &app.downloads {
                for suf in [".part", ".ytdl"] {
                    v.push(Target { dir: d.clone(), pattern: Some(("", suf)), min_age: day, recursive: true });
                }
            }
            v
        }
        _ => vec![],
    }
}

fn matches(t: &Target, p: &Path) -> bool {
    match t.pattern {
        None => true,
        Some((pre, suf)) => {
            let n = p.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
            n.starts_with(&pre.to_lowercase()) && n.ends_with(&suf.to_lowercase())
        }
    }
}

fn old_enough(t: &Target, m: &std::fs::Metadata) -> bool {
    if t.min_age.is_zero() {
        return true;
    }
    let cutoff = SystemTime::now() - t.min_age;
    m.modified().map(|x| x < cutoff).unwrap_or(false)
}

/// เดินทุกไฟล์ในเป้าหมาย แล้วเรียก f(path, size)
fn walk(t: &Target, mut f: impl FnMut(&Path, u64)) {
    if !t.dir.is_dir() {
        return;
    }
    let depth = if t.recursive { usize::MAX } else { 1 };
    for e in walkdir::WalkDir::new(&t.dir).min_depth(1).max_depth(depth).follow_links(false).into_iter().flatten() {
        if !e.file_type().is_file() || !matches(t, e.path()) {
            continue;
        }
        if let Ok(m) = e.metadata() {
            if old_enough(t, &m) {
                f(e.path(), m.len());
            }
        }
    }
}

pub fn scan(app: &AppDirs) -> Vec<Category> {
    DEFS.iter()
        .map(|d| {
            let (mut size, mut count) = (0u64, 0u64);
            if d.id == "recycle" {
                (size, count) = recycle_bin_info();
            } else {
                for t in targets(d.id, app) {
                    walk(&t, |_, s| {
                        size += s;
                        count += 1;
                    });
                }
            }
            Category {
                id: d.id.into(),
                group: d.group.into(),
                label: d.label.into(),
                desc: d.desc.into(),
                size,
                count,
                recommended: d.recommended,
                needs_admin: d.needs_admin,
            }
        })
        .collect()
}

pub fn clean(ids: &[String], app: &AppDirs) -> CleanResult {
    let mut r = CleanResult::default();
    for id in ids {
        if id == "recycle" {
            let (s, c) = recycle_bin_info();
            if empty_recycle_bin() {
                r.freed += s;
                r.deleted += c;
            }
            continue;
        }
        for t in targets(id, app) {
            let mut files = Vec::new();
            walk(&t, |p, s| files.push((p.to_path_buf(), s)));
            for (p, s) in files {
                // ไฟล์ที่โปรแกรมอื่นเปิดอยู่จะลบไม่ได้ — ข้ามไป
                if std::fs::remove_file(&p).is_ok() {
                    r.freed += s;
                    r.deleted += 1;
                } else {
                    r.skipped += 1;
                }
            }
            // เก็บกวาดโฟลเดอร์ย่อยที่ว่างแล้ว (ไม่ลบโฟลเดอร์หลัก, ไม่ยุ่งโฟลเดอร์ที่ลบเฉพาะบางไฟล์)
            if t.recursive && t.pattern.is_none() && t.dir.is_dir() {
                let mut dirs: Vec<PathBuf> = walkdir::WalkDir::new(&t.dir).min_depth(1).into_iter().flatten().filter(|e| e.file_type().is_dir()).map(|e| e.into_path()).collect();
                dirs.sort_by_key(|d| std::cmp::Reverse(d.components().count()));
                for d in dirs {
                    let _ = std::fs::remove_dir(d);
                }
            }
        }
    }
    r
}

#[cfg(windows)]
fn recycle_bin_info() -> (u64, u64) {
    use windows_sys::Win32::UI::Shell::{SHQueryRecycleBinW, SHQUERYRBINFO};
    let mut info = SHQUERYRBINFO { cbSize: std::mem::size_of::<SHQUERYRBINFO>() as u32, i64Size: 0, i64NumItems: 0 };
    // null = รวมทุกไดรฟ์
    let hr = unsafe { SHQueryRecycleBinW(std::ptr::null(), &mut info) };
    if hr == 0 {
        (info.i64Size.max(0) as u64, info.i64NumItems.max(0) as u64)
    } else {
        (0, 0)
    }
}

#[cfg(windows)]
fn empty_recycle_bin() -> bool {
    use windows_sys::Win32::UI::Shell::{SHEmptyRecycleBinW, SHERB_NOCONFIRMATION, SHERB_NOPROGRESSUI, SHERB_NOSOUND};
    let hr = unsafe { SHEmptyRecycleBinW(std::ptr::null_mut(), std::ptr::null(), SHERB_NOCONFIRMATION | SHERB_NOPROGRESSUI | SHERB_NOSOUND) };
    hr == 0 || recycle_bin_info().1 == 0
}

#[cfg(not(windows))]
fn recycle_bin_info() -> (u64, u64) {
    (0, 0)
}
#[cfg(not(windows))]
fn empty_recycle_bin() -> bool {
    false
}

// ---------------- โปรแกรมเปิดพร้อม Windows ----------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupItem {
    pub name: String,
    pub command: String,
    /// hkcu | hklm | folder_user | folder_common
    pub location: String,
    pub enabled: bool,
    /// แก้ได้โดยไม่ต้องเป็นแอดมิน
    pub editable: bool,
}

#[cfg(windows)]
mod startup_impl {
    use super::*;
    use winreg::enums::*;
    use winreg::RegKey;

    const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
    const APPROVED: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved";

    /// Windows เก็บสถานะเปิด/ปิดไว้ใน StartupApproved (แบบเดียวกับ Task Manager) — ไบต์แรกเลขคู่ = เปิด
    fn approved(root: &RegKey, sub: &str, name: &str) -> bool {
        root.open_subkey(format!(r"{APPROVED}\{sub}"))
            .and_then(|k| k.get_raw_value(name))
            .map(|v| v.bytes.first().map(|b| b % 2 == 0).unwrap_or(true))
            .unwrap_or(true)
    }

    fn folder(base: PathBuf) -> Vec<(String, String)> {
        std::fs::read_dir(base)
            .map(|rd| {
                rd.flatten()
                    .filter(|e| e.file_name().to_string_lossy().to_lowercase() != "desktop.ini")
                    .map(|e| (e.file_name().to_string_lossy().to_string(), e.path().to_string_lossy().to_string()))
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn list() -> Vec<StartupItem> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        let mut v = Vec::new();
        for (root, loc, editable) in [(&hkcu, "hkcu", true), (&hklm, "hklm", false)] {
            if let Ok(k) = root.open_subkey(RUN) {
                for (name, _) in k.enum_values().flatten() {
                    let command: String = k.get_value(&name).unwrap_or_default();
                    v.push(StartupItem { enabled: approved(root, "Run", &name), name, command, location: loc.into(), editable });
                }
            }
        }
        let user_folder = PathBuf::from(std::env::var_os("APPDATA").unwrap_or_default()).join(r"Microsoft\Windows\Start Menu\Programs\Startup");
        for (name, path) in folder(user_folder) {
            v.push(StartupItem { enabled: approved(&hkcu, "StartupFolder", &name), name, command: path, location: "folder_user".into(), editable: true });
        }
        let common = PathBuf::from(std::env::var_os("ProgramData").unwrap_or_default()).join(r"Microsoft\Windows\Start Menu\Programs\StartUp");
        for (name, path) in folder(common) {
            v.push(StartupItem { enabled: approved(&hklm, "StartupFolder", &name), name, command: path, location: "folder_common".into(), editable: false });
        }
        v
    }

    pub fn set(name: &str, location: &str, enabled: bool) -> AppResult<()> {
        let (root, sub) = match location {
            "hkcu" => (RegKey::predef(HKEY_CURRENT_USER), "Run"),
            "folder_user" => (RegKey::predef(HKEY_CURRENT_USER), "StartupFolder"),
            "hklm" => (RegKey::predef(HKEY_LOCAL_MACHINE), "Run"),
            "folder_common" => (RegKey::predef(HKEY_LOCAL_MACHINE), "StartupFolder"),
            _ => return Err(AppError::Msg("ตำแหน่งไม่ถูกต้อง".into())),
        };
        let (k, _) = root
            .create_subkey(format!(r"{APPROVED}\{sub}"))
            .map_err(|_| AppError::Msg("รายการนี้เป็นของทั้งเครื่อง ต้องเปิดโปรแกรมแบบ Run as administrator ก่อน".into()))?;
        // 12 ไบต์: สถานะ + เวลาที่ปิด (FILETIME) — รูปแบบเดียวกับ Task Manager
        let mut bytes = vec![if enabled { 2u8 } else { 3u8 }, 0, 0, 0];
        let ft: u64 = if enabled { 0 } else { (chrono::Utc::now().timestamp() as u64 + 11_644_473_600) * 10_000_000 };
        bytes.extend_from_slice(&ft.to_le_bytes());
        k.set_raw_value(name, &winreg::RegValue { bytes, vtype: REG_BINARY })
            .map_err(|_| AppError::Msg("แก้ไขไม่สำเร็จ — ต้องใช้สิทธิ์แอดมิน".into()))
    }
}

#[cfg(windows)]
pub use startup_impl::{list as startup_list, set as startup_set};

#[cfg(not(windows))]
pub fn startup_list() -> Vec<StartupItem> {
    vec![]
}
#[cfg(not(windows))]
pub fn startup_set(_: &str, _: &str, _: bool) -> AppResult<()> {
    Err(AppError::Msg("รองรับเฉพาะ Windows".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_only_old_files_in_target() {
        let d = std::env::temp_dir().join(format!("mtb-clean-{}", rand::random::<u32>()));
        std::fs::create_dir_all(d.join("sub")).unwrap();
        std::fs::write(d.join("a.tmp"), vec![0u8; 1000]).unwrap();
        std::fs::write(d.join("sub").join("b.tmp"), vec![0u8; 500]).unwrap();
        let t = all(d.clone());
        let mut n = 0;
        walk(&t, |_, s| n += s);
        assert_eq!(n, 1500);
        let young = Target { dir: d.clone(), pattern: None, min_age: Duration::from_secs(3600), recursive: true };
        let mut m = 0;
        walk(&young, |_, _| m += 1);
        assert_eq!(m, 0, "ไฟล์ใหม่ต้องไม่ถูกนับเมื่อกำหนดอายุขั้นต่ำ");
        let pat = Target { dir: d.clone(), pattern: Some(("a", ".tmp")), min_age: Duration::ZERO, recursive: false };
        let mut k = 0;
        walk(&pat, |_, _| k += 1);
        assert_eq!(k, 1);
        let r = clean(&["media_toolbox".into()], &AppDirs { scratch: vec![d.clone()], downloads: None });
        assert!(r.deleted >= 2 && r.freed >= 1500);
        assert!(d.is_dir() && !d.join("sub").exists());
        std::fs::remove_dir_all(d).unwrap();
        assert_eq!(scan(&AppDirs::default()).len(), DEFS.len());
        let _ = startup_list();
    }
}
