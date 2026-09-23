//! อัดหน้าจอ / กล้อง พร้อมเสียงในเครื่อง (WASAPI loopback) และไมค์
//!
//! ภาพ: ffmpeg ddagrab (Desktop Duplication — ใช้การ์ดจอ เบาเครื่อง) ถ้าใช้ไม่ได้ถอยไป gdigrab
//! เสียง: จับด้วย cpal แล้วส่ง PCM float ให้ ffmpeg ตัวเดียวกันผ่าน TCP ในเครื่อง
//! → ffmpeg ประทับเวลาเสียง/ภาพเอง ไม่ต้องมาต่อไฟล์ทีหลัง ภาพกับเสียงจึงตรงกัน
//! ช่วงที่เครื่องเงียบ WASAPI จะไม่ส่งข้อมูลมา เราจึงเติมความเงียบตามเวลาจริงให้เสียงไม่หด
use crate::core::binaries;
use crate::error::{AppError, AppResult};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordOptions {
    /// screen | camera | both
    pub source: String,
    pub fps: u32,
    /// จอที่จะอัด (0 = จอหลัก)
    #[serde(default)]
    pub monitor: u32,
    /// อัดบางส่วน: [x, y, w, h] (พิกัดในจอนั้น)
    #[serde(default)]
    pub region: Option<[i32; 4]>,
    /// ตำแหน่ง/ขนาดของจอนั้นบนเดสก์ท็อปรวม [x, y, w, h] — ใช้ตอนถอยไป gdigrab (ใช้พิกัดรวมทุกจอ)
    #[serde(default)]
    pub monitor_rect: Option<[i32; 4]>,
    #[serde(default)]
    pub camera: String,
    /// เสียงที่ดังออกลำโพง (YouTube, เกม, ประชุม)
    #[serde(default)]
    pub system_audio: bool,
    /// ชื่อไมค์จาก rec_devices (ว่าง = ไม่อัดไมค์)
    #[serde(default)]
    pub mic: String,
    #[serde(default = "default_quality")]
    pub quality: String,
    #[serde(default)]
    pub draw_mouse: Option<bool>,
    pub output: String,
}

