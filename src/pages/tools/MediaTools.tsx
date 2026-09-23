// เครื่องมือกลุ่มมีเดีย (ใช้ ffmpeg / Web Audio)
import { useEffect, useState } from "react";
import { Circle, Camera, Play, Pause, Download } from "lucide-react";
import { DropZone, Field, Select, Slider, Toggle } from "@/components/ui";
import { JobList } from "@/components/JobList";
import { api, call, fileUrl, pickSave, revealPath } from "@/lib/api";
import { attempt, useApp } from "@/store/app";
import { AUDIO_EXT, IMAGE_EXT, SUB_EXT, VIDEO_EXT, basename, dirname, downloadText, extname, formatDuration, joinPath, localStamp, outputPath, parseTime, stem } from "@/lib/format";
import { convert, merge, parseAny, scale, shift, split, toAss, toSrt, toVtt, type Cue } from "@/lib/subtitle";
import { playSound } from "@/lib/sound";
import { probeSummary } from "../Converter";
import { grabDesktop, RegionPicker, type Rect } from "@/components/RegionPicker";

const MEDIA = [...VIDEO_EXT, ...AUDIO_EXT];
const outDir = () => joinPath(useApp.getState().settings?.downloadDir ?? "", "เครื่องมือ");
const stamp = () => localStamp();

function FileInput({ value, onChange, accept, label }: { value: string; onChange: (v: string) => void; accept: string[]; label?: string }) {
  return value ? (
    <div className="flex items-center gap-2 rounded-xl bg-fg/5 px-3 py-2 text-sm">
      <span className="flex-1 truncate">📄 {basename(value)}</span>
      <button className="btn btn-sm" onClick={() => onChange("")}>เปลี่ยน</button>
    </div>
  ) : (
    <DropZone onFiles={(p) => onChange(p[0])} accept={accept} multiple={false} label={label ?? "ลากไฟล์มาวาง"} compact />
  );
}

// ---------- อัดหน้าจอ ----------
type RecStatus = { recording: boolean; seconds: number; output: string; capture: string; audio: string[]; size: number };

