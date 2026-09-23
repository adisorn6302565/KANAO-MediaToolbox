//! คำสั่งจัดการไฟล์: สแกนคลัง, หาไฟล์ซ้ำ/ใหญ่, จัดระเบียบ, เปลี่ยนชื่อ, ZIP, แบ่ง/รวมไฟล์, hash
use crate::error::{msg, AppError, AppResult};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use tauri::State;
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub path: String,
    pub name: String,
    pub ext: String,
    pub size: u64,
    pub modified: i64,
    pub kind: String,
    pub is_dir: bool,
}

pub fn kind_of(ext: &str) -> &'static str {
    match ext {
        "mp4" | "mkv" | "avi" | "mov" | "webm" | "flv" | "wmv" | "m4v" | "ts" | "3gp" | "mpg" | "mpeg" => "video",
        "mp3" | "wav" | "flac" | "aac" | "ogg" | "m4a" | "opus" | "wma" | "aiff" => "audio",
        "jpg" | "jpeg" | "png" | "webp" | "avif" | "gif" | "bmp" | "tif" | "tiff" | "heic" | "svg" | "ico" => "image",
        "pdf" | "doc" | "docx" | "txt" | "srt" | "vtt" | "ass" | "ssa" | "lrc" | "md" => "document",
        "zip" | "7z" | "rar" | "tar" | "gz" => "archive",
        _ => "other",
    }
}

fn entry(p: &Path, md: &std::fs::Metadata) -> FileEntry {
    let ext = p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    FileEntry {
        path: p.to_string_lossy().to_string(),
        name: p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
        kind: if md.is_dir() { "folder".into() } else { kind_of(&ext).into() },
        ext,
        size: md.len(),
        modified: md
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0),
        is_dir: md.is_dir(),
    }
}

fn walk(dir: &str, depth: usize) -> impl Iterator<Item = walkdir::DirEntry> {
    WalkDir::new(dir)
        .max_depth(depth)
        .into_iter()
        .filter_entry(|e| {
            let n = e.file_name().to_string_lossy();
            !(n.starts_with('.') || n == "node_modules" || n == "$RECYCLE.BIN")
        })
        .filter_map(Result::ok)
}

/// สแกนไฟล์ในโฟลเดอร์ (ใช้ในคลังไฟล์/ไฟล์ล่าสุด/ระบบอัตโนมัติ)
#[tauri::command]
pub async fn scan_files(dir: String, recursive: bool, media_only: bool, since: Option<i64>) -> AppResult<Vec<FileEntry>> {
    if !Path::new(&dir).is_dir() {
        return Err(AppError::NotFound(dir));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut v: Vec<FileEntry> = walk(&dir, if recursive { 8 } else { 1 })
            .filter(|e| e.file_type().is_file())
            .filter_map(|e| e.metadata().ok().map(|m| entry(e.path(), &m)))
            .filter(|f| !media_only || matches!(f.kind.as_str(), "video" | "audio" | "image"))
            .filter(|f| since.map(|s| f.modified > s).unwrap_or(true))
            .filter(|f| !f.name.ends_with(".part") && !f.name.ends_with(".ytdl"))
            .take(20000)
            .collect();
        v.sort_by_key(|x| std::cmp::Reverse(x.modified));
        Ok(v)
    })
    .await
    .map_err(|e| AppError::Msg(e.to_string()))?
}

#[tauri::command(async)]
pub fn list_dir(dir: String) -> AppResult<Vec<FileEntry>> {
    let mut v = Vec::new();
    for e in std::fs::read_dir(&dir)?.flatten() {
        if let Ok(m) = e.metadata() {
            v.push(entry(&e.path(), &m));
        }
    }
    v.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(v)
}

#[derive(Serialize)]
pub struct SizeItem {
    name: String,
    path: String,
    size: u64,
    files: u64,
}

