// หน้า 3: แปลงไฟล์
import { useEffect, useMemo, useState } from "react";
import { Repeat, Trash2, Play, FileArchive, FolderOpen, Film, Music, Image as ImageIcon, Merge, SplitSquareHorizontal, Eye } from "lucide-react";
import { Card, DropZone, Field, PageHeader, Select, Slider, Tabs, Toggle, Modal, Empty } from "@/components/ui";
import { JobList, useJobs } from "@/components/JobList";
import { api, call, fileUrl, pickFiles, pickFolder, pickSave } from "@/lib/api";
import { attempt, useApp } from "@/store/app";
import { buildConvertArgs, concatList, defaultConvert, PRESETS, type ConvertOptions } from "@/lib/ffmpeg";
import { AUDIO_EXT, IMAGE_EXT, VIDEO_EXT, basename, extname, formatBytes, formatDuration, joinPath, kindOf, outputPath, parseTime, stem } from "@/lib/format";

interface Item {
  path: string;
  size: number;
  info?: { duration: number; width?: number; height?: number; vcodec?: string; acodec?: string };
}

const OUT_VIDEO = ["mp4", "mkv", "avi", "mov", "webm", "flv", "wmv", "m4v", "gif"];
const OUT_AUDIO = ["mp3", "wav", "flac", "aac", "ogg", "m4a", "opus"];
const OUT_IMAGE = ["jpg", "png", "webp", "avif", "bmp", "tiff"];
const ACCEPT = [...VIDEO_EXT, ...AUDIO_EXT, ...IMAGE_EXT];

export async function probeSummary(path: string): Promise<Item["info"]> {
  const p = await api.probe(path);
  const v = p.streams?.find((s: any) => s.codec_type === "video");
  const a = p.streams?.find((s: any) => s.codec_type === "audio");
  return { duration: Number(p.format?.duration ?? 0), width: v?.width, height: v?.height, vcodec: v?.codec_name, acodec: a?.codec_name };
}