export function ScreenRecorder() {
  const [source, setSource] = useState<"screen" | "camera" | "both">("screen");
  const [fps, setFps] = useState(30);
  const [quality, setQuality] = useState("normal");
  const [sysAudio, setSysAudio] = useState(true);
  const [useMic, setUseMic] = useState(false);
  const [mics, setMics] = useState<string[]>([]);
  const [cams, setCams] = useState<string[]>([]);
  const [cam, setCam] = useState("");
  const [mic, setMic] = useState("");
  const [speaker, setSpeaker] = useState("");
  const [monitors, setMonitors] = useState<{ label: string; x: number; y: number; w: number; h: number }[]>([]);
  const [picking, setPicking] = useState("");
  const [monitor, setMonitor] = useState(0);
  const [hide, setHide] = useState(true);
  const [region, setRegion] = useState({ on: false, x: 0, y: 0, w: 1280, h: 720 });
  const [st, setSt] = useState<RecStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    call<{ mics: string[]; defaultMic: string; speaker: string }>("rec_devices").then((d) => {
      setMics(d.mics);
      setMic((m) => m || d.defaultMic || d.mics[0] || "");
      setSpeaker(d.speaker);
    }).catch(() => {});
    // กล้องใช้ DirectShow (ffmpeg บอกรายชื่อใน stderr)
    call<string>("list_devices").then((text) => {
      const video = [...text.matchAll(/"([^"]+)"\s*\(video\)/g)].map((m) => m[1]);
      setCams(video);
      setCam((c) => c || video[0] || "");
    }).catch(() => {});
    import("@tauri-apps/api/window").then(({ availableMonitors, primaryMonitor }) =>
      Promise.all([availableMonitors(), primaryMonitor()]).then(([all, prim]) => {
        // ddagrab นับจอตามลำดับ DXGI: จอหลักมาก่อน
        const sorted = [...all].sort((a, b) => (a.name === prim?.name ? -1 : b.name === prim?.name ? 1 : 0));
        setMonitors(sorted.map((m, i) => ({ label: `จอ ${i + 1}${i === 0 ? " (หลัก)" : ""} — ${m.size.width}×${m.size.height}`, x: m.position.x, y: m.position.y, w: m.size.width, h: m.size.height })));
      }),
    ).catch(() => {});
    call<RecStatus>("rec_status").then((s) => s.recording && setSt(s)).catch(() => {});
  }, []);

  // อัปเดตเวลาทุกวินาทีเฉพาะตอนกำลังอัด
  useEffect(() => {
    if (!st?.recording) return;
    const t = setInterval(() => call<RecStatus>("rec_status").then((s) => setSt(s.output ? s : null)).catch(() => {}), 1000);
    return () => clearInterval(t);
  }, [st?.recording]);

  const start = async () => {
    setBusy(true);
    const output = joinPath(outDir(), `อัด${source === "camera" ? "กล้อง" : "หน้าจอ"}-${stamp()}.mp4`);
    const s = await attempt(() => call<RecStatus>("rec_start", {
      options: {
        source, fps, monitor, quality, camera: cam, output,
        systemAudio: sysAudio, mic: useMic ? mic : "",
        region: region.on && source !== "camera" ? [region.x, region.y, region.w, region.h] : null,
        monitorRect: monitors[monitor] ? [monitors[monitor].x, monitors[monitor].y, monitors[monitor].w, monitors[monitor].h] : null,
      },
    }));
    setBusy(false);
    if (s) {
      setSt(s);
      playSound("pop");
      if (hide) import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().minimize()).catch(() => {});
    }
  };

  // ลากเลือกพื้นที่: ภาพเดสก์ท็อปรวมเริ่มที่มุมซ้ายบนสุดของทุกจอ → แปลงเป็นพิกัดในจอที่กรอบนั้นอยู่
  const pickArea = async () => {
    const img = await attempt(() => grabDesktop());
    if (img) setPicking(img);
  };
  const onPicked = (r: Rect) => {
    setPicking("");
    const ox = monitors.length ? Math.min(...monitors.map((m) => m.x)) : 0;
    const oy = monitors.length ? Math.min(...monitors.map((m) => m.y)) : 0;
    const ax = r.x + ox;
    const ay = r.y + oy;
    const cx = ax + r.w / 2;
    const cy = ay + r.h / 2;
    let idx = monitors.findIndex((m) => cx >= m.x && cx < m.x + m.w && cy >= m.y && cy < m.y + m.h);
    if (idx < 0) idx = 0;
    const m = monitors[idx] ?? { x: 0, y: 0, w: 1e5, h: 1e5 };
    // กรอบต้องอยู่ในจอเดียว (ddagrab อัดข้ามจอไม่ได้)
    const x = Math.max(0, ax - m.x);
    const y = Math.max(0, ay - m.y);
    setMonitor(idx);
    setRegion({ on: true, x, y, w: Math.min(r.w, m.w - x), h: Math.min(r.h, m.h - y) });
  };

  const stop = async () => {
    setBusy(true);
    const path = await attempt(() => call<string>("rec_stop"));
    setBusy(false);
    setSt(null);
    if (path) {
      playSound("ding");
      useApp.getState().toast(`บันทึกแล้ว: ${basename(path)}`, "success");
      revealPath(path).catch(() => {});
    }
  };

  if (st?.recording || st?.output) {
    return (
      <div className="space-y-4 text-center">
        <div className="flex items-center justify-center gap-3 text-3xl font-mono">
          <span className={`h-4 w-4 rounded-full bg-red-500 ${st.recording ? "animate-pulse" : ""}`} />
          {formatDuration(st.seconds)}
        </div>
        <div className="text-sm text-fg/60">
          {st.recording ? "กำลังอัด" : "การอัดหยุดเอง (อุปกรณ์หลุด?) — กดหยุดเพื่อเก็บไฟล์"} · {st.capture} · {(st.size / 1048576).toFixed(1)} MB
          <br />🔊 {st.audio.length ? st.audio.join(" + ") : "ไม่อัดเสียง"}
        </div>
        <button className="btn-danger w-full py-3" disabled={busy} onClick={stop}>■ {busy ? "กำลังบันทึกไฟล์..." : "หยุดอัดและบันทึก"}</button>
        <p className="text-xs text-fg/50">ย่อโปรแกรมไว้ก็ได้ — หยุดได้จากไอคอนถาดระบบ (คลิกขวา → หยุดอัดหน้าจอ)</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {picking && <RegionPicker image={picking} onDone={onPicked} onCancel={() => setPicking("")} />}
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="แหล่งภาพ">
          <Select value={source} onChange={setSource} options={[{ value: "screen", label: "🖥️ หน้าจอ" }, { value: "camera", label: "📷 กล้อง" }, { value: "both", label: "🖥️+📷 จอ + กล้องมุมจอ" }]} />
        </Field>
        {source !== "camera" && monitors.length > 1 && (
          <Field label="จอที่จะอัด">
            <Select value={String(monitor)} onChange={(v) => setMonitor(Number(v))} options={monitors.map((m, i) => ({ value: String(i), label: m.label }))} />
          </Field>
        )}
        {source !== "screen" && (
          <Field label="กล้อง">
            <Select value={cam} onChange={setCam} options={cams.length ? cams : ["(ไม่พบกล้อง)"]} />
          </Field>
        )}
        <Field label="คุณภาพ">
          <Select value={quality} onChange={setQuality} options={[{ value: "high", label: "สูง (ไฟล์ใหญ่)" }, { value: "normal", label: "ปกติ" }, { value: "small", label: "ไฟล์เล็ก" }]} />
        </Field>
      </div>
      <Slider label="FPS" value={fps} min={10} max={60} step={5} onChange={setFps} />
      <Toggle label={`อัดเสียงในเครื่อง (เสียงที่ออกลำโพง${speaker ? `: ${speaker}` : ""})`} checked={sysAudio} onChange={setSysAudio} />
      <Toggle label="อัดเสียงไมค์ด้วย" checked={useMic} onChange={setUseMic} />
      {useMic && (
        <Field label="ไมโครโฟน">
          <Select value={mic} onChange={setMic} options={mics.length ? mics : ["(ไม่พบไมค์)"]} />
        </Field>
      )}
      {source !== "camera" && (
        <div className="flex items-center gap-2">
          <div className="flex-1"><Toggle label="อัดเฉพาะบางส่วนของจอ" checked={region.on} onChange={(v) => setRegion({ ...region, on: v })} /></div>
          <button className="btn btn-sm" onClick={pickArea}>✂️ ลากเลือกพื้นที่</button>
        </div>
      )}
      {region.on && source !== "camera" && (
        <div className="grid grid-cols-4 gap-2">
          {(["x", "y", "w", "h"] as const).map((k) => (
            <Field key={k} label={{ x: "X", y: "Y", w: "กว้าง", h: "สูง" }[k]}>
              <input type="number" className="input" value={region[k]} onChange={(e) => setRegion({ ...region, [k]: Number(e.target.value) })} />
            </Field>
          ))}
        </div>
      )}
      <Toggle label="ย่อโปรแกรมลงเมื่อเริ่มอัด" checked={hide} onChange={setHide} />
      <button className="btn-danger w-full py-2.5" disabled={busy} onClick={start}>
        <Circle size={16} fill="currentColor" /> {busy ? "กำลังเริ่ม..." : "เริ่มอัด"}
      </button>
      <p className="text-xs text-fg/50">ใช้การ์ดจอจับภาพ (ddagrab) ลื่น 30–60 fps กินเครื่องน้อย · ถ้าเครื่องไม่รองรับจะสลับเป็นโหมดธรรมดาให้เอง</p>
    </div>
  );
}