/// ขนาดของโฟลเดอร์ย่อยแต่ละตัว (สำหรับ treemap / หาโฟลเดอร์ใหญ่สุด)
#[tauri::command]
pub async fn folder_sizes(dir: String) -> AppResult<Vec<SizeItem>> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut out = Vec::new();
        let mut loose = SizeItem { name: "(ไฟล์ในโฟลเดอร์นี้)".into(), path: dir.clone(), size: 0, files: 0 };
        for e in std::fs::read_dir(&dir)?.flatten() {
            let p = e.path();
            let Ok(md) = e.metadata() else { continue };
            if md.is_dir() {
                let (mut size, mut files) = (0, 0);
                for f in walk(&p.to_string_lossy(), 32).filter(|f| f.file_type().is_file()) {
                    size += f.metadata().map(|m| m.len()).unwrap_or(0);
                    files += 1;
                }
                out.push(SizeItem { name: e.file_name().to_string_lossy().to_string(), path: p.to_string_lossy().to_string(), size, files });
            } else {
                loose.size += md.len();
                loose.files += 1;
            }
        }
        if loose.files > 0 {
            out.push(loose);
        }
        out.sort_by_key(|x| std::cmp::Reverse(x.size));
        Ok(out)
    })
    .await
    .map_err(|e| AppError::Msg(e.to_string()))?
}

fn hash_reader<D: sha2::Digest>(mut r: impl Read, limit: Option<u64>) -> std::io::Result<String> {
    let mut h = D::new();
    let mut buf = vec![0u8; 256 * 1024];
    let mut left = limit.unwrap_or(u64::MAX);
    while left > 0 {
        let cap = left.min(buf.len() as u64) as usize;
        let n = r.read(&mut buf[..cap])?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
        left -= n as u64;
    }
    Ok(hex::encode(h.finalize()))
}

/// หาไฟล์ซ้ำ: กรองขนาดเท่ากัน → hash 1MB แรก → hash ทั้งไฟล์ (SHA-256)
#[tauri::command]
pub async fn find_duplicates(dir: String, min_size: u64) -> AppResult<Vec<Vec<FileEntry>>> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut by_size: HashMap<u64, Vec<FileEntry>> = HashMap::new();
        for e in walk(&dir, 32).filter(|e| e.file_type().is_file()) {
            if let Ok(m) = e.metadata() {
                if m.len() >= min_size.max(1) {
                    by_size.entry(m.len()).or_default().push(entry(e.path(), &m));
                }
            }
        }
        let mut groups = Vec::new();
        for (_, files) in by_size.into_iter().filter(|(_, v)| v.len() > 1) {
            let mut by_head: HashMap<String, Vec<FileEntry>> = HashMap::new();
            for f in files {
                if let Ok(h) = File::open(&f.path).and_then(|r| hash_reader::<sha2::Sha256>(r, Some(1024 * 1024))) {
                    by_head.entry(h).or_default().push(f);
                }
            }
            for (_, cands) in by_head.into_iter().filter(|(_, v)| v.len() > 1) {
                let mut by_full: HashMap<String, Vec<FileEntry>> = HashMap::new();
                for f in cands {
                    if let Ok(h) = File::open(&f.path).and_then(|r| hash_reader::<sha2::Sha256>(BufReader::new(r), None)) {
                        by_full.entry(h).or_default().push(f);
                    }
                }
                groups.extend(by_full.into_values().filter(|v| v.len() > 1));
            }
        }
        groups.sort_by(|a, b| (b[0].size * b.len() as u64).cmp(&(a[0].size * a.len() as u64)));
        Ok(groups)
    })
    .await
    .map_err(|e| AppError::Msg(e.to_string()))?
}

#[tauri::command]
pub async fn find_large(dir: String, min_size: u64) -> AppResult<Vec<FileEntry>> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut v: Vec<FileEntry> = walk(&dir, 32)
            .filter(|e| e.file_type().is_file())
            .filter_map(|e| e.metadata().ok().filter(|m| m.len() >= min_size).map(|m| entry(e.path(), &m)))
            .collect();
        v.sort_by_key(|x| std::cmp::Reverse(x.size));
        v.truncate(500);
        Ok(v)
    })
    .await
    .map_err(|e| AppError::Msg(e.to_string()))?
}