export default function Converter() {
  const toast = useApp((s) => s.toast);
  const [items, setItems] = useState<Item[]>([]);
  const [opt, setOpt] = useState<ConvertOptions>(defaultConvert);
  const [tab, setTab] = useState<"basic" | "edit" | "watermark" | "advanced">("basic");
  const [outDir, setOutDir] = useState("");
  const [compare, setCompare] = useState<{ a: string; b: string } | null>(null);
  const jobs = useJobs(["convert"]);
  const set = <K extends keyof ConvertOptions>(k: K, v: ConvertOptions[K]) => setOpt((o) => ({ ...o, [k]: v }));

  const add = async (paths: string[]) => {
    const fresh = paths.filter((p) => !items.some((i) => i.path === p));
    const entries = await Promise.all(
      fresh.map(async (p) => {
        const size = await call<{ size: number }>("path_info", { path: p }).then((r) => r.size).catch(() => 0);
        const info = await probeSummary(p).catch(() => undefined);
        return { path: p, size, info };
      }),
    );
    setItems((prev) => [...prev, ...entries]);
    const k = kindOf(paths[0]);
    if (k === "audio" && !OUT_AUDIO.includes(opt.format)) set("format", "mp3");
    if (k === "image" && !OUT_IMAGE.includes(opt.format)) set("format", "webp");
  };

  const outFor = (p: string) => {
    const same = extname(p) === opt.format;
    return outputPath(p, opt.format, same ? "_converted" : "", outDir || undefined);
  };

  const start = async () => {
    if (!items.length) return;
    for (const it of items) {
      const out = outFor(it.path);
      const args = buildConvertArgs(it.path, out, opt);
      const trim = (opt.trimEnd ? parseTime(opt.trimEnd) : it.info?.duration ?? 0) - (opt.trimStart ? parseTime(opt.trimStart) : 0);
      await attempt(() =>
        api.ffmpegJob({ kind: "convert", title: `แปลง ${basename(it.path)} → ${opt.format.toUpperCase()}`, input: it.path, output: out, passes: [args], duration: trim > 0 ? trim / (opt.speed || 1) : 0 }),
      );
    }
    toast(`เพิ่ม ${items.length} งานแปลงเข้าคิวแล้ว`, "success");
  };

  /** ต่อหลายคลิปเป็นไฟล์เดียว (ต้องเป็นรูปแบบเดียวกัน) */
  const joinClips = async () => {
    if (items.length < 2) return toast("เลือกอย่างน้อย 2 ไฟล์เพื่อต่อกัน", "error");
    const out = await pickSave(joinPath(outDir || items[0].path.replace(/[\\/][^\\/]+$/, ""), `รวมคลิป.${opt.format}`));
    if (!out) return;
    const tmp = await api.tempDir();
    const list = joinPath(tmp, `concat-${Date.now()}.txt`);
    await call("write_text_file", { path: list, content: concatList(items.map((i) => i.path)) });
    const sameCodec = new Set(items.map((i) => `${i.info?.vcodec}|${i.info?.width}x${i.info?.height}|${extname(i.path)}`)).size === 1;
    const args = sameCodec
      ? ["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", out]
      : ["-y", ...items.flatMap((i) => ["-i", i.path]), "-filter_complex", `${items.map((_, k) => `[${k}:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v${k}];[${k}:a]aresample=48000[a${k}]`).join(";")};${items.map((_, k) => `[v${k}][a${k}]`).join("")}concat=n=${items.length}:v=1:a=1[v][a]`, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-crf", String(opt.crf), "-c:a", "aac", out];
    const dur = items.reduce((a, i) => a + (i.info?.duration ?? 0), 0);
    await attempt(() => api.ffmpegJob({ kind: "convert", title: `ต่อ ${items.length} คลิป → ${basename(out)}`, input: items[0].path, output: out, passes: [args], duration: dur }), "เพิ่มงานต่อคลิปแล้ว");
  };

  /** แยกวิดีโอเป็นช่วง ๆ ตามความยาวที่กำหนด */
  const splitClips = async () => {
    const secs = parseTime(prompt("แยกทุก ๆ กี่วินาที? (เช่น 60 หรือ 10:00)", "60") ?? "");
    if (!secs || isNaN(secs)) return;
    for (const it of items) {
      const out = joinPath(outDir || it.path.replace(/[\\/][^\\/]+$/, ""), `${stem(it.path)}_ส่วน%03d.${extname(it.path)}`);
      await attempt(() => api.ffmpegJob({ kind: "convert", title: `แยก ${basename(it.path)} ทุก ${secs} วิ`, input: it.path, output: out, passes: [["-y", "-i", it.path, "-c", "copy", "-map", "0", "-f", "segment", "-segment_time", String(secs), "-reset_timestamps", "1", out]] }));
    }
  };

  const zipOutputs = async () => {
    const done = jobs.filter((j) => j.status === "done").map((j) => j.output);
    if (!done.length) return toast("ยังไม่มีไฟล์ที่แปลงเสร็จ", "error");
    const dest = await pickSave("ไฟล์ที่แปลงแล้ว.zip", [{ name: "ZIP", extensions: ["zip"] }]);
    if (dest) await attempt(() => call("zip_files", { paths: done, dest }), `สร้าง ZIP แล้ว: ${basename(dest)}`);
  };

  const totalSize = useMemo(() => items.reduce((a, i) => a + i.size, 0), [items]);
  const kind = items[0] ? kindOf(items[0].path) : "video";
  const formats = kind === "audio" ? OUT_AUDIO : kind === "image" ? OUT_IMAGE : [...OUT_VIDEO, ...OUT_AUDIO, ...OUT_IMAGE];
  const doneJobs = jobs.filter((j) => j.status === "done");

  return (
    <div>
      <PageHeader title="แปลงไฟล์" subtitle="วิดีโอ · เสียง · รูปภาพ — รองรับ H.264/H.265/VP9/AV1/ProRes และการ์ดจอ NVENC/QSV/AMF" icon={<Repeat />} />
      <div className="grid gap-4 xl:grid-cols-[1fr_400px]">
        <div className="space-y-4">
          <Card>
            <DropZone onFiles={add} accept={ACCEPT} compact={items.length > 0} label="ลากวิดีโอ เสียง หรือรูปมาวางที่นี่" />
            {items.length > 0 && (
              <>
                <div className="mt-3 flex items-center justify-between text-xs text-muted">
                  <span>
                    {items.length} ไฟล์ · {formatBytes(totalSize)}
                  </span>
                  <button className="btn btn-sm" onClick={() => setItems([])}>
                    ล้างทั้งหมด
                  </button>
                </div>
                <div className="mt-2 max-h-80 space-y-1.5 overflow-auto">
                  {items.map((it) => (
                    <FileRow key={it.path} item={it} out={outFor(it.path)} onRemove={() => setItems((p) => p.filter((x) => x.path !== it.path))} />
                  ))}
                </div>
              </>
            )}
          </Card>
          <Card
            title="คิวการแปลง"
            actions={
              <>
                {doneJobs.length > 0 && (
                  <button className="btn btn-sm" onClick={() => setCompare({ a: doneJobs[0].input, b: doneJobs[0].output })}>
                    <Eye size={13} /> เทียบก่อน-หลัง
                  </button>
                )}
                <button className="btn btn-sm" onClick={zipOutputs}>
                  <FileArchive size={13} /> ส่งออกเป็น ZIP
                </button>
              </>
            }
          >
            <JobList kinds={["convert"]} />
          </Card>
        </div>

        <Card>
          <div className="mb-3">
            <span className="label">ค่าตั้งสำเร็จรูป</span>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(PRESETS).map(([k, p]) => (
                <button key={k} className="chip hover:bg-accent/40" onClick={() => setOpt({ ...defaultConvert, ...p.opts })}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "basic", label: "พื้นฐาน" },
              { id: "edit", label: "ตัด/ครอป" },
              { id: "watermark", label: "ลายน้ำ/ซับ" },
              { id: "advanced", label: "ขั้นสูง" },
            ]}
          />
          {tab === "basic" && (
            <div className="space-y-3">
              <Field label="แปลงเป็น">
                <div className="flex flex-wrap gap-1.5">
                  {formats.map((f) => (
                    <button key={f} onClick={() => set("format", f)} className={`rounded-lg px-2.5 py-1 font-mono text-xs uppercase transition ${opt.format === f ? "bg-accent text-white shadow-glow" : "bg-fg/5 hover:bg-fg/10"}`}>
                      {f}
                    </button>
                  ))}
                </div>
              </Field>
              {OUT_VIDEO.includes(opt.format) && opt.format !== "gif" && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Codec วิดีโอ">
                    <Select value={opt.vcodec} onChange={(v) => set("vcodec", v)} options={[{ value: "auto", label: "อัตโนมัติ" }, { value: "h264", label: "H.264" }, { value: "h265", label: "H.265 / HEVC" }, { value: "vp9", label: "VP9" }, { value: "av1", label: "AV1" }, { value: "prores", label: "ProRes" }, { value: "copy", label: "ไม่แปลง (copy)" }]} />
                  </Field>
                  <Field label="การ์ดจอช่วย">
                    <Select value={opt.hw} onChange={(v) => set("hw", v)} options={[{ value: "none", label: "ไม่ใช้ (CPU)" }, { value: "nvenc", label: "NVIDIA NVENC" }, { value: "qsv", label: "Intel QSV" }, { value: "amf", label: "AMD AMF" }]} />
                  </Field>
                </div>
              )}
              {OUT_VIDEO.includes(opt.format) && <Slider label="คุณภาพ (น้อย = ชัดกว่า/ไฟล์ใหญ่กว่า)" value={opt.crf} min={14} max={40} onChange={(v) => set("crf", v)} />}
              {OUT_IMAGE.includes(opt.format) && <Slider label="คุณภาพรูป" value={opt.imageQuality} min={10} max={100} suffix="%" onChange={(v) => set("imageQuality", v)} />}
              <div className="grid grid-cols-3 gap-2">
                <Field label="กว้าง (px)">
                  <input type="number" className="input" value={opt.width || ""} placeholder="เดิม" onChange={(e) => set("width", Number(e.target.value))} />
                </Field>
                <Field label="สูง (px)">
                  <input type="number" className="input" value={opt.height || ""} placeholder="เดิม" onChange={(e) => set("height", Number(e.target.value))} />
                </Field>
                <Field label="FPS">
                  <input type="number" className="input" value={opt.fps || ""} placeholder="เดิม" onChange={(e) => set("fps", Number(e.target.value))} />
                </Field>
              </div>
              {!OUT_IMAGE.includes(opt.format) && (
                <Field label="บิตเรตเสียง">
                  <Select value={opt.audioBitrate} onChange={(v) => set("audioBitrate", v)} options={["96k", "128k", "160k", "192k", "256k", "320k"]} />
                </Field>
              )}
              <Toggle label="ปรับเสียงให้ดังสม่ำเสมอ (loudnorm)" checked={opt.normalize} onChange={(v) => set("normalize", v)} />
              <Toggle label="ลบข้อมูลเมตา" checked={opt.stripMeta} onChange={(v) => set("stripMeta", v)} />
            </div>
          )}
          {tab === "edit" && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="เริ่มที่ (ตัด)" hint="เช่น 0:30 หรือ 1:02:03">
                  <input className="input font-mono" value={opt.trimStart} onChange={(e) => set("trimStart", e.target.value)} placeholder="0:00" />
                </Field>
                <Field label="จบที่">
                  <input className="input font-mono" value={opt.trimEnd} onChange={(e) => set("trimEnd", e.target.value)} placeholder="จนจบ" />
                </Field>
              </div>
              <Field label="ครอป (กว้าง:สูง:x:y)" hint="เช่น 1080:1080:420:0 หรือ ih*9/16:ih (ครอปเป็นแนวตั้ง)">
                <input className="input font-mono" value={opt.crop} onChange={(e) => set("crop", e.target.value)} />
              </Field>
              <Field label="หมุน">
                <div className="flex gap-1.5">
                  {([0, 90, 180, 270] as const).map((r) => (
                    <button key={r} className={opt.rotate === r ? "tab-active" : "tab"} onClick={() => set("rotate", r)}>
                      {r}°
                    </button>
                  ))}
                </div>
              </Field>
              <div className="grid grid-cols-2">
                <Toggle label="พลิกซ้าย-ขวา" checked={opt.flipH} onChange={(v) => set("flipH", v)} />
                <Toggle label="พลิกบน-ล่าง" checked={opt.flipV} onChange={(v) => set("flipV", v)} />
              </div>
              <Slider label="ความเร็ว" value={opt.speed} min={0.25} max={4} step={0.25} format={(v) => `${v}x`} onChange={(v) => set("speed", v)} />
              <Toggle label="เล่นย้อนกลับ (ใช้แรมมาก เหมาะกับคลิปสั้น)" checked={opt.reverse} onChange={(v) => set("reverse", v)} />
              <Toggle label="ลบเสียงออก" checked={opt.removeAudio} onChange={(v) => set("removeAudio", v)} />
              <div className="flex gap-2 pt-2">
                <button className="btn flex-1" onClick={joinClips} disabled={items.length < 2}>
                  <Merge size={14} /> ต่อคลิปทั้งหมด
                </button>
                <button className="btn flex-1" onClick={splitClips} disabled={!items.length}>
                  <SplitSquareHorizontal size={14} /> แยกเป็นช่วง
                </button>
              </div>
            </div>
          )}
          {tab === "watermark" && (
            <div className="space-y-3">
              <Field label="ลายน้ำข้อความ (รองรับภาษาไทย)">
                <input className="input" value={opt.watermarkText} onChange={(e) => set("watermarkText", e.target.value)} placeholder="© ช่องของฉัน" />
              </Field>
              <Field label="ลายน้ำรูป (PNG โปร่งใส)">
                <div className="flex gap-2">
                  <input className="input text-xs" value={opt.watermarkImage} readOnly placeholder="ไม่ใช้" />
                  <button className="btn" onClick={async () => { const f = await pickFiles({ multiple: false, filters: [{ name: "รูป", extensions: ["png", "jpg", "webp"] }] }); if (f[0]) set("watermarkImage", f[0]); }}>
                    เลือก
                  </button>
                  {opt.watermarkImage && <button className="btn" onClick={() => set("watermarkImage", "")}>ล้าง</button>}
                </div>
              </Field>
              <Field label="ตำแหน่ง">
                <Select value={opt.watermarkPos} onChange={(v) => set("watermarkPos", v)} options={[{ value: "tl", label: "มุมซ้ายบน" }, { value: "tr", label: "มุมขวาบน" }, { value: "bl", label: "มุมซ้ายล่าง" }, { value: "br", label: "มุมขวาล่าง" }, { value: "center", label: "กลางจอ" }]} />
              </Field>
              <Field label="ฝังซับไตเติ้ล (burn-in)" hint="SRT / ASS / VTT — ซับจะติดบนภาพถาวร">
                <div className="flex gap-2">
                  <input className="input text-xs" value={opt.burnSubtitle} readOnly placeholder="ไม่ใช้" />
                  <button className="btn" onClick={async () => { const f = await pickFiles({ multiple: false, filters: [{ name: "ซับไตเติ้ล", extensions: ["srt", "ass", "ssa", "vtt"] }] }); if (f[0]) set("burnSubtitle", f[0]); }}>
                    เลือก
                  </button>
                  {opt.burnSubtitle && <button className="btn" onClick={() => set("burnSubtitle", "")}>ล้าง</button>}
                </div>
              </Field>
            </div>
          )}
          {tab === "advanced" && (
            <div className="space-y-3">
              <Field label="บิตเรตวิดีโอ (ว่าง = ใช้ค่าคุณภาพ)" hint="เช่น 2500k, 8M">
                <input className="input font-mono" value={opt.videoBitrate} onChange={(e) => set("videoBitrate", e.target.value)} />
              </Field>
              <Field label="Preset ความเร็วการเข้ารหัส (CPU)">
                <Select value={opt.preset} onChange={(v) => set("preset", v)} options={["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"]} />
              </Field>
              <Field label="คำสั่ง ffmpeg ที่จะใช้ (ไฟล์แรก)">
                <pre className="selectable max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 p-2 font-mono text-[11px]">{items[0] ? `ffmpeg ${buildConvertArgs(items[0].path, outFor(items[0].path), opt).map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}` : "เพิ่มไฟล์ก่อน"}</pre>
              </Field>
            </div>
          )}
          <div className="divider mt-4 pt-4">
            <Field label="โฟลเดอร์ปลายทาง">
              <div className="flex gap-2">
                <input className="input text-xs" value={outDir} placeholder="โฟลเดอร์เดียวกับไฟล์ต้นฉบับ" onChange={(e) => setOutDir(e.target.value)} />
                <button className="btn" onClick={async () => { const d = await pickFolder(); if (d) setOutDir(d); }}>
                  <FolderOpen size={14} />
                </button>
              </div>
            </Field>
            <button className="btn-primary mt-3 w-full py-2.5" disabled={!items.length} onClick={start}>
              <Play size={16} /> เริ่มแปลง {items.length > 0 && `(${items.length} ไฟล์)`}
            </button>
          </div>
        </Card>
      </div>
      {compare && <CompareModal a={compare.a} b={compare.b} onClose={() => setCompare(null)} />}
    </div>
  );
}