fn default_quality() -> String {
    "normal".into()
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RecordStatus {
    pub recording: bool,
    pub seconds: f64,
    pub output: String,
    pub capture: String,
    pub audio: Vec<String>,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDevices {
    pub mics: Vec<String>,
    pub default_mic: String,
    pub speaker: String,
}

struct AudioTap {
    label: String,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

struct Recording {
    child: Child,
    started: Instant,
    temp: PathBuf,
    output: String,
    capture: String,
    taps: Vec<AudioTap>,
    log: Arc<Mutex<Vec<String>>>,
}

static CURRENT: Mutex<Option<Recording>> = Mutex::new(None);

pub fn devices() -> AudioDevices {
    let host = cpal::default_host();
    let mics = host
        .input_devices()
        .map(|it| it.filter_map(|d| d.description().ok().map(|x| x.name().to_string())).collect())
        .unwrap_or_default();
    let default_mic = host.default_input_device().and_then(|d| d.description().ok().map(|x| x.name().to_string())).unwrap_or_default();
    let speaker = host.default_output_device().and_then(|d| d.description().ok().map(|x| x.name().to_string())).unwrap_or_default();
    AudioDevices { mics, default_mic, speaker }
}

/// รูปแบบเสียงที่อุปกรณ์ส่งมา (ffmpeg ต้องรู้เพื่ออ่าน PCM ดิบ)
struct PcmFormat {
    rate: u32,
    channels: u16,
}

/// เปิดการจับเสียงหนึ่งแหล่ง แล้วส่งไป ffmpeg ที่พอร์ตนี้ — คืน (ป้ายชื่อ, format) ทันทีที่เปิดอุปกรณ์ได้
fn open_tap(loopback: bool, mic: &str, port: u16) -> AppResult<(AudioTap, PcmFormat)> {
    let host = cpal::default_host();
    let device = if loopback {
        host.default_output_device().ok_or_else(|| AppError::Msg("ไม่พบลำโพง/อุปกรณ์เสียงออก".into()))?
    } else {
        host.input_devices()
            .ok()
            .and_then(|mut it| it.find(|d| d.description().map(|x| x.name() == mic).unwrap_or(false)))
            .or_else(|| host.default_input_device())
            .ok_or_else(|| AppError::Msg("ไม่พบไมโครโฟน".into()))?
    };
    let label = device.description().map(|x| x.name().to_string()).unwrap_or_default();
    let cfg = if loopback { device.default_output_config() } else { device.default_input_config() }
        .map_err(|e| AppError::Msg(format!("เปิดอุปกรณ์เสียงไม่ได้: {e}")))?;
    let fmt = PcmFormat { rate: cfg.sample_rate(), channels: cfg.channels() };
    let (rate, ch) = (fmt.rate, fmt.channels);
    let stop = Arc::new(AtomicBool::new(false));
    let stop2 = stop.clone();
    // ตัวเล่นเสียงของ cpal ต้องอยู่ในเธรดที่สร้างมัน — ทำทุกอย่างในเธรดนี้
    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<(), String>>();
    let thread = std::thread::spawn(move || {
        let buf: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::with_capacity(48000)));
        let b2 = buf.clone();
        let sample_format = cfg.sample_format();
        let config: cpal::StreamConfig = cfg.into();
        macro_rules! build {
            ($t:ty) => {
                device.build_input_stream(
                    config.clone(),
                    move |data: &[$t], _: &_| {
                        let mut b = b2.lock().unwrap();
                        b.extend(data.iter().map(|s| cpal::Sample::to_sample::<f32>(*s)));
                    },
                    |_| {},
                    None,
                )
            };
        }
        let stream = match sample_format {
            cpal::SampleFormat::F32 => build!(f32),
            cpal::SampleFormat::I16 => build!(i16),
            cpal::SampleFormat::I32 => build!(i32),
            cpal::SampleFormat::U16 => build!(u16),
            cpal::SampleFormat::U8 => build!(u8),
            other => {
                let _ = ready_tx.send(Err(format!("รูปแบบเสียง {other:?} ยังไม่รองรับ")));
                return;
            }
        };
        let stream = match stream {
            Ok(s) => s,
            Err(e) => {
                let _ = ready_tx.send(Err(format!("เปิดอุปกรณ์เสียงไม่ได้: {e}")));
                return;
            }
        };
        // ffmpeg เปิดพอร์ตรอไว้แล้ว (listen) — ลองต่อสักพัก
        let mut sock = None;
        let deadline = Instant::now() + Duration::from_secs(15);
        while Instant::now() < deadline && !stop2.load(Ordering::Relaxed) {
            if let Ok(s) = TcpStream::connect(("127.0.0.1", port)) {
                sock = Some(s);
                break;
            }
            std::thread::sleep(Duration::from_millis(40));
        }
        let Some(mut sock) = sock else {
            let _ = ready_tx.send(Err("ต่อกับ ffmpeg ไม่ได้".into()));
            return;
        };
        let _ = sock.set_nodelay(true);
        // ffmpeg ค้าง/ไม่อ่าน → อย่าให้เธรดนี้ค้างตาม
        let _ = sock.set_write_timeout(Some(Duration::from_secs(3)));
        if stream.play().is_err() {
            let _ = ready_tx.send(Err("เริ่มจับเสียงไม่ได้".into()));
            return;
        }
        let _ = ready_tx.send(Ok(()));
        let t0 = Instant::now();
        let per_sec = rate as f64 * ch as f64;
        let mut written: u64 = 0;
        let mut out: Vec<u8> = Vec::with_capacity(64 * 1024);
        while !stop2.load(Ordering::Relaxed) {
            std::thread::sleep(Duration::from_millis(20));
            let chunk: Vec<f32> = std::mem::take(&mut *buf.lock().unwrap());
            out.clear();
            if chunk.is_empty() {
                // เงียบ → เติม 0 ให้ทันเวลาจริง (เว้นไว้ 60ms เผื่อข้อมูลมาช้า)
                let due = ((t0.elapsed().as_secs_f64() - 0.06).max(0.0) * per_sec) as u64;
                let due = due - due % ch as u64;
                if due > written {
                    out.resize(((due - written) * 4) as usize, 0);
                    written = due;
                }
            } else {
                written += chunk.len() as u64;
                for s in chunk {
                    out.extend_from_slice(&s.to_le_bytes());
                }
            }
            if !out.is_empty() && sock.write_all(&out).is_err() {
                break; // ffmpeg ปิดแล้ว
            }
        }
        drop(stream);
        let _ = sock.shutdown(std::net::Shutdown::Both);
    });
    match ready_rx.recv_timeout(Duration::from_secs(20)) {
        Ok(Ok(())) => Ok((AudioTap { label, stop, thread: Some(thread) }, fmt)),
        Ok(Err(e)) => Err(AppError::Msg(e)),
        Err(_) => {
            stop.store(true, Ordering::Relaxed);
            Err(AppError::Msg("อุปกรณ์เสียงไม่ตอบสนอง".into()))
        }
    }
}

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0").and_then(|l| l.local_addr()).map(|a| a.port()).unwrap_or(49321)
}