#[tauri::command]
pub async fn find_empty_dirs(dir: String) -> AppResult<Vec<String>> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut v: Vec<String> = WalkDir::new(&dir)
            .min_depth(1)
            .contents_first(true)
            .into_iter()
            .filter_map(Result::ok)
            .filter(|e| e.file_type().is_dir())
            .filter(|e| std::fs::read_dir(e.path()).map(|mut r| r.next().is_none()).unwrap_or(false))
            .map(|e| e.path().to_string_lossy().to_string())
            .collect();
        v.sort();
        Ok(v)
    })
    .await
    .map_err(|e| AppError::Msg(e.to_string()))?
}

#[tauri::command(async)]
pub fn remove_empty_dirs(paths: Vec<String>) -> AppResult<usize> {
    let mut n = 0;
    for p in paths {
        // remove_dir ลบได้เฉพาะโฟลเดอร์ว่างเท่านั้น (ปลอดภัย)
        if std::fs::remove_dir(&p).is_ok() {
            n += 1;
        }
    }
    Ok(n)
}

fn unique_path(p: PathBuf) -> PathBuf {
    if !p.exists() {
        return p;
    }
    let stem = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let ext = p.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    let parent = p.parent().map(Path::to_path_buf).unwrap_or_default();
    (1..10000)
        .map(|i| parent.join(format!("{stem} ({i}){ext}")))
        .find(|c| !c.exists())
        .unwrap_or(p)
}

fn move_file(src: &Path, dst: PathBuf) -> std::io::Result<PathBuf> {
    let dst = unique_path(dst);
    if let Some(d) = dst.parent() {
        std::fs::create_dir_all(d)?;
    }
    if std::fs::rename(src, &dst).is_err() {
        // ต่างไดรฟ์ — คัดลอกแล้วลบ
        std::fs::copy(src, &dst)?;
        std::fs::remove_file(src)?;
    }
    Ok(dst)
}

#[tauri::command(async)]
pub fn move_files(paths: Vec<String>, dest: String, copy: bool) -> AppResult<Vec<String>> {
    std::fs::create_dir_all(&dest)?;
    let mut out = Vec::new();
    for p in paths {
        let src = PathBuf::from(&p);
        let name = src.file_name().ok_or_else(|| AppError::NotFound(p.clone()))?;
        let target = Path::new(&dest).join(name);
        let done = if copy {
            let t = unique_path(target);
            std::fs::copy(&src, &t)?;
            t
        } else {
            move_file(&src, target)?
        };
        out.push(done.to_string_lossy().to_string());
    }
    Ok(out)
}

/// ลบไฟล์ — ค่าเริ่มต้นย้ายไปถังขยะ (กู้คืนได้)
#[tauri::command(async)]
pub fn delete_files(paths: Vec<String>, permanent: bool) -> AppResult<usize> {
    if permanent {
        for p in &paths {
            let pb = Path::new(p);
            if pb.is_dir() {
                std::fs::remove_dir_all(pb)?;
            } else {
                std::fs::remove_file(pb)?;
            }
        }
    } else {
        trash::delete_all(&paths).map_err(|e| AppError::Msg(format!("ย้ายไปถังขยะไม่สำเร็จ: {e}")))?;
    }
    Ok(paths.len())
}

#[derive(Deserialize)]
pub struct RenamePair {
    from: String,
    to: String,
}

/// เปลี่ยนชื่อเป็นกลุ่ม (ชื่อใหม่คำนวณจากหน้าบ้าน: แพทเทิร์น/regex/ตัวนับ)
/// คืนพาธจริงหลังเปลี่ยนชื่อ ตามลำดับของ pairs (อาจมี " (1)" ถ้าชื่อชนกับไฟล์อื่น)
#[tauri::command(async)]
pub fn rename_files(pairs: Vec<RenamePair>) -> AppResult<Vec<String>> {
    let bad = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
    for p in &pairs {
        let name = Path::new(&p.to).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        if name.trim().is_empty() || name.chars().any(|c| bad.contains(&c)) {
            return msg(format!("ชื่อไฟล์ \"{name}\" ใช้ไม่ได้ (ห้ามมีอักขระ < > : \" / \\ | ? *)"));
        }
    }
    let mut out = Vec::with_capacity(pairs.len());
    for p in pairs {
        if p.from == p.to {
            out.push(p.from);
            continue;
        }
        let dst = if same_file_ignoring_case(&p.from, &p.to) {
            // เปลี่ยนแค่ตัวพิมพ์เล็ก/ใหญ่ (เช่น .JPG → .jpg) — Windows มองว่าเป็นไฟล์เดียวกัน
            // จึงห้ามใช้ unique_path ไม่งั้นจะได้ "ชื่อ (1).jpg"
            PathBuf::from(&p.to)
        } else {
            unique_path(PathBuf::from(&p.to))
        };
        std::fs::rename(&p.from, &dst)?;
        out.push(dst.to_string_lossy().to_string());
    }
    Ok(out)
}