function FileRow({ item, out, onRemove }: { item: Item; out: string; onRemove: () => void }) {
  const k = kindOf(item.path);
  const Icon = k === "audio" ? Music : k === "image" ? ImageIcon : Film;
  const [thumb, setThumb] = useState("");
  useEffect(() => {
    if (k === "image") setThumb(fileUrl(item.path));
    else if (k === "video") api.thumbnail(item.path).then((t) => setThumb(fileUrl(t))).catch(() => {});
  }, [item.path, k]);
  return (
    <div className="flex items-center gap-3 rounded-xl bg-fg/[.04] p-2">
      <div className="grid h-12 w-20 shrink-0 place-items-center overflow-hidden rounded-lg bg-black/30">{thumb ? <img src={thumb} className="h-full w-full object-cover" alt="" /> : <Icon size={18} className="text-muted" />}</div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{basename(item.path)}</div>
        <div className="truncate text-[11px] text-muted">
          {formatBytes(item.size)}
          {item.info?.duration ? ` · ${formatDuration(item.info.duration)}` : ""}
          {item.info?.width ? ` · ${item.info.width}×${item.info.height}` : ""}
          {item.info?.vcodec ? ` · ${item.info.vcodec}` : ""}
          {item.info?.acodec ? `/${item.info.acodec}` : ""} → <span className="text-fg">{basename(out)}</span>
        </div>
      </div>
      <button className="btn btn-sm" onClick={onRemove} title="เอาออก">
        <Trash2 size={13} />
      </button>
    </div>
  );
}