fn video_inputs(o: &RecordOptions, dda: bool) -> Vec<String> {
    let fps = o.fps.clamp(5, 60).to_string();
    let mouse = o.draw_mouse.unwrap_or(true);
    let mut a: Vec<String> = Vec::new();
    let screen = o.source != "camera";
    if screen {
        if dda {
            let mut g = format!("ddagrab=output_idx={}:framerate={fps}:draw_mouse={}", o.monitor, if mouse { 1 } else { 0 });
            if let Some([x, y, w, h]) = o.region {
                g += &format!(":offset_x={x}:offset_y={y}:video_size={}x{}", w - w % 2, h - h % 2);
            }
            a.extend(["-f".into(), "lavfi".into(), "-i".into(), format!("{g},hwdownload,format=bgra")]);
        } else {
            a.extend(["-f", "gdigrab", "-framerate", &fps, "-draw_mouse", if mouse { "1" } else { "0" }].map(String::from));
            let [mx, my, mw, mh] = o.monitor_rect.unwrap_or([0, 0, 0, 0]);
            let rect = match o.region {
                Some([x, y, w, h]) => Some([mx + x, my + y, w, h]),
                None if mw > 0 && o.monitor > 0 => Some([mx, my, mw, mh]),
                None => None,
            };
            if let Some([x, y, w, h]) = rect {
                a.extend(["-offset_x".into(), x.to_string(), "-offset_y".into(), y.to_string(), "-video_size".into(), format!("{}x{}", w - w % 2, h - h % 2)]);
            }
            a.extend(["-i".into(), "desktop".into()]);
        }
    }
    if o.source != "screen" {
        a.extend(["-thread_queue_size", "512", "-f", "dshow", "-rtbufsize", "256M", "-i"].map(String::from));
        a.push(format!("video={}", o.camera));
    }
    a
}

/// เริ่มอัด — คืนสถานะทันทีเมื่อ ffmpeg เริ่มเขียนไฟล์ได้
pub fn start(ffmpeg: &Path, o: RecordOptions) -> AppResult<RecordStatus> {
    if CURRENT.lock().unwrap().is_some() {
        return Err(AppError::Msg("กำลังอัดอยู่แล้ว — กดหยุดก่อน".into()));
    }
    if o.source != "screen" && o.camera.trim().is_empty() {
        return Err(AppError::Msg("ยังไม่ได้เลือกกล้อง".into()));
    }
    if let Some(d) = Path::new(&o.output).parent() {
        std::fs::create_dir_all(d)?;
    }
    let temp = Path::new(&o.output).with_extension("rec.mkv");
    let mut last_err = String::new();
    // ลอง ddagrab ก่อน (เร็ว เบา) — ถ้าเครื่องไม่รองรับ (Remote Desktop, ไดรเวอร์เก่า) ใช้ gdigrab
    for dda in [true, false] {
        if !dda && o.source == "camera" {
            break;
        }
        match try_start(ffmpeg, &o, dda, &temp) {
            Ok(rec) => {
                let st = status_of(&rec);
                *CURRENT.lock().unwrap() = Some(rec);
                return Ok(st);
            }
            Err(e) => {
                eprintln!("recorder: {} ล้มเหลว: {e}", if dda { "ddagrab" } else { "gdigrab" });
                last_err = e
            }
        }
    }
    Err(AppError::Msg(format!("เริ่มอัดไม่สำเร็จ: {last_err}")))
}