// ---------- จับภาพหน้าจอ ----------
export function ScreenCapture() {
  const [mode, setMode] = useState<"full" | "region" | "window">("full");
  const [delay, setDelay] = useState(0);
  const [title, setTitle] = useState("");
  const [windows, setWindows] = useState<string[]>([]);
  const [picking, setPicking] = useState("");
  const [last, setLast] = useState("");
  const loadWindows = () => call<string[]>("list_windows").then((w) => {
    setWindows(w);
    setTitle((t) => (w.includes(t) ? t : w[0] ?? ""));
  }).catch(() => {});
  useEffect(() => {
    if (mode === "window") loadWindows();
  }, [mode]);

  const done = (out: string) => {
    playSound("pop");
    setLast(out);
    useApp.getState().toast("📸 จับภาพแล้ว", "success");
  };
  const capture = async () => {
    const out = joinPath(outDir(), `ภาพหน้าจอ-${stamp()}.png`);
    if (delay) await new Promise((res) => setTimeout(res, delay * 1000));
    if (mode === "window") {
      const ok = await attempt(() => api.ffmpegExec(["-y", "-f", "gdigrab", "-i", `title=${title}`, "-frames:v", "1", "-update", "1", out]));
      if (ok !== undefined) done(out);
      return;
    }
    // ทั้งจอ / เลือกพื้นที่: ซ่อนโปรแกรมนี้ก่อนถ่าย จะได้ไม่ติดหน้าต่างเราเอง
    const img = await attempt(() => grabDesktop(mode === "full" ? out : undefined));
    if (!img) return;
    if (mode === "full") done(out);
    else setPicking(img);
  };
  const crop = async (r: Rect) => {
    const src = picking;
    setPicking("");
    const out = joinPath(outDir(), `ภาพหน้าจอ-${stamp()}.png`);
    const im = new Image();
    im.src = fileUrl(src);
    await im.decode();
    const c = document.createElement("canvas");
    c.width = r.w;
    c.height = r.h;
    c.getContext("2d")!.drawImage(im, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    const ok = await attempt(() => call("write_base64_file", { path: out, data: c.toDataURL("image/png").split(",")[1] }));
    if (ok !== undefined) done(out);
  };
  return (
    <div className="space-y-3">
      {picking && <RegionPicker image={picking} onDone={crop} onCancel={() => setPicking("")} />}
      <Field label="โหมด">
        <Select value={mode} onChange={setMode} options={[{ value: "full", label: "🖥️ ทั้งจอ (ทุกจอ)" }, { value: "region", label: "✂️ ลากเลือกพื้นที่" }, { value: "window", label: "🪟 เฉพาะหน้าต่าง" }]} />
      </Field>
      {mode === "window" && (
        <Field label="หน้าต่าง">
          <div className="flex gap-2">
            <div className="flex-1"><Select value={title} onChange={setTitle} options={windows.length ? windows : ["(ไม่พบหน้าต่าง)"]} /></div>
            <button className="btn btn-sm" onClick={loadWindows}>รีเฟรช</button>
          </div>
        </Field>
      )}
      <Slider label="หน่วงเวลา" value={delay} min={0} max={10} suffix=" วินาที" onChange={setDelay} />
      <button className="btn-primary w-full" onClick={capture}><Camera size={16} /> จับภาพ</button>
      {last && (
        <div>
          <img src={fileUrl(last)} className="max-h-80 rounded-xl" alt="" />
          <div className="mt-2 flex gap-2">
            <button className="btn btn-sm" onClick={() => revealPath(last)}>เปิดโฟลเดอร์</button>
            <button className="btn btn-sm" onClick={() => copyImage(last)}>คัดลอกภาพ</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** คัดลอกรูปลงคลิปบอร์ด (วางใน LINE/Discord/Word ได้ทันที) */
async function copyImage(path: string) {
  try {
    const blob = await fetch(fileUrl(path)).then((r) => r.blob());
    await navigator.clipboard.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]);
    useApp.getState().toast("คัดลอกภาพแล้ว", "success");
  } catch (e) {
    useApp.getState().toast(`คัดลอกไม่ได้: ${e}`, "error");
  }
}

// ---------- GIF ----------
export function GifMaker() {
  const [file, setFile] = useState("");
  const [start, setStart] = useState("0");
  const [len, setLen] = useState(5);
  const [width, setWidth] = useState(480);
  const [fps, setFps] = useState(12);
  const [loop, setLoop] = useState(true);
  const make = async () => {
    const out = outputPath(file, "gif");
    const vf = `fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=192[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4`;
    await attempt(() => api.ffmpegJob({ kind: "convert", title: `สร้าง GIF ${basename(file)}`, input: file, output: out, passes: [["-y", "-ss", String(parseTime(start)), "-t", String(len), "-i", file, "-vf", vf, "-loop", loop ? "0" : "-1", out]], duration: len }), "กำลังสร้าง GIF");
  };
  return (
    <div className="space-y-3">
      <FileInput value={file} onChange={setFile} accept={VIDEO_EXT} label="ลากวิดีโอมาวาง" />
      {file && <video src={fileUrl(file)} controls className="max-h-64 rounded-xl" onTimeUpdate={(e) => setStart(formatDuration(e.currentTarget.currentTime))} />}
      <div className="grid grid-cols-2 gap-3">
        <Field label="เริ่มที่ (เลื่อนวิดีโอเพื่อเลือก)"><input className="input font-mono" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Slider label="ความยาว" value={len} min={1} max={30} suffix=" วิ" onChange={setLen} />
        <Slider label="ความกว้าง" value={width} min={160} max={1080} step={20} suffix=" px" onChange={setWidth} />
        <Slider label="FPS" value={fps} min={5} max={30} onChange={setFps} />
      </div>
      <Toggle label="วนซ้ำไม่รู้จบ" checked={loop} onChange={setLoop} />
      <button className="btn-primary w-full" disabled={!file} onClick={make}>สร้าง GIF</button>
      <JobList kinds={["convert"]} empty="" />
    </div>
  );
}

// ---------- ดึงเฟรม ----------
export function FrameExtractor() {
  const [file, setFile] = useState("");
  const [mode, setMode] = useState<"interval" | "count" | "scene">("interval");
  const [every, setEvery] = useState(10);
  const [count, setCount] = useState(20);
  const [fmt, setFmt] = useState("jpg");
  const run = async () => {
    const dir = joinPath(dirname(file), `${stem(file)}_เฟรม`);
    const info = await probeSummary(file).catch(() => undefined);
    const dur = info?.duration ?? 0;
    const vf = mode === "interval" ? `fps=1/${every}` : mode === "count" ? `fps=${count}/${Math.max(1, dur)}` : "select='gt(scene,0.35)'";
    const extra = mode === "scene" ? ["-vsync", "vfr"] : [];
    await attempt(() => api.ffmpegJob({ kind: "convert", title: `ดึงเฟรม ${basename(file)}`, input: file, output: joinPath(dir, `เฟรม_%04d.${fmt}`), passes: [["-y", "-i", file, "-vf", vf, ...extra, "-q:v", "2", joinPath(dir, `เฟรม_%04d.${fmt}`)]], duration: dur }), `บันทึกไว้ที่ ${dir}`);
  };
  return (
    <div className="space-y-3">
      <FileInput value={file} onChange={setFile} accept={VIDEO_EXT} label="ลากวิดีโอมาวาง" />
      <Field label="วิธีดึง">
        <Select value={mode} onChange={setMode} options={[{ value: "interval", label: "ทุก ๆ N วินาที" }, { value: "count", label: "จำนวนภาพทั้งหมด" }, { value: "scene", label: "เมื่อเปลี่ยนฉาก (อัตโนมัติ)" }]} />
      </Field>
      {mode === "interval" && <Slider label="ทุก ๆ" value={every} min={1} max={120} suffix=" วินาที" onChange={setEvery} />}
      {mode === "count" && <Slider label="จำนวน" value={count} min={1} max={200} suffix=" ภาพ" onChange={setCount} />}
      <Field label="รูปแบบ"><Select value={fmt} onChange={setFmt} options={["jpg", "png", "webp"]} /></Field>
      <button className="btn-primary w-full" disabled={!file} onClick={run}>ดึงเฟรม</button>
      <JobList kinds={["convert"]} empty="" />
    </div>
  );
}

// ---------- สตอรีบอร์ด ----------
export function Storyboard() {
  const [file, setFile] = useState("");
  const [cols, setCols] = useState(4);
  const [rows, setRows] = useState(4);
  const [result, setResult] = useState("");
  const run = async () => {
    const info = await probeSummary(file).catch(() => undefined);
    const n = cols * rows;
    const out = outputPath(file, "jpg", "_สตอรีบอร์ด");
    const vf = `fps=${n}/${Math.max(1, info?.duration ?? 60)},scale=480:-2,drawtext=fontfile='C\\:/Windows/Fonts/tahoma.ttf':text='%{pts\\:hms}':x=8:y=h-th-8:fontsize=20:fontcolor=white:box=1:boxcolor=black@0.5,tile=${cols}x${rows}:padding=6:margin=6:color=0x111122`;
    const ok = await attempt(() => api.ffmpegExec(["-y", "-i", file, "-vf", vf, "-frames:v", "1", "-q:v", "3", out]), "สร้างสตอรีบอร์ดแล้ว");
    if (ok !== undefined) setResult(out + "?" + Date.now());
  };
  return (
    <div className="space-y-3">
      <FileInput value={file} onChange={setFile} accept={VIDEO_EXT} label="ลากวิดีโอมาวาง" />
      <div className="grid grid-cols-2 gap-3">
        <Slider label="คอลัมน์" value={cols} min={2} max={8} onChange={setCols} />
        <Slider label="แถว" value={rows} min={2} max={10} onChange={setRows} />
      </div>
      <button className="btn-primary w-full" disabled={!file} onClick={run}>สร้างสตอรีบอร์ด</button>
      {result && <img src={fileUrl(result.split("?")[0]) + "?" + result.split("?")[1]} className="rounded-xl" alt="" />}
    </div>
  );
}

// ---------- เสียง ----------
export function AudioBoost() {
  const [file, setFile] = useState("");
  const [db, setDb] = useState(6);
  const [limit, setLimit] = useState(true);
  const run = async () => {
    const out = outputPath(file, extname(file), `_ดังขึ้น${db}dB`);
    const af = `volume=${db}dB${limit ? ",alimiter=limit=0.95" : ""}`;
    const isVideo = VIDEO_EXT.includes(extname(file));
    await attempt(() => api.ffmpegJob({ kind: "convert", title: `เพิ่มเสียง ${db}dB ${basename(file)}`, input: file, output: out, passes: [["-y", "-i", file, "-af", af, ...(isVideo ? ["-c:v", "copy"] : []), out]] }), "กำลังประมวลผล");
  };
  return (
    <div className="space-y-3">
      <FileInput value={file} onChange={setFile} accept={MEDIA} />
      <Slider label="เพิ่มความดัง" value={db} min={1} max={30} suffix=" dB" onChange={setDb} />
      <Toggle label="กันเสียงแตก (limiter)" checked={limit} onChange={setLimit} />
      <button className="btn-primary w-full" disabled={!file} onClick={run}>เพิ่มความดัง</button>
      <JobList kinds={["convert"]} empty="" />
    </div>
  );
}

export function AudioLevel() {
  const [files, setFiles] = useState<string[]>([]);
  const [target, setTarget] = useState(-14);
  const [measure, setMeasure] = useState<Record<string, string>>({});
  const analyze = async (f: string) => {
    const out = await api.ffmpegExec(["-hide_banner", "-i", f, "-af", "volumedetect", "-vn", "-f", "null", "NUL"]).catch((e) => String(e));
    const m = /mean_volume:\s*(-?[\d.]+)/.exec(out)?.[1];
    const p = /max_volume:\s*(-?[\d.]+)/.exec(out)?.[1];
    setMeasure((x) => ({ ...x, [f]: m ? `เฉลี่ย ${m} dB · สูงสุด ${p} dB` : "วัดไม่ได้" }));
  };
  const run = async () => {
    for (const f of files) {
      const out = outputPath(f, extname(f), "_ปรับระดับ");
      const isVideo = VIDEO_EXT.includes(extname(f));
      await attempt(() => api.ffmpegJob({ kind: "convert", title: `ปรับระดับเสียง ${basename(f)}`, input: f, output: out, passes: [["-y", "-i", f, "-af", `loudnorm=I=${target}:TP=-1.5:LRA=11`, ...(isVideo ? ["-c:v", "copy"] : []), out]] }));
    }
  };
  return (
    <div className="space-y-3">
      <DropZone onFiles={(p) => { setFiles(p); p.forEach(analyze); }} accept={MEDIA} compact label="ลากไฟล์เสียง/วิดีโอหลายไฟล์มาวาง (ทุกไฟล์จะดังเท่ากัน)" />
      {files.map((f) => <div key={f} className="flex justify-between text-sm"><span className="truncate">{basename(f)}</span><span className="font-mono text-xs text-muted">{measure[f] ?? "กำลังวัด…"}</span></div>)}
      <Field label="ระดับเป้าหมาย (LUFS)">
        <Select value={String(target)} onChange={(v) => setTarget(Number(v))} options={[{ value: "-14", label: "-14 (YouTube / Spotify)" }, { value: "-16", label: "-16 (พอดแคสต์)" }, { value: "-23", label: "-23 (โทรทัศน์ EBU R128)" }]} />
      </Field>
      <button className="btn-primary w-full" disabled={!files.length} onClick={run}>ปรับระดับเสียง</button>
      <JobList kinds={["convert"]} empty="" />
    </div>
  );
}

/** ประมาณ BPM จากพลังงานเสียงช่วงต่ำ (autocorrelation) */
export function estimateBpm(data: Float32Array, rate: number): number {
  const hop = Math.floor(rate / 100); // 10ms
  const env: number[] = [];
  for (let i = 0; i + hop < data.length; i += hop) {
    let s = 0;
    for (let j = 0; j < hop; j++) s += data[i + j] * data[i + j];
    env.push(Math.sqrt(s / hop));
  }
  const diff = env.map((v, i) => Math.max(0, v - (env[i - 1] ?? 0)));
  let best = 0;
  let bestLag = 0;
  for (let bpm = 60; bpm <= 200; bpm++) {
    const lag = Math.round(6000 / bpm);
    let s = 0;
    for (let i = lag; i < diff.length; i++) s += diff[i] * diff[i - lag];
    if (s > best) {
      best = s;
      bestLag = lag;
    }
  }
  return bestLag ? Math.round((6000 / bestLag) * 10) / 10 : 0;
}

export function BpmDetector() {
  const [file, setFile] = useState("");
  const [bpm, setBpm] = useState<number | null>(null);
  const [taps, setTaps] = useState<number[]>([]);
  useEffect(() => {
    if (!file) return;
    setBpm(null);
    (async () => {
      const buf = await fetch(fileUrl(file)).then((r) => r.arrayBuffer());
      const ctx = new OfflineAudioContext(1, 44100 * 60, 11025);
      const audio = await ctx.decodeAudioData(buf);
      const ch = audio.getChannelData(0);
      const start = Math.floor(ch.length * 0.25);
      setBpm(estimateBpm(ch.subarray(start, start + audio.sampleRate * 30), audio.sampleRate));
    })().catch(() => setBpm(0));
  }, [file]);
  const tap = () => setTaps((t) => [...t.filter((x) => Date.now() - x < 3000), Date.now()].slice(-12));
  const tapBpm = taps.length > 2 ? Math.round(60000 / ((taps[taps.length - 1] - taps[0]) / (taps.length - 1))) : 0;
  return (
    <div className="space-y-4">
      <FileInput value={file} onChange={setFile} accept={AUDIO_EXT} label="ลากเพลงมาวาง" />
      {file && <div className="text-center"><div className="font-mono text-6xl gradient-text">{bpm === null ? "…" : bpm || "?"}</div><div className="text-muted">BPM (ประมาณ)</div></div>}
      <div className="divider pt-4 text-center">
        <p className="mb-2 text-sm text-muted">หรือเคาะตามจังหวะ</p>
        <button className="btn-primary h-24 w-24 rounded-full text-lg" onClick={tap}>TAP</button>
        <div className="mt-2 font-mono text-2xl">{tapBpm || "-"} BPM</div>
      </div>
    </div>
  );
}

export function Metronome() {
  const [bpm, setBpm] = useState(100);
  const [beats, setBeats] = useState(4);
  const [on, setOn] = useState(false);
  const [beat, setBeat] = useState(0);
  useEffect(() => {
    if (!on) return;
    let i = 0;
    const tick = () => {
      playSound(i % beats === 0 ? "tick" : "tock");
      setBeat(i % beats);
      i++;
    };
    tick();
    const t = setInterval(tick, 60000 / bpm);
    return () => clearInterval(t);
  }, [on, bpm, beats]);
  return (
    <div className="space-y-4 text-center">
      <div className="font-mono text-6xl gradient-text">{bpm}</div>
      <div className="flex justify-center gap-2">
        {Array.from({ length: beats }, (_, i) => (
          <div key={i} className={`h-6 w-6 rounded-full transition ${on && beat === i ? (i === 0 ? "bg-accent2 shadow-glow" : "bg-accent") : "bg-fg/10"}`} />
        ))}
      </div>
      <Slider label="BPM" value={bpm} min={30} max={250} onChange={setBpm} />
      <Slider label="จังหวะต่อห้อง" value={beats} min={1} max={12} onChange={setBeats} />
      <button className="btn-primary w-40" onClick={() => setOn(!on)}>{on ? <><Pause size={16} /> หยุด</> : <><Play size={16} /> เริ่ม</>}</button>
    </div>
  );
}

// ---------- ข้อมูลเมตา ----------
const META_KEYS = ["title", "artist", "album", "album_artist", "date", "genre", "track", "comment", "copyright", "description"];

export function MetadataEditor() {
  const [file, setFile] = useState("");
  const [tags, setTags] = useState<Record<string, string>>({});
  const [raw, setRaw] = useState<any>(null);
  const [cover, setCover] = useState("");
  useEffect(() => {
    if (!file) return;
    api.probe(file).then((p) => {
      setRaw(p);
      const t: Record<string, string> = {};
      for (const [k, v] of Object.entries<string>(p.format?.tags ?? {})) t[k.toLowerCase()] = v;
      setTags(t);
    }).catch((e) => useApp.getState().toast(String(e), "error"));
  }, [file]);
  const save = async () => {
    const out = outputPath(file, extname(file), "_แก้เมตา");
    const meta = Object.entries(tags).flatMap(([k, v]) => ["-metadata", `${k}=${v}`]);
    const isImg = IMAGE_EXT.includes(extname(file));
    const coverArgs = cover ? ["-i", cover, "-map", "0:a", "-map", "1:v", "-disposition:v", "attached_pic"] : ["-map", "0"];
    const args = isImg ? ["-y", "-i", file, ...meta, out] : ["-y", "-i", file, ...(cover ? coverArgs : ["-map", "0"]), "-c", "copy", ...meta, out];
    await attempt(() => api.ffmpegExec(args), `บันทึกเป็น ${basename(out)}`);
  };
  return (
    <div className="space-y-3">
      <FileInput value={file} onChange={setFile} accept={[...MEDIA, ...IMAGE_EXT]} />
      {raw && (
        <>
          <div className="grid gap-2 md:grid-cols-2">
            {[...new Set([...META_KEYS, ...Object.keys(tags)])].map((k) => (
              <Field key={k} label={k}>
                <input className="input" value={tags[k] ?? ""} onChange={(e) => setTags({ ...tags, [k]: e.target.value })} />
              </Field>
            ))}
          </div>
          {AUDIO_EXT.includes(extname(file)) && (
            <Field label="รูปปกอัลบั้ม (MP3/M4A)">
              <FileInput value={cover} onChange={setCover} accept={["jpg", "jpeg", "png"]} label="ลากรูปปกมาวาง" />
            </Field>
          )}
          <div className="flex gap-2">
            <button className="btn-primary flex-1" onClick={save}>บันทึกเป็นไฟล์ใหม่</button>
            <button className="btn" onClick={() => setTags({})}>ล้างทั้งหมด</button>
          </div>
          <details>
            <summary className="cursor-pointer text-sm text-muted">ข้อมูลเทคนิคทั้งหมด (EXIF / สตรีม)</summary>
            <pre className="selectable mt-2 max-h-80 overflow-auto rounded-lg bg-black/30 p-2 text-[11px]">{JSON.stringify(raw, null, 2)}</pre>
          </details>
        </>
      )}
    </div>
  );
}

// ---------- ซับไตเติ้ล ----------
export function SubtitleTools() {
  const [file, setFile] = useState("");
  const [cues, setCues] = useState<Cue[]>([]);
  const [second, setSecond] = useState<Cue[]>([]);
  const [offset, setOffset] = useState(0);
  const [factor, setFactor] = useState(1);
  const [splitAt, setSplitAt] = useState("");
  const [fmt, setFmt] = useState<"srt" | "vtt" | "ass">("srt");
  const [videoForExtract, setVideoForExtract] = useState("");
  useEffect(() => {
    if (file) call<string>("read_text_file", { path: file }).then((t) => setCues(parseAny(t)));
  }, [file]);
  const render = (c: Cue[]) => (fmt === "srt" ? toSrt(c) : fmt === "vtt" ? toVtt(c) : toAss(c));
  const saveAs = async (c: Cue[], suffix: string) => {
    const out = await pickSave(joinPath(dirname(file || videoForExtract), `${stem(file || videoForExtract)}${suffix}.${fmt}`));
    if (out) await attempt(() => call("write_text_file", { path: out, content: render(c) }), `บันทึก ${basename(out)} แล้ว`);
  };
  const extract = async () => {
    const tmp = joinPath(await api.tempDir(), `extract-${Date.now()}.srt`);
    const ok = await attempt(() => api.ffmpegExec(["-y", "-i", videoForExtract, "-map", "0:s:0", tmp]));
    if (ok !== undefined) {
      setCues(parseAny(await call<string>("read_text_file", { path: tmp })));
      setFile("");
    }
  };
  const loadSecond = async (p: string) => setSecond(parseAny(await call<string>("read_text_file", { path: p })));
  return (
    <div className="space-y-3">
      <div className="grid gap-2 md:grid-cols-2">
        <FileInput value={file} onChange={setFile} accept={[...SUB_EXT, "lrc"]} label="ลากไฟล์ซับมาวาง" />
        <div className="flex gap-2">
          <FileInput value={videoForExtract} onChange={setVideoForExtract} accept={["mkv", "mp4"]} label="หรือดึงซับจากวิดีโอ" />
          {videoForExtract && <button className="btn" onClick={extract}>ดึง</button>}
        </div>
      </div>
      {cues.length > 0 && (
        <>
          <p className="text-sm">{cues.length} บรรทัด · ยาว {formatDuration(cues[cues.length - 1].end)} {file && `· ต้นฉบับ ${extname(file).toUpperCase()}`}</p>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2 rounded-xl bg-fg/5 p-3">
              <Slider label="เลื่อนเวลา" value={offset} min={-30} max={30} step={0.1} suffix=" วิ" onChange={setOffset} />
              <button className="btn btn-sm w-full" onClick={() => { setCues(shift(cues, offset)); setOffset(0); }}>ใช้การเลื่อนเวลา</button>
              <Slider label="ยืด/หด (แก้ซับเร็ว/ช้า 25↔23.976fps)" value={factor} min={0.9} max={1.1} step={0.001} onChange={setFactor} />
              <button className="btn btn-sm w-full" onClick={() => { setCues(scale(cues, factor)); setFactor(1); }}>ใช้การยืด/หด</button>
            </div>
            <div className="space-y-2 rounded-xl bg-fg/5 p-3">
              <Field label="รวมกับซับอีกไฟล์ (เช่น ไทย+อังกฤษ)">
                <DropZone onFiles={(p) => loadSecond(p[0])} accept={SUB_EXT} multiple={false} compact label={second.length ? `โหลดแล้ว ${second.length} บรรทัด` : "ลากซับไฟล์ที่ 2"} />
              </Field>
              <button className="btn btn-sm w-full" disabled={!second.length} onClick={() => saveAs(merge(cues, second), "_รวม")}>รวมและบันทึก</button>
              <Field label="แยกซับที่เวลา"><input className="input font-mono" value={splitAt} onChange={(e) => setSplitAt(e.target.value)} placeholder="เช่น 45:00" /></Field>
              <button className="btn btn-sm w-full" disabled={!splitAt} onClick={async () => { const [a, b] = split(cues, parseTime(splitAt)); await saveAs(a, "_ส่วน1"); await saveAs(b, "_ส่วน2"); }}>แยกเป็น 2 ไฟล์</button>
            </div>
          </div>
          <div className="flex gap-2">
            <Select value={fmt} onChange={setFmt} options={[{ value: "srt", label: "SRT" }, { value: "vtt", label: "VTT" }, { value: "ass", label: "ASS" }]} className="w-28" />
            <button className="btn-primary flex-1" onClick={() => saveAs(cues, "_แก้ไข")}><Download size={14} /> บันทึกเป็น {fmt.toUpperCase()}</button>
            <button className="btn" onClick={() => downloadText(`subtitle.${fmt}`, convert(toSrt(cues), fmt))}>ดาวน์โหลด</button>
          </div>
          <div className="max-h-72 overflow-auto rounded-xl bg-black/20 p-2 font-mono text-xs">
            {cues.slice(0, 500).map((c, i) => (
              <div key={i} className="flex gap-3 border-b border-fg/5 py-0.5">
                <span className="text-muted">{formatDuration(c.start)}</span>
                <span className="selectable whitespace-pre-line font-sans">{c.text}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---------- timecode ----------
export function tcToFrames(tc: string, fps: number): number {
  const p = tc.split(/[:;.]/).map(Number);
  while (p.length < 4) p.unshift(0);
  const [h, m, s, f] = p;
  return Math.round((h * 3600 + m * 60 + s) * fps) + f;
}
export function framesToTc(frames: number, fps: number): string {
  const r = Math.round(fps);
  const sign = frames < 0 ? "-" : "";
  frames = Math.abs(frames);
  const f = frames % r;
  const t = Math.floor(frames / r);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${sign}${pad(Math.floor(t / 3600))}:${pad(Math.floor((t % 3600) / 60))}:${pad(t % 60)}:${pad(f)}`;
}

export function TimecodeCalc() {
  const [fps, setFps] = useState(30);
  const [a, setA] = useState("00:01:00:00");
  const [b, setB] = useState("00:00:30:15");
  const fa = tcToFrames(a, fps);
  const fb = tcToFrames(b, fps);
  return (
    <div className="space-y-3">
      <Field label="FPS"><Select value={String(fps)} onChange={(v) => setFps(Number(v))} options={["23.976", "24", "25", "29.97", "30", "50", "59.94", "60"]} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Timecode A (ชม:นาที:วิ:เฟรม)"><input className="input font-mono" value={a} onChange={(e) => setA(e.target.value)} /></Field>
        <Field label="Timecode B"><input className="input font-mono" value={b} onChange={(e) => setB(e.target.value)} /></Field>
      </div>
      <table className="w-full font-mono text-sm">
        <tbody>
          {[
            ["A + B", framesToTc(fa + fb, fps)],
            ["A − B", framesToTc(fa - fb, fps)],
            ["A เป็นเฟรม", String(fa)],
            ["A เป็นวินาที", (fa / fps).toFixed(3)],
            ["B เป็นเฟรม", String(fb)],
          ].map(([k, v]) => (
            <tr key={k} className="border-b border-fg/5"><td className="py-1.5 text-muted">{k}</td><td className="selectable text-right text-lg">{v}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