fn same_file_ignoring_case(a: &str, b: &str) -> bool {
    a.to_lowercase() == b.to_lowercase()
}

/// จัดเรียงไฟล์อัตโนมัติ: by = date | ext | size | kind
#[tauri::command]
pub async fn organize_files(dir: String, by: String) -> AppResult<usize> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut n = 0;
        for e in std::fs::read_dir(&dir)?.flatten() {
            let p = e.path();
            let Ok(md) = e.metadata() else { continue };
            if !md.is_file() {
                continue;
            }
            let f = entry(&p, &md);
            // ไฟล์ที่ yt-dlp กำลังโหลดอยู่ — ย้ายแล้วงานโหลดจะพัง
            if [".part", ".ytdl", ".temp"].iter().any(|s| f.name.ends_with(s)) || f.name.contains(".part-Frag") {
                continue;
            }
            let folder = match by.as_str() {
                "date" => chrono::DateTime::from_timestamp_millis(f.modified)
                    .map(|d| d.with_timezone(&chrono::Local).format("%Y-%m").to_string())
                    .unwrap_or_else(|| "ไม่ทราบวันที่".into()),
                "ext" => if f.ext.is_empty() { "ไม่มีนามสกุล".into() } else { f.ext.to_uppercase() },
                "size" => match f.size {
                    s if s < 10 << 20 => "เล็ก (ต่ำกว่า 10MB)".into(),
                    s if s < 100 << 20 => "กลาง (10-100MB)".into(),
                    s if s < 1 << 30 => "ใหญ่ (100MB-1GB)".into(),
                    _ => "ใหญ่มาก (เกิน 1GB)".into(),
                },
                _ => match f.kind.as_str() {
                    "video" => "วิดีโอ",
                    "audio" => "เสียง",
                    "image" => "รูปภาพ",
                    "document" => "เอกสาร",
                    "archive" => "ไฟล์บีบอัด",
                    _ => "อื่น ๆ",
                }
                .into(),
            };
            move_file(&p, Path::new(&dir).join(folder).join(&f.name))?;
            n += 1;
        }
        Ok(n)
    })
    .await
    .map_err(|e| AppError::Msg(e.to_string()))?
}

#[tauri::command]
pub async fn hash_file(path: String, algo: String) -> AppResult<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let r = BufReader::new(File::open(&path)?);
        Ok(match algo.to_lowercase().as_str() {
            "md5" => hash_reader::<md5::Md5>(r, None)?,
            "sha1" => hash_reader::<sha1::Sha1>(r, None)?,
            "sha512" => hash_reader::<sha2::Sha512>(r, None)?,
            _ => hash_reader::<sha2::Sha256>(r, None)?,
        })
    })
    .await
    .map_err(|e| AppError::Msg(e.to_string()))?
}

/// บีบไฟล์/โฟลเดอร์เป็น ZIP (รองรับชื่อไทยด้วย UTF-8)
#[tauri::command]
pub async fn zip_files(paths: Vec<String>, dest: String) -> AppResult<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut zw = zip::ZipWriter::new(BufWriter::new(File::create(&dest)?));
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .large_file(true);
        for p in &paths {
            let base = Path::new(p);
            let parent = base.parent().unwrap_or(Path::new(""));
            for e in WalkDir::new(base).into_iter().filter_map(Result::ok) {
                let rel = e.path().strip_prefix(parent).unwrap_or(e.path()).to_string_lossy().replace('\\', "/");
                if e.file_type().is_dir() {
                    zw.add_directory(format!("{rel}/"), opts)?;
                } else {
                    zw.start_file(rel, opts)?;
                    std::io::copy(&mut File::open(e.path())?, &mut zw)?;
                }
            }
        }
        zw.finish()?;
        Ok(dest)
    })
    .await
    .map_err(|e| AppError::Msg(e.to_string()))?
}