/** เทียบก่อน-หลังด้วยแถบเลื่อน */
export function CompareModal({ a, b, onClose }: { a: string; b: string; onClose: () => void }) {
  const [pos, setPos] = useState(50);
  const [sizes, setSizes] = useState<[number, number]>([0, 0]);
  const isImg = IMAGE_EXT.includes(extname(b));
  const isAudio = AUDIO_EXT.includes(extname(b));
  useEffect(() => {
    Promise.all([a, b].map((p) => call<{ size: number }>("path_info", { path: p }).then((r) => r.size).catch(() => 0))).then((r) => setSizes([r[0], r[1]]));
  }, [a, b]);
  const Media = ({ src }: { src: string }) => (isImg ? <img src={fileUrl(src)} className="h-full w-full object-contain" alt="" /> : <video src={fileUrl(src)} className="h-full w-full object-contain" muted autoPlay loop />);
  return (
    <Modal title="เทียบก่อน-หลัง" onClose={onClose} wide>
      <div className="mb-2 flex justify-between text-sm">
        <span>ก่อน: {formatBytes(sizes[0])}</span>
        <span>
          หลัง: {formatBytes(sizes[1])} {sizes[0] > 0 && sizes[1] > 0 && <b className={sizes[1] < sizes[0] ? "text-lime-300" : "text-amber-300"}>({Math.round((sizes[1] / sizes[0] - 1) * 100)}%)</b>}
        </span>
      </div>
      {isAudio ? (
        <div className="space-y-2">
          <audio controls src={fileUrl(a)} className="w-full" />
          <audio controls src={fileUrl(b)} className="w-full" />
        </div>
      ) : sizes[0] || sizes[1] ? (
        <div className="relative aspect-video overflow-hidden rounded-xl bg-black">
          <div className="absolute inset-0">
            <Media src={b} />
          </div>
          <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
            <Media src={a} />
          </div>
          <div className="absolute inset-y-0 w-0.5 bg-white shadow-glow" style={{ left: `${pos}%` }} />
          <input type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} className="absolute bottom-2 left-4 right-4 w-[calc(100%-2rem)]" />
        </div>
      ) : (
        <Empty text="ไม่พบไฟล์" />
      )}
    </Modal>
  );
}