fn try_start(ffmpeg: &Path, o: &RecordOptions, dda: bool, temp: &Path) -> Result<Recording, String> {
    let mut args: Vec<String> = vec!["-hide_banner".into(), "-y".into(), "-loglevel".into(), "warning".into(), "-stats".into()];
    // เปิดแหล่งเสียงก่อน เพื่อรู้ sample rate / channels
    let mut taps: Vec<(bool, u16)> = Vec::new(); // (loopback, port)
    if o.system_audio {
        taps.push((true, free_port()));
    }
    if !o.mic.trim().is_empty() {
        taps.push((false, free_port()));
    }
    // ต้องรู้ format ก่อนสั่ง ffmpeg จึงถามอุปกรณ์ก่อน (ไม่ต้องเปิด stream)
    let host = cpal::default_host();
    let mut audio_fmt: Vec<(bool, u16, u32, u16)> = Vec::new();
    for (lb, port) in &taps {
        let dev = if *lb {
            host.default_output_device()
        } else {
            host.input_devices().ok().and_then(|mut it| it.find(|d| d.description().map(|x| x.name() == o.mic).unwrap_or(false))).or_else(|| host.default_input_device())
        };
        let cfg = dev.and_then(|d| if *lb { d.default_output_config().ok() } else { d.default_input_config().ok() });
        if let Some(c) = cfg {
            audio_fmt.push((*lb, *port, c.sample_rate(), c.channels()));
        }
    }
    for (_, port, rate, ch) in &audio_fmt {
        args.extend(["-thread_queue_size", "4096", "-f", "f32le"].map(String::from));
        args.extend(["-ar".into(), rate.to_string(), "-ac".into(), ch.to_string(), "-i".into(), format!("tcp://127.0.0.1:{port}?listen=1&listen_timeout=20000")]);
    }
    // ภาพต้องเปิดหลังเสียง: ddagrab จะรอจนจอขยับครั้งแรก ถ้าเปิดก่อน ช่องเสียงจะรอต่อไม่ทัน
    let v0 = audio_fmt.len();
    args.extend(video_inputs(o, dda));
    // รวมภาพ + เสียง
    let mut filters: Vec<String> = Vec::new();
    let vmap = if o.source == "both" {
        filters.push(format!("[{}:v]scale=360:-2[cam];[{v0}:v][cam]overlay=W-w-24:H-h-24,format=yuv420p[v]", v0 + 1));
        "[v]".to_string()
    } else {
        filters.push(format!("[{v0}:v]scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p[v]"));
        "[v]".to_string()
    };
    let amap = match audio_fmt.len() {
        0 => None,
        1 => Some("0:a".into()),
        n => {
            let ins: String = (0..n).map(|i| format!("[{i}:a]")).collect();
            filters.push(format!("{ins}amix=inputs={n}:duration=longest:normalize=0[a]"));
            Some("[a]".into())
        }
    };
    args.extend(["-filter_complex".into(), filters.join(";"), "-map".into(), vmap]);
    if let Some(a) = amap {
        args.extend(["-map".into(), a, "-c:a".into(), "aac".into(), "-b:a".into(), "192k".into()]);
    }
    let crf = match o.quality.as_str() {
        "high" => "18",
        "small" => "28",
        _ => "23",
    };
    // ultrafast ใช้ CPU น้อยสุด ไฟล์ใหญ่หน่อย — ตอนหยุดจะบีบให้เป็น mp4 แบบ copy เร็ว ๆ
    // ddagrab ส่งเฟรมเฉพาะตอนจอเปลี่ยน → ทำเป็นเฟรมเรตคงที่ ให้โปรแกรมตัดต่อ/มือถือเปิดได้ทุกตัว
    args.extend(["-fps_mode".into(), "cfr".into(), "-r".into(), o.fps.clamp(5, 60).to_string()]);
    args.extend(["-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency", "-crf", crf].map(String::from));
    args.push(temp.to_string_lossy().to_string());

    let mut cmd = binaries::std_command(&ffmpeg.to_path_buf());
    cmd.args(&args).stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let log = Arc::new(Mutex::new(Vec::<String>::new()));
    if let Some(err) = child.stderr.take() {
        let l2 = log.clone();
        std::thread::spawn(move || {
            let r = BufReader::new(err);
            for line in r.split(b'\r').flatten() {
                let s = String::from_utf8_lossy(&line).trim().to_string();
                if !s.is_empty() {
                    let mut v = l2.lock().unwrap();
                    v.push(s);
                    if v.len() > 40 {
                        v.remove(0);
                    }
                }
            }
        });
    }
    // ต่อเสียง
    let mut opened: Vec<AudioTap> = Vec::new();
    for (lb, port, _, _) in &audio_fmt {
        match open_tap(*lb, &o.mic, *port) {
            Ok((t, _)) => opened.push(t),
            Err(e) => {
                let _ = child.kill();
                stop_taps(&mut opened);
                return Err(e.to_string());
            }
        }
    }
    // รอให้ ffmpeg เริ่มเขียนเฟรมแรก หรือจบเพราะ error
    let t0 = Instant::now();
    let mut nudged = Instant::now();
    loop {
        // ddagrab รอจนจอเปลี่ยนก่อนถึงจะเริ่ม — สั่งวาดจอใหม่ให้เริ่มทันทีแม้จอนิ่ง
        if dda && nudged.elapsed() > Duration::from_millis(600) {
            nudge_screen();
            nudged = Instant::now();
        }
        if let Ok(Some(_)) = child.try_wait() {
            stop_taps(&mut opened);
            let tail = log.lock().unwrap().iter().rev().take(3).cloned().collect::<Vec<_>>().join(" | ");
            return Err(tail);
        }
        if log.lock().unwrap().iter().any(|l| l.starts_with("frame=") && !l.starts_with("frame=    0")) {
            break;
        }
        if dda && t0.elapsed() > Duration::from_secs(8) {
            // การ์ดจอไม่ส่งภาพมา (เช่น Remote Desktop) → ให้ไปใช้ gdigrab แทน
            let _ = child.kill();
            let _ = child.wait();
            stop_taps(&mut opened);
            return Err("ddagrab ไม่ส่งภาพ".into());
        }
        if t0.elapsed() > Duration::from_secs(12) {
            break; // ยังไม่เห็นเฟรมแต่ process ยังอยู่ — ถือว่าเริ่มแล้ว
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Ok(Recording {
        child,
        started: Instant::now(),
        temp: temp.to_path_buf(),
        output: o.output.clone(),
        capture: if o.source == "camera" { "กล้อง".into() } else if dda { "ddagrab (การ์ดจอ)".into() } else { "gdigrab".into() },
        taps: opened,
        log,
    })
}

#[cfg(windows)]
fn nudge_screen() {
    use windows_sys::Win32::Graphics::Gdi::{RedrawWindow, RDW_ALLCHILDREN, RDW_INVALIDATE, RDW_UPDATENOW};
    // null = ทั้งเดสก์ท็อป
    unsafe {
        RedrawWindow(std::ptr::null_mut(), std::ptr::null(), std::ptr::null_mut(), RDW_INVALIDATE | RDW_ALLCHILDREN | RDW_UPDATENOW);
    }
}
#[cfg(not(windows))]
fn nudge_screen() {}

fn stop_taps(taps: &mut [AudioTap]) {
    for t in taps.iter() {
        t.stop.store(true, Ordering::Relaxed);
    }
    for t in taps.iter_mut() {
        if let Some(h) = t.thread.take() {
            let _ = h.join();
        }
    }
}

fn status_of(r: &Recording) -> RecordStatus {
    RecordStatus {
        recording: true,
        seconds: r.started.elapsed().as_secs_f64(),
        output: r.output.clone(),
        capture: r.capture.clone(),
        audio: r.taps.iter().map(|t| t.label.clone()).collect(),
        size: std::fs::metadata(&r.temp).map(|m| m.len()).unwrap_or(0),
    }
}

pub fn status() -> RecordStatus {
    let mut g = CURRENT.lock().unwrap();
    if let Some(r) = g.as_mut() {
        // ffmpeg หลุดเอง (เช่น ถอดกล้อง) → ยังถือว่ามีไฟล์ค้าง ให้กดหยุดเพื่อเก็บไฟล์
        let mut st = status_of(r);
        if let Ok(Some(_)) = r.child.try_wait() {
            st.recording = false;
        }
        return st;
    }
    RecordStatus::default()
}

/// หยุดอัด แล้วแปลง .mkv ชั่วคราวเป็น .mp4 (copy ไม่เข้ารหัสใหม่) — คืนพาธไฟล์ผลลัพธ์
pub fn stop(ffmpeg: &Path) -> AppResult<(String, f64)> {
    let mut rec = CURRENT.lock().unwrap().take().ok_or_else(|| AppError::Msg("ไม่ได้อัดอยู่".into()))?;
    let secs = rec.started.elapsed().as_secs_f64();
    if let Some(mut i) = rec.child.stdin.take() {
        let _ = i.write_all(b"q");
        let _ = i.flush();
    }
    // ให้ ffmpeg ปิดไฟล์ให้เรียบร้อยก่อนตัดเสียง
    let t0 = Instant::now();
    while t0.elapsed() < Duration::from_secs(10) {
        if let Ok(Some(_)) = rec.child.try_wait() {
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    if rec.child.try_wait().ok().flatten().is_none() {
        let _ = rec.child.kill();
        let _ = rec.child.wait();
    }
    stop_taps(&mut rec.taps);
    if !rec.temp.is_file() {
        let tail = rec.log.lock().unwrap().iter().rev().take(3).cloned().collect::<Vec<_>>().join(" | ");
        return Err(AppError::Msg(format!("ไม่ได้ไฟล์ที่อัด: {tail}")));
    }
    let out = binaries::std_command(&ffmpeg.to_path_buf())
        .args(["-hide_banner", "-y", "-loglevel", "error", "-i"])
        .arg(&rec.temp)
        .args(["-c", "copy", "-movflags", "+faststart"])
        .arg(&rec.output)
        .output()?;
    if out.status.success() && Path::new(&rec.output).is_file() {
        let _ = std::fs::remove_file(&rec.temp);
        Ok((rec.output, secs))
    } else {
        // แปลงไม่ได้ก็ยังเก็บ .mkv ไว้ (เล่นได้ตามปกติ)
        let mkv = Path::new(&rec.output).with_extension("mkv");
        let _ = std::fs::rename(&rec.temp, &mkv);
        Ok((mkv.to_string_lossy().to_string(), secs))
    }
}

/// ปิดโปรแกรมระหว่างอัด → หยุดให้เรียบร้อย ไฟล์จะได้ไม่เสีย
pub fn stop_if_recording(ffmpeg: Option<PathBuf>) {
    if CURRENT.lock().unwrap().is_some() {
        if let Some(f) = ffmpeg {
            let _ = stop(&f);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// อัดจอจริง 4 วินาทีพร้อมเสียงในเครื่อง — รันเอง: cargo test --lib recorder -- --ignored
    #[test]
    #[ignore]
    fn record_screen_with_audio() {
        let ff = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bin").join("ffmpeg.exe");
        let out = std::env::temp_dir().join("mtb-rec-test.mp4");
        let st = start(&ff, RecordOptions {
            source: "screen".into(), fps: 30, monitor: 0, region: None, monitor_rect: None, camera: String::new(),
            system_audio: true, mic: String::new(), quality: "normal".into(), draw_mouse: None,
            output: out.to_string_lossy().to_string(),
        }).unwrap();
        println!("capture={} audio={:?}", st.capture, st.audio);
        std::thread::sleep(Duration::from_secs(4));
        let (p, secs) = stop(&ff).unwrap();
        println!("{p} {secs:.1}s {} bytes", std::fs::metadata(&p).unwrap().len());
        let probe = std::process::Command::new(ff.with_file_name("ffprobe.exe"))
            .args(["-v", "error", "-show_entries", "stream=codec_type,avg_frame_rate:format=duration", "-of", "compact"]).arg(&p).output().unwrap();
        let s = String::from_utf8_lossy(&probe.stdout).to_string();
        println!("{s}");
        assert!(s.contains("codec_type=video") && s.contains("codec_type=audio"));
    }
}