fn tar_exe() -> PathBuf {
    // Windows 10+ มี tar.exe (libarchive) ที่แตก zip/7z/rar/tar ได้
    let sys = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
    let p = Path::new(&sys).join("System32").join("tar.exe");
    if p.is_file() { p } else { PathBuf::from("tar") }
}

/// แตกไฟล์ ZIP/7z/RAR/TAR
#[tauri::command]
pub async fn extract_archive(src: String, dest: String, password: Option<String>) -> AppResult<String> {
    std::fs::create_dir_all(&dest)?;
    let lower = src.to_lowercase();
    if lower.ends_with(".zip") {
        let d = dest.clone();
        return tauri::async_runtime::spawn_blocking(move || {
            let mut z = zip::ZipArchive::new(BufReader::new(File::open(&src)?))?;
            z.extract(&d)?;
            Ok(d)
        })
        .await
        .map_err(|e| AppError::Msg(e.to_string()))?;
    }
    if lower.ends_with(".7z") {
        // tar ของ Windows ไม่รองรับ LZMA → ใช้ตัวแตก 7z ในตัว
        let d = dest.clone();
        return tauri::async_runtime::spawn_blocking(move || {
            let r = match password.filter(|p| !p.is_empty()) {
                Some(pw) => sevenz_rust2::decompress_file_with_password(&src, &d, pw.as_str().into()),
                None => sevenz_rust2::decompress_file(&src, &d),
            };
            r.map_err(|e| {
                let t = e.to_string();
                AppError::Msg(if t.to_lowercase().contains("password") { "ไฟล์ 7z นี้มีรหัสผ่าน — ใส่รหัสผ่านให้ถูกต้อง".into() } else { format!("แตกไฟล์ 7z ไม่สำเร็จ: {t}") })
            })?;
            Ok(d)
        })
        .await
        .map_err(|e| AppError::Msg(e.to_string()))?;
    }
    let out = crate::core::binaries::command(&tar_exe())
        .arg("-xf")
        .arg(&src)
        .arg("-C")
        .arg(&dest)
        .output()
        .await?;
    if !out.status.success() {
        return msg(format!("แตกไฟล์ไม่สำเร็จ: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    Ok(dest)
}

/// สร้างไฟล์ .tar / .tar.gz
#[tauri::command]
pub async fn create_tar(paths: Vec<String>, dest: String) -> AppResult<String> {
    if dest.to_lowercase().ends_with(".7z") {
        // สร้าง .7z (LZMA2) ในตัว — ไม่ต้องลง 7-Zip
        let d = dest.clone();
        return tauri::async_runtime::spawn_blocking(move || -> AppResult<String> {
            let err = |e: sevenz_rust2::Error| AppError::Msg(format!("สร้างไฟล์ 7z ไม่สำเร็จ: {e}"));
            // ใส่โฟลเดอร์พร้อมชื่อโฟลเดอร์ (แตกออกมาได้โครงสร้างเดิม)
            fn add(w: &mut sevenz_rust2::ArchiveWriter<File>, p: &Path, name: String) -> Result<(), sevenz_rust2::Error> {
                if p.is_dir() {
                    w.push_archive_entry::<File>(sevenz_rust2::ArchiveEntry::from_path(p, name.clone()), None)?;
                    for e in std::fs::read_dir(p)?.flatten() {
                        add(w, &e.path(), format!("{name}/{}", e.file_name().to_string_lossy()))?;
                    }
                } else {
                    w.push_archive_entry(sevenz_rust2::ArchiveEntry::from_path(p, name), Some(File::open(p)?))?;
                }
                Ok(())
            }
            let mut w = sevenz_rust2::ArchiveWriter::create(&d).map_err(err)?;
            for p in &paths {
                let pb = Path::new(p);
                add(&mut w, pb, pb.file_name().unwrap_or_default().to_string_lossy().to_string()).map_err(err)?;
            }
            w.finish().map_err(|e| AppError::Msg(format!("สร้างไฟล์ 7z ไม่สำเร็จ: {e}")))?;
            Ok(d)
        })
        .await
        .map_err(|e| AppError::Msg(e.to_string()))?;
    }
    let mut cmd = crate::core::binaries::command(&tar_exe());
    cmd.arg(if dest.to_lowercase().ends_with(".gz") { "-czf" } else { "-cf" }).arg(&dest);
    for p in &paths {
        let pb = Path::new(p);
        cmd.arg("-C").arg(pb.parent().unwrap_or(Path::new("."))).arg(pb.file_name().unwrap_or_default());
    }
    let out = cmd.output().await?;
    if !out.status.success() {
        return msg(format!("สร้างไฟล์ไม่สำเร็จ: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    Ok(dest)
}

/// แบ่งไฟล์เป็นส่วน ๆ (.001, .002, ...)
#[tauri::command]
pub async fn split_file(path: String, part_mb: u64) -> AppResult<Vec<String>> {
    if part_mb == 0 {
        return msg("ขนาดแต่ละส่วนต้องมากกว่า 0");
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut r = BufReader::new(File::open(&path)?);
        let part = part_mb * 1024 * 1024;
        let mut out = Vec::new();
        let mut buf = vec![0u8; 1024 * 1024];
        for i in 1.. {
            let name = format!("{path}.{i:03}");
            let mut w: Option<BufWriter<File>> = None;
            let mut written = 0u64;
            while written < part {
                let want = (part - written).min(buf.len() as u64) as usize;
                let n = r.read(&mut buf[..want])?;
                if n == 0 {
                    break;
                }
                if w.is_none() {
                    w = Some(BufWriter::new(File::create(&name)?));
                }
                w.as_mut().unwrap().write_all(&buf[..n])?;
                written += n as u64;
            }
            match w {
                Some(mut w) => {
                    w.flush()?;
                    out.push(name);
                }
                None => break,
            }
        }
        Ok(out)
    })
    .await
    .map_err(|e| AppError::Msg(e.to_string()))?
}

/// รวมไฟล์ที่แบ่งไว้ (เลือกไฟล์ .001)
#[tauri::command]
pub async fn join_files(first: String) -> AppResult<String> {
    let Some(base) = first.strip_suffix(".001").map(String::from) else {
        return msg("กรุณาเลือกไฟล์ส่วนแรกที่ลงท้ายด้วย .001");
    };
    tauri::async_runtime::spawn_blocking(move || {
        let dest = unique_path(PathBuf::from(&base));
        let mut w = BufWriter::new(File::create(&dest)?);
        for i in 1.. {
            let p = format!("{base}.{i:03}");
            if !Path::new(&p).is_file() {
                break;
            }
            std::io::copy(&mut File::open(&p)?, &mut w)?;
        }
        w.flush()?;
        Ok(dest.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| AppError::Msg(e.to_string()))?
}

#[tauri::command(async)]
pub fn read_text_file(path: String) -> AppResult<String> {
    let bytes = std::fs::read(&path)?;
    // รองรับไฟล์ซับไทยที่เป็น TIS-620/Windows-874 แบบง่าย ๆ
    match String::from_utf8(bytes.clone()) {
        Ok(s) => Ok(s.trim_start_matches('\u{feff}').to_string()),
        Err(_) => Ok(bytes
            .iter()
            .map(|&b| if (0xA1..=0xFB).contains(&b) { char::from_u32(0x0E00 + (b as u32 - 0xA0)).unwrap_or('?') } else { b as char })
            .collect()),
    }
}

#[tauri::command(async)]
pub fn write_text_file(path: String, content: String) -> AppResult<()> {
    if let Some(p) = Path::new(&path).parent() {
        std::fs::create_dir_all(p)?;
    }
    std::fs::write(path, content)?;
    Ok(())
}

#[tauri::command(async)]
pub fn write_base64_file(path: String, data: String) -> AppResult<()> {
    use base64::Engine;
    let raw = data.split_once("base64,").map(|(_, d)| d).unwrap_or(&data);
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(raw.trim())
        .map_err(|_| AppError::Msg("ข้อมูลรูปภาพไม่ถูกต้อง".into()))?;
    if let Some(p) = Path::new(&path).parent() {
        std::fs::create_dir_all(p)?;
    }
    std::fs::write(path, bytes)?;
    Ok(())
}

#[tauri::command(async)]
pub fn path_info(path: String) -> AppResult<FileEntry> {
    let md = std::fs::metadata(&path).map_err(|_| AppError::NotFound(path.clone()))?;
    Ok(entry(Path::new(&path), &md))
}

#[tauri::command(async)]
pub fn temp_dir(state: State<AppState>) -> AppResult<String> {
    let d = state.data_dir.join("temp");
    std::fs::create_dir_all(&d)?;
    Ok(d.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rename_case_only() {
        let d = std::env::temp_dir().join(format!("mtb-ren-{}", rand::random::<u32>()));
        std::fs::create_dir_all(&d).unwrap();
        let from = d.join("IMG_1.JPG");
        std::fs::write(&from, b"x").unwrap();
        let to = d.join("IMG_1.jpg");
        let out = rename_files(vec![RenamePair { from: from.to_string_lossy().into(), to: to.to_string_lossy().into() }]).unwrap();
        assert_eq!(out, vec![to.to_string_lossy().to_string()]);
        let names: Vec<String> = std::fs::read_dir(&d).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into()).collect();
        assert_eq!(names, vec!["IMG_1.jpg".to_string()]);
        std::fs::remove_dir_all(d).unwrap();
    }

    #[tokio::test]
    async fn split_join_zip_dupes() {
        let d = std::env::temp_dir().join(format!("mtb-files-{}", rand::random::<u32>()));
        std::fs::create_dir_all(d.join("ย่อย")).unwrap();
        let f = d.join("ข้อมูล.bin");
        let data: Vec<u8> = (0..(2 * 1024 * 1024 + 100)).map(|i| (i % 7) as u8).collect();
        std::fs::write(&f, &data).unwrap();
        std::fs::write(d.join("ย่อย").join("copy.bin"), &data).unwrap();
        let parts = split_file(f.to_string_lossy().to_string(), 1).await.unwrap();
        assert_eq!(parts.len(), 3);
        std::fs::rename(&f, d.join("orig.bin")).unwrap();
        let joined = join_files(parts[0].clone()).await.unwrap();
        assert_eq!(std::fs::read(&joined).unwrap(), data);
        let dup = find_duplicates(d.to_string_lossy().to_string(), 1).await.unwrap();
        assert_eq!(dup.len(), 1);
        assert_eq!(dup[0].len(), 3);
        let z = d.join("out.zip").to_string_lossy().to_string();
        zip_files(vec![d.join("ย่อย").to_string_lossy().to_string()], z.clone()).await.unwrap();
        let ex = extract_archive(z, d.join("ex").to_string_lossy().to_string(), None).await.unwrap();
        assert!(Path::new(&ex).join("ย่อย").join("copy.bin").is_file());
        // 7z: สร้างจากโฟลเดอร์ + ไฟล์ แล้วแตกกลับ
        let z7 = d.join("out.7z").to_string_lossy().to_string();
        create_tar(vec![d.join("ย่อย").to_string_lossy().to_string(), d.join("orig.bin").to_string_lossy().to_string()], z7.clone()).await.unwrap();
        assert!(std::fs::metadata(&z7).unwrap().len() < 100_000);
        let ex7 = extract_archive(z7, d.join("ex7").to_string_lossy().to_string(), None).await.unwrap();
        assert_eq!(std::fs::read(Path::new(&ex7).join("orig.bin")).unwrap(), data);
        assert!(Path::new(&ex7).join("ย่อย").join("copy.bin").is_file());
        let h = hash_file(joined.clone(), "md5".into()).await.unwrap();
        assert_eq!(h.len(), 32);
        std::fs::create_dir_all(d.join("ว่าง")).unwrap();
        let empty = find_empty_dirs(d.to_string_lossy().to_string()).await.unwrap();
        assert_eq!(empty.len(), 1);
        std::fs::remove_dir_all(d).unwrap();
    }
}
