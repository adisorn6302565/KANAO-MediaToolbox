// หน้า 5: ตัดต่อมีเดีย (วิดีโอ / เสียง / รูป)
import { useEffect, useRef, useState } from "react";
import { Scissors, Film, Music, Image as ImageIcon, GripVertical, Trash2, Plus, Download, Undo2, Brush, Eraser, Type, Square, Circle, Layers, Eye, EyeOff, RotateCw, FlipHorizontal, LayoutGrid } from "lucide-react";
import { Card, DropZone, Field, PageHeader, Select, Slider, Tabs, Toggle, Empty, useReorder, moveItem } from "@/components/ui";
import { JobList } from "@/components/JobList";
import { api, call, fileUrl, pickFiles, pickSave } from "@/lib/api";
import { attempt, useApp } from "@/store/app";
import { escFilter, escFilterPath } from "@/lib/ffmpeg";
import { AUDIO_EXT, IMAGE_EXT, VIDEO_EXT, basename, formatDuration, outputPath, parseTime, clamp } from "@/lib/format";
import { probeSummary } from "./Converter";

type Mode = "video" | "audio" | "image";

export default function Editor() {
  const [mode, setMode] = useState<Mode>("video");
  return (
    <div>
      <PageHeader title="ตัดต่อมีเดีย" subtitle="ไทม์ไลน์วิดีโอ · แต่งเสียง · แต่งรูปแบบเลเยอร์" icon={<Scissors />} />
      <Tabs
        value={mode}
        onChange={setMode}
        tabs={[
          { id: "video", label: <span className="flex items-center gap-1.5"><Film size={14} /> วิดีโอ</span> },
          { id: "audio", label: <span className="flex items-center gap-1.5"><Music size={14} /> เสียง</span> },
          { id: "image", label: <span className="flex items-center gap-1.5"><ImageIcon size={14} /> รูปภาพ</span> },
        ]}
      />
      {mode === "video" && <VideoEditor />}
      {mode === "audio" && <AudioEditor />}
      {mode === "image" && <ImageEditor />}
    </div>
  );
}

// ================= วิดีโอ =================
interface Clip {
  id: string;
  path: string;
  duration: number;
  start: number;
  end: number;
  hasAudio: boolean;
}

export const EXPORT_PRESETS = {
  youtube: { label: "YouTube 1080p (16:9)", w: 1920, h: 1080 },
  tiktok: { label: "TikTok / Reels (9:16)", w: 1080, h: 1920 },
  ig: { label: "IG โพสต์ (1:1)", w: 1080, h: 1080 },
  hd: { label: "HD 720p", w: 1280, h: 720 },
} as const;

export const COLOR_FILTERS: Record<string, { label: string; vf: string }> = {
  none: { label: "ไม่มี", vf: "" },
  bw: { label: "ขาวดำ", vf: "hue=s=0" },
  sepia: { label: "ซีเปีย", vf: "colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131" },
  vintage: { label: "วินเทจ", vf: "curves=preset=vintage" },
  warm: { label: "อบอุ่น", vf: "colortemperature=temperature=4500" },
  cool: { label: "เย็น", vf: "colortemperature=temperature=8000" },
  vivid: { label: "สีสด", vf: "eq=saturation=1.5:contrast=1.1" },
  hdr: { label: "HDR", vf: "unsharp=5:5:1.0,eq=contrast=1.2:saturation=1.3" },
};

export interface VideoProject {
  clips: Clip[];
  preset: keyof typeof EXPORT_PRESETS;
  transition: string;
  transDur: number;
  music: string;
  musicVol: number;
  origVol: number;
  text: string;
  textSize: number;
  subtitle: string;
  filter: string;
  lut: string;
  speed: number;
  kenBurns: boolean;
  overlay: string;
  chroma: boolean;
  chromaColor: string;
  fadeIn: boolean;
  fadeOut: boolean;
}

/** สร้างคำสั่ง ffmpeg จากโปรเจกต์ไทม์ไลน์ (ฟังก์ชันบริสุทธิ์ ทดสอบได้) */
export function buildTimeline(p: VideoProject, out: string, fontFile = "C\\:/Windows/Fonts/tahoma.ttf"): { args: string[]; duration: number } {
  const { w, h } = EXPORT_PRESETS[p.preset];
  const args = ["-y"];
  p.clips.forEach((c) =>
    IMAGE_EXT.includes(c.path.split(".").pop()!.toLowerCase())
      ? args.push("-loop", "1", "-t", String(c.end - c.start), "-i", c.path) // รูปนิ่ง → วิดีโอตามความยาว
      : args.push("-ss", String(c.start), "-to", String(c.end), "-i", c.path),
  );
  let idx = p.clips.length;
  const musicIdx = p.music ? idx++ : -1;
  if (p.music) args.push("-stream_loop", "-1", "-i", p.music);
  const overlayIdx = p.overlay ? idx++ : -1;
  if (p.overlay) args.push("-i", p.overlay);

  const f: string[] = [];
  const lens = p.clips.map((c) => (c.end - c.start) / p.speed);
  p.clips.forEach((c, i) => {
    const vf = [`scale=${w}:${h}:force_original_aspect_ratio=decrease`, `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black`, "setsar=1", "fps=30", "format=yuv420p"];
    if (p.kenBurns) vf.unshift(`scale=${w * 2}:-2`, `zoompan=z='min(zoom+0.0008,1.3)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${w}x${h}:fps=30`);
    if (p.speed !== 1) vf.push(`setpts=(PTS-STARTPTS)/${p.speed}`);
    f.push(`[${i}:v]${vf.join(",")}[v${i}]`);
    const af = c.hasAudio ? `[${i}:a]aresample=48000,aformat=channel_layouts=stereo` : `anullsrc=r=48000:cl=stereo,atrim=0:${(c.end - c.start).toFixed(3)}`;
    const tempo = p.speed !== 1 ? `,atempo=${clamp(p.speed, 0.5, 2)}` : "";
    f.push(`${af}${tempo},volume=${p.origVol}[a${i}]`);
  });

  let total = 0;
  let vLast = "v0";
  let aLast = "a0";
  total = lens[0] ?? 0;
  const useXfade = p.transition !== "none" && p.clips.length > 1;
  for (let i = 1; i < p.clips.length; i++) {
    if (useXfade) {
      const d = Math.min(p.transDur, lens[i - 1] / 2, lens[i] / 2);
      const offset = total - d;
      f.push(`[${vLast}][v${i}]xfade=transition=${p.transition}:duration=${d.toFixed(3)}:offset=${offset.toFixed(3)}[vx${i}]`);
      f.push(`[${aLast}][a${i}]acrossfade=d=${d.toFixed(3)}[ax${i}]`);
      vLast = `vx${i}`;
      aLast = `ax${i}`;
      total = offset + lens[i];
    } else {
      total += lens[i];
    }
  }
  if (!useXfade && p.clips.length > 1) {
    f.push(`${p.clips.map((_, i) => `[v${i}][a${i}]`).join("")}concat=n=${p.clips.length}:v=1:a=1[vc][ac]`);
    vLast = "vc";
    aLast = "ac";
  }

  // เอฟเฟกต์ภาพหลังรวมคลิป
  const post: string[] = [];
  if (COLOR_FILTERS[p.filter]?.vf) post.push(COLOR_FILTERS[p.filter].vf);
  if (p.lut) post.push(`lut3d=file=${escFilterPath(p.lut)}`);
  if (p.subtitle) post.push(`subtitles=${escFilterPath(p.subtitle)}`);
  if (p.text) post.push(`drawtext=fontfile='${fontFile}':text=${escFilter(p.text)}:fontsize=${p.textSize}:fontcolor=white:borderw=3:bordercolor=black@0.7:x=(w-text_w)/2:y=h-text_h-80`);
  if (p.fadeIn) post.push("fade=t=in:st=0:d=1");
  if (p.fadeOut && total > 2) post.push(`fade=t=out:st=${(total - 1).toFixed(3)}:d=1`);
  if (post.length) {
    f.push(`[${vLast}]${post.join(",")}[vp]`);
    vLast = "vp";
  }
  if (overlayIdx >= 0) {
    const ov = p.chroma
      ? `[${overlayIdx}:v]scale=${w}:${h},chromakey=${p.chromaColor.replace("#", "0x")}:0.15:0.1[ov]`
      : `[${overlayIdx}:v]scale=${Math.round(w / 4)}:-2[ov]`;
    f.push(ov);
    f.push(`[${vLast}][ov]overlay=${p.chroma ? "0:0" : "W-w-40:40"}:shortest=1[vo]`);
    vLast = "vo";
  }
  if (musicIdx >= 0) {
    f.push(`[${musicIdx}:a]volume=${p.musicVol},aresample=48000[bgm]`);
    f.push(`[${aLast}][bgm]amix=inputs=2:duration=first:dropout_transition=0[am]`);
    aLast = "am";
  }
  if (p.fadeOut && total > 2) {
    f.push(`[${aLast}]afade=t=out:st=${(total - 1).toFixed(3)}:d=1[af]`);
    aLast = "af";
  }
  args.push("-filter_complex", f.join(";"), "-map", `[${vLast}]`, "-map", `[${aLast}]`);
  args.push("-t", total.toFixed(3), "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out);
  return { args, duration: total };
}

const defaultProject: VideoProject = {
  clips: [],
  preset: "youtube",
  transition: "fade",
  transDur: 0.8,
  music: "",
  musicVol: 0.3,
  origVol: 1,
  text: "",
  textSize: 64,
  subtitle: "",
  filter: "none",
  lut: "",
  speed: 1,
  kenBurns: false,
  overlay: "",
  chroma: false,
  chromaColor: "#00ff00",
  fadeIn: true,
  fadeOut: true,
};

const TRANSITIONS = [
  { value: "none", label: "ไม่มี (ตัดชน)" },
  { value: "fade", label: "จางหาย" },
  { value: "fadeblack", label: "จางดำ" },
  { value: "slideleft", label: "เลื่อนซ้าย" },
  { value: "slideright", label: "เลื่อนขวา" },
  { value: "wipeleft", label: "ปาดซ้าย" },
  { value: "wiperight", label: "ปาดขวา" },
  { value: "circleopen", label: "วงกลมเปิด" },
  { value: "dissolve", label: "ละลาย" },
  { value: "zoomin", label: "ซูมเข้า" },
];

const STICKERS = ["😀", "😂", "🥰", "😎", "🔥", "💯", "👍", "🎉", "❤️", "⭐", "🐱", "🇹🇭"];

async function pickOne(extensions: string[], name: string) {
  const f = await pickFiles({ multiple: false, filters: [{ name, extensions }] });
  return f[0] ?? "";
}

function VideoEditor() {
  const toast = useApp((s) => s.toast);
  const [p, setP] = useState<VideoProject>(defaultProject);
  const [sel, setSel] = useState<string>("");
  const video = useRef<HTMLVideoElement>(null);
  const set = <K extends keyof VideoProject>(k: K, v: VideoProject[K]) => setP((o) => ({ ...o, [k]: v }));
  const clip = p.clips.find((c) => c.id === sel);

  const add = async (paths: string[]) => {
    const list: Clip[] = [];
    for (const path of paths) {
      const isImg = IMAGE_EXT.includes(path.split(".").pop()!.toLowerCase());
      const info = isImg ? { duration: 5 } : await probeSummary(path).catch(() => ({ duration: 0 }));
      const pr = isImg ? null : await api.probe(path).catch(() => null);
      const hasAudio = !!pr?.streams?.some((s: any) => s.codec_type === "audio");
      list.push({ id: crypto.randomUUID(), path, duration: info?.duration || 5, start: 0, end: info?.duration || 5, hasAudio });
    }
    setP((o) => ({ ...o, clips: [...o.clips, ...list] }));
    if (!sel && list[0]) setSel(list[0].id);
  };
  const updClip = (id: string, patch: Partial<Clip>) => setP((o) => ({ ...o, clips: o.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  const splitAt = () => {
    if (!clip || !video.current) return;
    const t = video.current.currentTime;
    if (t <= clip.start + 0.1 || t >= clip.end - 0.1) return toast("เลื่อนหัวอ่านไปยังจุดที่ต้องการแยกก่อน", "error");
    const second: Clip = { ...clip, id: crypto.randomUUID(), start: t };
    setP((o) => {
      const i = o.clips.findIndex((c) => c.id === clip.id);
      const clips = [...o.clips];
      clips.splice(i, 1, { ...clip, end: t }, second);
      return { ...o, clips };
    });
  };
  const reorder = useReorder((from, to) => setP((o) => ({ ...o, clips: moveItem(o.clips, from, to) })));
  const total = p.clips.reduce((a, c) => a + (c.end - c.start), 0);

  const exportVideo = async () => {
    if (!p.clips.length) return;
    const out = await pickSave(outputPath(p.clips[0].path, "mp4", "_ตัดต่อ"), [{ name: "MP4", extensions: ["mp4"] }]);
    if (!out) return;
    const { args, duration } = buildTimeline(p, out);
    await attempt(() => api.ffmpegJob({ kind: "convert", title: `ส่งออกโปรเจกต์ตัดต่อ → ${basename(out)}`, input: p.clips[0].path, output: out, passes: [args], duration }), "เริ่มส่งออกแล้ว ดูความคืบหน้าด้านล่าง");
  };
  const addSticker = async (emoji: string) => {
    // วาดอีโมจิลง PNG โปร่งใสแล้วใช้เป็นภาพซ้อน
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const ctx = c.getContext("2d")!;
    ctx.font = "200px 'Segoe UI Emoji'";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(emoji, 128, 140);
    const tmp = await api.tempDir();
    const path = `${tmp}\\sticker-${Date.now()}.png`;
    await attempt(() => call("write_base64_file", { path, data: c.toDataURL("image/png").split(",")[1] }));
    set("overlay", path);
    set("chroma", false);
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <Card>
          {clip ? (
            <div>
              <video
                ref={video}
                key={clip.path}
                src={fileUrl(clip.path)}
                controls
                className="aspect-video w-full rounded-xl bg-black"
                style={{ filter: p.filter === "bw" ? "grayscale(1)" : p.filter === "sepia" ? "sepia(1)" : p.filter === "vivid" ? "saturate(1.5)" : undefined }}
                onLoadedMetadata={(e) => (e.currentTarget.currentTime = clip.start)}
                onTimeUpdate={(e) => {
                  if (e.currentTarget.currentTime > clip.end) e.currentTarget.pause();
                }}
              />
              <div className="mt-3 grid grid-cols-[1fr_1fr_auto_auto] items-end gap-2">
                <Field label={`เริ่ม (${formatDuration(clip.start)})`}>
                  <input type="range" min={0} max={clip.duration} step={0.1} value={clip.start} onChange={(e) => { const v = Math.min(Number(e.target.value), clip.end - 0.2); updClip(clip.id, { start: v }); if (video.current) video.current.currentTime = v; }} className="w-full" />
                </Field>
                <Field label={`จบ (${formatDuration(clip.end)})`}>
                  <input type="range" min={0} max={clip.duration} step={0.1} value={clip.end} onChange={(e) => { const v = Math.max(Number(e.target.value), clip.start + 0.2); updClip(clip.id, { end: v }); if (video.current) video.current.currentTime = v; }} className="w-full" />
                </Field>
                <button className="btn" onClick={() => video.current && updClip(clip.id, { start: video.current.currentTime })}>ตั้งจุดเริ่ม</button>
                <button className="btn" onClick={splitAt}><Scissors size={14} /> แยกตรงนี้</button>
              </div>
            </div>
          ) : (
            <DropZone onFiles={add} accept={[...VIDEO_EXT, ...IMAGE_EXT]} label="ลากคลิปหรือรูปมาวางเพื่อเริ่มโปรเจกต์" />
          )}
        </Card>
        <Card title="เครื่องมือ">
          <div className="max-h-[32rem] space-y-3 overflow-auto pr-1">
            <Field label="ส่งออกสำหรับ">
              <Select value={p.preset} onChange={(v) => set("preset", v)} options={Object.entries(EXPORT_PRESETS).map(([k, v]) => ({ value: k as keyof typeof EXPORT_PRESETS, label: v.label }))} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="ทรานซิชัน">
                <Select value={p.transition} onChange={(v) => set("transition", v)} options={TRANSITIONS} />
              </Field>
              <Field label="ฟิลเตอร์สี">
                <Select value={p.filter} onChange={(v) => set("filter", v)} options={Object.entries(COLOR_FILTERS).map(([k, v]) => ({ value: k, label: v.label }))} />
              </Field>
            </div>
            {p.transition !== "none" && <Slider label="ความยาวทรานซิชัน" value={p.transDur} min={0.2} max={2} step={0.1} suffix=" วิ" onChange={(v) => set("transDur", v)} />}
            <Slider label="ความเร็ว" value={p.speed} min={0.5} max={2} step={0.25} format={(v) => `${v}x`} onChange={(v) => set("speed", v)} />
            <Field label="ข้อความบนวิดีโอ (ไทยได้)">
              <input className="input" value={p.text} onChange={(e) => set("text", e.target.value)} placeholder="พิมพ์ข้อความ…" />
            </Field>
            {p.text && <Slider label="ขนาดตัวอักษร" value={p.textSize} min={24} max={160} onChange={(v) => set("textSize", v)} />}
            <FilePick label="ซับไตเติ้ล (SRT/ASS)" value={p.subtitle} onPick={async () => set("subtitle", await pickOne(["srt", "ass", "vtt"], "ซับ"))} onClear={() => set("subtitle", "")} />
            <FilePick label="เพลงประกอบ" value={p.music} onPick={async () => set("music", await pickOne(AUDIO_EXT, "เสียง"))} onClear={() => set("music", "")} />
            {p.music && (
              <div className="grid grid-cols-2 gap-2">
                <Slider label="เสียงเพลง" value={p.musicVol} min={0} max={1.5} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set("musicVol", v)} />
                <Slider label="เสียงคลิป" value={p.origVol} min={0} max={1.5} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set("origVol", v)} />
              </div>
            )}
            <FilePick label="LUT (.cube)" value={p.lut} onPick={async () => set("lut", await pickOne(["cube", "3dl"], "LUT"))} onClear={() => set("lut", "")} />
            <FilePick label="ภาพซ้อน / สติกเกอร์ / GIF" value={p.overlay} onPick={async () => set("overlay", await pickOne([...VIDEO_EXT, ...IMAGE_EXT], "มีเดีย"))} onClear={() => set("overlay", "")} />
            <div className="flex flex-wrap gap-1">
              {STICKERS.map((s) => (
                <button key={s} className="rounded-lg bg-fg/5 px-1.5 text-xl hover:bg-fg/15" onClick={() => addSticker(s)} title="ใส่สติกเกอร์มุมขวาบน">
                  {s}
                </button>
              ))}
            </div>
            {p.overlay && (
              <div className="flex items-center gap-2">
                <Toggle label="ลบพื้นเขียว (Chroma Key)" checked={p.chroma} onChange={(v) => set("chroma", v)} />
                {p.chroma && <input type="color" value={p.chromaColor} onChange={(e) => set("chromaColor", e.target.value)} />}
              </div>
            )}
            <Toggle label="ซูมช้า ๆ (Ken Burns)" checked={p.kenBurns} onChange={(v) => set("kenBurns", v)} />
            <div className="grid grid-cols-2">
              <Toggle label="จางเข้า" checked={p.fadeIn} onChange={(v) => set("fadeIn", v)} />
              <Toggle label="จางออก" checked={p.fadeOut} onChange={(v) => set("fadeOut", v)} />
            </div>
          </div>
          <button className="btn-primary mt-3 w-full" disabled={!p.clips.length} onClick={exportVideo}>
            <Download size={15} /> ส่งออกวิดีโอ ({formatDuration(total / p.speed)})
          </button>
        </Card>
      </div>
      <Card title="ไทม์ไลน์ (ลากเพื่อจัดลำดับ)" actions={<button className="btn btn-sm" onClick={async () => add(await pickFiles({ filters: [{ name: "มีเดีย", extensions: [...VIDEO_EXT, ...IMAGE_EXT] }] }))}><Plus size={13} /> เพิ่มคลิป</button>}>
        {p.clips.length === 0 ? (
          <Empty text="ยังไม่มีคลิปในไทม์ไลน์" />
        ) : (
          <div className="flex gap-1 overflow-x-auto pb-2">
            {p.clips.map((c, i) => (
              <div
                key={c.id}
                {...reorder(i)}
                onClick={() => setSel(c.id)}
                style={{ ...reorder(i).style, minWidth: `${Math.max(90, ((c.end - c.start) / Math.max(total, 1)) * 900)}px` }}
                className={`group relative cursor-pointer rounded-xl border p-2 transition ${sel === c.id ? "border-accent bg-accent/20 shadow-glow" : "border-fg/10 bg-fg/5 hover:bg-fg/10"}`}
              >
                <div className="flex items-center gap-1 text-xs">
                  <GripVertical size={12} className="text-muted" />
                  <span className="truncate">{basename(c.path)}</span>
                </div>
                <div className="mt-1 font-mono text-[10px] text-muted">
                  {formatDuration(c.start)}–{formatDuration(c.end)}
                </div>
                <button className="absolute right-1 top-1 hidden rounded bg-red-500/70 p-0.5 group-hover:block" onClick={(e) => { e.stopPropagation(); setP((o) => ({ ...o, clips: o.clips.filter((x) => x.id !== c.id) })); }}>
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card title="งานส่งออก">
        <JobList kinds={["convert"]} empty="ยังไม่มีงานส่งออก" />
      </Card>
    </div>
  );
}

function FilePick({ label, value, onPick, onClear }: { label: string; value: string; onPick: () => void; onClear: () => void }) {
  return (
    <Field label={label}>
      <div className="flex gap-1.5">
        <input className="input text-xs" readOnly value={value ? basename(value) : ""} placeholder="ไม่ใช้" />
        <button className="btn btn-sm" onClick={onPick}>เลือก</button>
        {value && <button className="btn btn-sm" onClick={onClear}>✕</button>}
      </div>
    </Field>
  );
}

// ================= เสียง =================
export interface AudioOpts {
  start: string;
  end: string;
  fadeIn: number;
  fadeOut: number;
  normalize: boolean;
  denoise: boolean;
  bass: number;
  mid: number;
  treble: number;
  echo: boolean;
  reverb: boolean;
  volume: number;
  pitch: number;
  speed: number;
  format: string;
}

export function buildAudioArgs(input: string, out: string, o: AudioOpts, duration: number): string[] {
  const af: string[] = [];
  if (o.denoise) af.push("afftdn=nf=-25");
  if (o.bass) af.push(`bass=g=${o.bass}`);
  if (o.mid) af.push(`equalizer=f=1000:t=q:w=1:g=${o.mid}`);
  if (o.treble) af.push(`treble=g=${o.treble}`);
  if (o.echo) af.push("aecho=0.8:0.88:60:0.4");
  if (o.reverb) af.push("aecho=0.8:0.9:40|70|110:0.3|0.25|0.2");
  if (o.pitch !== 0) {
    const r = Math.pow(2, o.pitch / 12);
    af.push(`asetrate=44100*${r.toFixed(5)}`, "aresample=44100", `atempo=${(1 / r).toFixed(5)}`);
  }
  if (o.speed !== 1) af.push(`atempo=${o.speed}`);
  if (o.volume !== 1) af.push(`volume=${o.volume}`);
  if (o.normalize) af.push("loudnorm=I=-16:TP=-1.5:LRA=11");
  const s = o.start ? parseTime(o.start) : 0;
  const e = o.end ? parseTime(o.end) : duration;
  const len = Math.max(0, (e - s) / o.speed);
  if (o.fadeIn > 0) af.push(`afade=t=in:st=0:d=${o.fadeIn}`);
  if (o.fadeOut > 0 && len > o.fadeOut) af.push(`afade=t=out:st=${(len - o.fadeOut).toFixed(3)}:d=${o.fadeOut}`);
  const args = ["-y"];
  if (s) args.push("-ss", String(s));
  if (o.end) args.push("-to", String(e));
  args.push("-i", input, "-vn");
  if (af.length) args.push("-af", af.join(","));
  args.push(out);
  return args;
}

function Waveform({ path, start, end, duration, onSeek }: { path: string; start: number; end: number; duration: number; onSeek: (t: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<number[]>([]);
  useEffect(() => {
    let alive = true;
    setPeaks([]);
    fetch(fileUrl(path))
      .then((r) => r.arrayBuffer())
      .then((b) => new AudioContext().decodeAudioData(b))
      .then((buf) => {
        const data = buf.getChannelData(0);
        const n = 600;
        const step = Math.floor(data.length / n);
        const out: number[] = [];
        for (let i = 0; i < n; i++) {
          let m = 0;
          for (let j = 0; j < step; j += 16) m = Math.max(m, Math.abs(data[i * step + j] ?? 0));
          out.push(m);
        }
        if (alive) setPeaks(out);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [path]);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const W = (c.width = c.clientWidth * 2);
    const H = (c.height = 240);
    ctx.clearRect(0, 0, W, H);
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent2").trim() || "34 211 238";
    peaks.forEach((p, i) => {
      const x = (i / peaks.length) * W;
      const t = (i / peaks.length) * duration;
      ctx.fillStyle = t >= start && t <= end ? `rgb(${accent})` : "rgba(128,128,128,.35)";
      const h = Math.max(2, p * H * 0.95);
      ctx.fillRect(x, (H - h) / 2, W / peaks.length - 1, h);
    });
  }, [peaks, start, end, duration]);
  return (
    <div className="relative">
      <canvas ref={canvas} className="h-[120px] w-full cursor-pointer rounded-xl bg-black/30" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); onSeek(((e.clientX - r.left) / r.width) * duration); }} />
      {!peaks.length && <div className="absolute inset-0 grid place-items-center text-xs text-muted">กำลังวาดคลื่นเสียง…</div>}
    </div>
  );
}

function AudioEditor() {
  const [file, setFile] = useState("");
  const [duration, setDuration] = useState(0);
  const [o, setO] = useState<AudioOpts>({ start: "", end: "", fadeIn: 0, fadeOut: 0, normalize: false, denoise: false, bass: 0, mid: 0, treble: 0, echo: false, reverb: false, volume: 1, pitch: 0, speed: 1, format: "mp3" });
  const audio = useRef<HTMLAudioElement>(null);
  const viz = useRef<HTMLCanvasElement>(null);
  const [joinList, setJoinList] = useState<string[]>([]);
  const set = <K extends keyof AudioOpts>(k: K, v: AudioOpts[K]) => setO((x) => ({ ...x, [k]: v }));

  // ภาพเคลื่อนไหวตามเสียง
  useEffect(() => {
    const el = audio.current;
    const c = viz.current;
    if (!el || !c || !file) return;
    let raf = 0;
    let ctx: AudioContext | null = null;
    const start = () => {
      if (ctx) return;
      ctx = new AudioContext();
      const src = ctx.createMediaElementSource(el);
      const an = ctx.createAnalyser();
      an.fftSize = 128;
      src.connect(an);
      an.connect(ctx.destination);
      const data = new Uint8Array(an.frequencyBinCount);
      const g = c.getContext("2d")!;
      const draw = () => {
        an.getByteFrequencyData(data);
        c.width = c.clientWidth;
        c.height = 80;
        data.forEach((v, i) => {
          const w = c.width / data.length;
          const h = (v / 255) * 80;
          g.fillStyle = `hsl(${270 - (i / data.length) * 90} 90% 60%)`;
          g.fillRect(i * w, 80 - h, w - 2, h);
        });
        raf = requestAnimationFrame(draw);
      };
      draw();
    };
    el.addEventListener("play", start);
    return () => {
      el.removeEventListener("play", start);
      cancelAnimationFrame(raf);
      ctx?.close();
    };
  }, [file]);

  const load = async (paths: string[]) => {
    setFile(paths[0]);
    const info = await probeSummary(paths[0]).catch(() => undefined);
    setDuration(info?.duration ?? 0);
  };
  const s = o.start ? parseTime(o.start) : 0;
  const e = o.end ? parseTime(o.end) : duration;

  const exportAudio = async () => {
    const out = await pickSave(outputPath(file, o.format, "_แต่งเสียง"));
    if (!out) return;
    await attempt(() => api.ffmpegJob({ kind: "convert", title: `แต่งเสียง ${basename(file)}`, input: file, output: out, passes: [buildAudioArgs(file, out, o, duration)], duration: (e - s) / o.speed }), "เริ่มส่งออกแล้ว");
  };
  const joinAudio = async () => {
    const out = await pickSave(outputPath(joinList[0], o.format, "_รวมเสียง"));
    if (!out) return;
    const args = ["-y", ...joinList.flatMap((f) => ["-i", f]), "-filter_complex", `${joinList.map((_, i) => `[${i}:a]`).join("")}concat=n=${joinList.length}:v=0:a=1[a]`, "-map", "[a]", out];
    await attempt(() => api.ffmpegJob({ kind: "convert", title: `รวม ${joinList.length} ไฟล์เสียง`, input: joinList[0], output: out, passes: [args] }), "เริ่มรวมไฟล์แล้ว");
  };
  const makeVisualizer = async () => {
    const out = await pickSave(outputPath(file, "mp4", "_visualizer"));
    if (!out) return;
    const args = ["-y", "-i", file, "-filter_complex", "[0:a]showwaves=s=1280x720:mode=cline:colors=0xa855f7|0x22d3ee,format=yuv420p[v]", "-map", "[v]", "-map", "0:a", "-c:v", "libx264", "-c:a", "aac", "-shortest", out];
    await attempt(() => api.ffmpegJob({ kind: "convert", title: `สร้างวิดีโอคลื่นเสียง ${basename(file)}`, input: file, output: out, passes: [args], duration }), "กำลังสร้างวิดีโอ");
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <Card>
          {!file ? (
            <DropZone onFiles={load} accept={[...AUDIO_EXT, ...VIDEO_EXT]} multiple={false} label="ลากไฟล์เสียง (หรือวิดีโอ) มาวาง" />
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <b className="truncate">{basename(file)}</b>
                <button className="btn btn-sm" onClick={() => setFile("")}>เปลี่ยนไฟล์</button>
              </div>
              <Waveform path={file} start={s} end={e} duration={duration} onSeek={(t) => audio.current && (audio.current.currentTime = t)} />
              <audio ref={audio} src={fileUrl(file)} controls className="w-full" crossOrigin="anonymous" />
              <canvas ref={viz} className="h-20 w-full" />
              <div className="grid grid-cols-4 gap-2">
                <Field label="ตัดตั้งแต่">
                  <input className="input font-mono" value={o.start} onChange={(ev) => set("start", ev.target.value)} placeholder="0:00" />
                </Field>
                <Field label="ถึง">
                  <input className="input font-mono" value={o.end} onChange={(ev) => set("end", ev.target.value)} placeholder={formatDuration(duration)} />
                </Field>
                <button className="btn self-end" onClick={() => audio.current && set("start", formatDuration(audio.current.currentTime))}>[ จุดเริ่ม</button>
                <button className="btn self-end" onClick={() => audio.current && set("end", formatDuration(audio.current.currentTime))}>จุดจบ ]</button>
              </div>
            </div>
          )}
        </Card>
        <Card title="ต่อไฟล์เสียง" actions={<button className="btn btn-sm" onClick={async () => setJoinList([...joinList, ...(await pickFiles({ filters: [{ name: "เสียง", extensions: AUDIO_EXT }] }))])}><Plus size={13} /> เพิ่ม</button>}>
          {joinList.map((f, i) => (
            <div key={f + i} className="flex items-center gap-2 py-0.5 text-sm">
              <span className="font-mono text-xs text-muted">{i + 1}</span>
              <span className="flex-1 truncate">{basename(f)}</span>
              <button className="btn btn-sm" onClick={() => setJoinList(joinList.filter((_, k) => k !== i))}><Trash2 size={12} /></button>
            </div>
          ))}
          <button className="btn mt-2 w-full" disabled={joinList.length < 2} onClick={joinAudio}>ต่อ {joinList.length} ไฟล์</button>
        </Card>
        <Card title="งานส่งออก">
          <JobList kinds={["convert"]} empty="ยังไม่มีงาน" />
        </Card>
      </div>
      <Card title="เอฟเฟกต์">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Slider label="จางเข้า" value={o.fadeIn} min={0} max={10} step={0.5} suffix=" วิ" onChange={(v) => set("fadeIn", v)} />
            <Slider label="จางออก" value={o.fadeOut} min={0} max={10} step={0.5} suffix=" วิ" onChange={(v) => set("fadeOut", v)} />
          </div>
          <span className="label">EQ</span>
          <Slider label="เบส" value={o.bass} min={-15} max={15} suffix=" dB" onChange={(v) => set("bass", v)} />
          <Slider label="กลาง" value={o.mid} min={-15} max={15} suffix=" dB" onChange={(v) => set("mid", v)} />
          <Slider label="แหลม" value={o.treble} min={-15} max={15} suffix=" dB" onChange={(v) => set("treble", v)} />
          <Slider label="ระดับเสียง" value={o.volume} min={0} max={4} step={0.1} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set("volume", v)} />
          <Slider label="คีย์เสียง (pitch)" value={o.pitch} min={-12} max={12} suffix=" semitone" onChange={(v) => set("pitch", v)} />
          <Slider label="ความเร็ว" value={o.speed} min={0.5} max={2} step={0.05} format={(v) => `${v}x`} onChange={(v) => set("speed", v)} />
          <Toggle label="ปรับให้ดังสม่ำเสมอ" checked={o.normalize} onChange={(v) => set("normalize", v)} />
          <Toggle label="ลดเสียงรบกวน" checked={o.denoise} onChange={(v) => set("denoise", v)} />
          <div className="grid grid-cols-2">
            <Toggle label="เอคโค่" checked={o.echo} onChange={(v) => set("echo", v)} />
            <Toggle label="รีเวิร์บ" checked={o.reverb} onChange={(v) => set("reverb", v)} />
          </div>
          <Field label="ส่งออกเป็น">
            <Select value={o.format} onChange={(v) => set("format", v)} options={["mp3", "wav", "flac", "m4a", "ogg", "opus"]} />
          </Field>
          <button className="btn-primary w-full" disabled={!file} onClick={exportAudio}><Download size={15} /> ส่งออกเสียง</button>
          <button className="btn w-full" disabled={!file} onClick={makeVisualizer}>สร้างวิดีโอคลื่นเสียง</button>
        </div>
      </Card>
    </div>
  );
}

// ================= รูปภาพ =================
interface Layer {
  id: string;
  name: string;
  visible: boolean;
  canvas: HTMLCanvasElement;
}

type Tool = "brush" | "eraser" | "text" | "rect" | "circle";

export const IMAGE_FILTERS: Record<string, string> = {
  none: "",
  sepia: "sepia(1)",
  bw: "grayscale(1)",
  vintage: "sepia(.5) contrast(1.1) saturate(.8) brightness(.95)",
  hdr: "contrast(1.35) saturate(1.4)",
  cool: "hue-rotate(-15deg) saturate(1.1)",
  warm: "sepia(.25) saturate(1.2)",
  fade: "contrast(.85) brightness(1.1) saturate(.7)",
};

function ImageEditor() {
  const toast = useApp((s) => s.toast);
  const view = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 1280, h: 720 });
  const [layers, setLayers] = useState<Layer[]>([]);
  const [active, setActive] = useState("");
  const [tool, setTool] = useState<Tool>("brush");
  const [color, setColor] = useState("#a855f7");
  const [brush, setBrush] = useState(12);
  const [font, setFont] = useState("Prompt");
  const [text, setText] = useState("สวัสดี");
  const [adj, setAdj] = useState({ brightness: 100, contrast: 100, saturate: 100, temp: 0, filter: "none" });
  const [history, setHistory] = useState<{ id: string; data: ImageData }[]>([]);
  const [tick, setTick] = useState(0);
  const drawing = useRef<{ x: number; y: number } | null>(null);
  const [exportFmt, setExportFmt] = useState("png");

  const newLayer = (name: string, w = size.w, h = size.h) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const l = { id: crypto.randomUUID(), name, visible: true, canvas: c };
    setLayers((x) => [...x, l]);
    setActive(l.id);
    return l;
  };

  const loadImage = (src: string) =>
    new Promise<HTMLImageElement>((res, rej) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = src;
    });

  const open = async (paths: string[]) => {
    try {
      const img = await loadImage(fileUrl(paths[0]));
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      setSize({ w, h });
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      c.getContext("2d")!.drawImage(img, 0, 0);
      const bg: Layer = { id: crypto.randomUUID(), name: basename(paths[0]), visible: true, canvas: c };
      const d = document.createElement("canvas");
      d.width = w;
      d.height = h;
      const draw: Layer = { id: crypto.randomUUID(), name: "เลเยอร์วาด", visible: true, canvas: d };
      setLayers([bg, draw]);
      setActive(draw.id);
    } catch {
      toast("เปิดรูปไม่ได้ (HEIC ให้แปลงเป็น JPG ก่อนในหน้าแปลงไฟล์)", "error");
    }
  };

  const cssFilter = `brightness(${adj.brightness}%) contrast(${adj.contrast}%) saturate(${adj.saturate}%) ${IMAGE_FILTERS[adj.filter]} ${adj.temp > 0 ? `sepia(${adj.temp / 100})` : adj.temp < 0 ? `hue-rotate(${adj.temp / 2}deg)` : ""}`;

  // วาดเลเยอร์ทั้งหมดลงจอ
  useEffect(() => {
    const c = view.current;
    if (!c) return;
    c.width = size.w;
    c.height = size.h;
    const ctx = c.getContext("2d")!;
    ctx.filter = cssFilter;
    ctx.clearRect(0, 0, size.w, size.h);
    for (const l of layers) if (l.visible) ctx.drawImage(l.canvas, 0, 0);
  }, [layers, size, tick, cssFilter]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * size.w, y: ((e.clientY - r.top) / r.height) * size.h };
  };
  const layer = layers.find((l) => l.id === active);
  const snapshot = () => {
    if (!layer) return;
    const d = layer.canvas.getContext("2d")!.getImageData(0, 0, layer.canvas.width, layer.canvas.height);
    setHistory((h) => [...h.slice(-19), { id: layer.id, data: d }]);
  };
  const undo = () => {
    const last = history[history.length - 1];
    if (!last) return;
    const l = layers.find((x) => x.id === last.id);
    l?.canvas.getContext("2d")!.putImageData(last.data, 0, 0);
    setHistory((h) => h.slice(0, -1));
    setTick((t) => t + 1);
  };

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!layer) return toast("เลือกเลเยอร์ก่อน", "error");
    snapshot();
    const p = pos(e);
    const ctx = layer.canvas.getContext("2d")!;
    if (tool === "text") {
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = color;
      ctx.font = `bold ${brush * 4}px "${font}"`;
      ctx.textBaseline = "top";
      ctx.fillText(text, p.x, p.y);
      setTick((t) => t + 1);
      return;
    }
    drawing.current = p;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !layer || (tool !== "brush" && tool !== "eraser")) return;
    const p = pos(e);
    const ctx = layer.canvas.getContext("2d")!;
    ctx.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
    ctx.strokeStyle = color;
    ctx.lineWidth = brush;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(drawing.current.x, drawing.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    drawing.current = p;
    setTick((t) => t + 1);
  };
  const up = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (drawing.current && layer && (tool === "rect" || tool === "circle")) {
      const a = drawing.current;
      const b = pos(e);
      const ctx = layer.canvas.getContext("2d")!;
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = color;
      ctx.lineWidth = brush;
      ctx.beginPath();
      if (tool === "rect") ctx.rect(a.x, a.y, b.x - a.x, b.y - a.y);
      else ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      setTick((t) => t + 1);
    }
    drawing.current = null;
  };

  /** แปลงทุกเลเยอร์ (หมุน / พลิก / ครอป / ย่อ) */
  const transformAll = (fn: (src: HTMLCanvasElement) => HTMLCanvasElement) => {
    setLayers((ls) => ls.map((l) => ({ ...l, canvas: fn(l.canvas) })));
    setHistory([]);
  };
  const rotate = () => {
    transformAll((src) => {
      const c = document.createElement("canvas");
      c.width = src.height;
      c.height = src.width;
      const ctx = c.getContext("2d")!;
      ctx.translate(c.width / 2, c.height / 2);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(src, -src.width / 2, -src.height / 2);
      return c;
    });
    setSize((s) => ({ w: s.h, h: s.w }));
  };
  const flip = () =>
    transformAll((src) => {
      const c = document.createElement("canvas");
      c.width = src.width;
      c.height = src.height;
      const ctx = c.getContext("2d")!;
      ctx.scale(-1, 1);
      ctx.drawImage(src, -src.width, 0);
      return c;
    });
  const resizeOrCrop = (w: number, h: number, crop: boolean, perspective = 0) => {
    transformAll((src) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d")!;
      if (perspective) {
        // ปรับมุมมองแบบง่าย: บีบด้านบนทีละแถว
        for (let y = 0; y < h; y++) {
          const k = 1 - (perspective / 100) * (1 - y / h);
          const rw = w * k;
          ctx.drawImage(src, 0, (y / h) * src.height, src.width, src.height / h, (w - rw) / 2, y, rw, 1);
        }
      } else if (crop) ctx.drawImage(src, (src.width - w) / 2, (src.height - h) / 2, w, h, 0, 0, w, h);
      else ctx.drawImage(src, 0, 0, w, h);
      return c;
    });
    setSize({ w, h });
  };

  const collage = async () => {
    const files = await pickFiles({ filters: [{ name: "รูป", extensions: IMAGE_EXT }] });
    if (files.length < 2) return toast("เลือกอย่างน้อย 2 รูป", "error");
    const imgs = await Promise.all(files.map((f) => loadImage(fileUrl(f))));
    const cols = Math.ceil(Math.sqrt(imgs.length));
    const rows = Math.ceil(imgs.length / cols);
    const cell = 600;
    const gap = 12;
    const W = cols * cell + (cols + 1) * gap;
    const H = rows * cell + (rows + 1) * gap;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);
    imgs.forEach((img, i) => {
      const x = gap + (i % cols) * (cell + gap);
      const y = gap + Math.floor(i / cols) * (cell + gap);
      const s = Math.max(cell / img.width, cell / img.height);
      const sw = cell / s;
      const sh = cell / s;
      ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, cell, cell);
    });
    setSize({ w: W, h: H });
    const d = document.createElement("canvas");
    d.width = W;
    d.height = H;
    const bg: Layer = { id: crypto.randomUUID(), name: "คอลลาจ", visible: true, canvas: c };
    const draw: Layer = { id: crypto.randomUUID(), name: "เลเยอร์วาด", visible: true, canvas: d };
    setLayers([bg, draw]);
    setActive(draw.id);
  };
  const frame = (style: string) => {
    const l = newLayer(`กรอบ ${style}`);
    const ctx = l.canvas.getContext("2d")!;
    const b = Math.round(Math.min(size.w, size.h) * 0.04);
    if (style === "polaroid") {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, size.w, b);
      ctx.fillRect(0, 0, b, size.h);
      ctx.fillRect(size.w - b, 0, b, size.h);
      ctx.fillRect(0, size.h - b * 4, size.w, b * 4);
    } else {
      const g = ctx.createLinearGradient(0, 0, size.w, size.h);
      g.addColorStop(0, "#a855f7");
      g.addColorStop(1, "#22d3ee");
      ctx.strokeStyle = g;
      ctx.lineWidth = b;
      ctx.strokeRect(b / 2, b / 2, size.w - b, size.h - b);
    }
    setTick((t) => t + 1);
  };
  const sticker = (s: string) => {
    const l = newLayer(`สติกเกอร์ ${s}`);
    const ctx = l.canvas.getContext("2d")!;
    const fs = Math.min(size.w, size.h) / 4;
    ctx.font = `${fs}px "Segoe UI Emoji"`;
    ctx.fillText(s, size.w - fs * 1.2, fs * 1.1);
    setTick((t) => t + 1);
  };

  const exportImage = async () => {
    const c = view.current;
    if (!c) return;
    const mime = exportFmt === "jpg" ? "image/jpeg" : `image/${exportFmt}`;
    const out = await pickSave(`รูปแต่ง.${exportFmt}`, [{ name: exportFmt.toUpperCase(), extensions: [exportFmt] }]);
    if (!out) return;
    const data = c.toDataURL(mime, 0.92);
    if (exportFmt === "avif" && !data.startsWith("data:image/avif")) {
      // WebView บางรุ่นเข้ารหัส AVIF ไม่ได้ → บันทึก PNG ชั่วคราวแล้วให้ ffmpeg แปลง
      const tmp = `${await api.tempDir()}\\edit-${Date.now()}.png`;
      await call("write_base64_file", { path: tmp, data: c.toDataURL("image/png").split(",")[1] });
      await attempt(() => api.ffmpegExec(["-y", "-i", tmp, "-c:v", "libaom-av1", "-still-picture", "1", "-crf", "30", out]), `บันทึกแล้ว: ${basename(out)}`);
      return;
    }
    await attempt(() => call("write_base64_file", { path: out, data: data.split(",")[1] }), `บันทึกแล้ว: ${basename(out)}`);
  };

  if (!layers.length)
    return (
      <Card>
        <DropZone onFiles={open} accept={IMAGE_EXT} multiple={false} label="ลากรูปมาวางเพื่อเริ่มแต่ง" />
        <div className="mt-3 flex justify-center gap-2">
          <button className="btn" onClick={() => { setSize({ w: 1280, h: 720 }); const l = newLayer("พื้นหลัง", 1280, 720); const ctx = l.canvas.getContext("2d")!; ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 1280, 720); newLayer("เลเยอร์วาด", 1280, 720); }}>
            <Plus size={14} /> ผืนผ้าใบว่าง 1280×720
          </button>
          <button className="btn" onClick={collage}><LayoutGrid size={14} /> สร้างคอลลาจ</button>
        </div>
      </Card>
    );

  const toolBtn = (t: Tool, icon: JSX.Element, label: string) => (
    <button className={`btn btn-sm ${tool === t ? "!bg-accent text-white" : ""}`} onClick={() => setTool(t)} title={label}>
      {icon}
    </button>
  );

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
      <Card>
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {toolBtn("brush", <Brush size={14} />, "แปรง")}
          {toolBtn("eraser", <Eraser size={14} />, "ยางลบ")}
          {toolBtn("text", <Type size={14} />, "ข้อความ (คลิกที่ภาพ)")}
          {toolBtn("rect", <Square size={14} />, "สี่เหลี่ยม (ลาก)")}
          {toolBtn("circle", <Circle size={14} />, "วงกลม (ลาก)")}
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-8 w-10" />
          <input type="range" min={1} max={80} value={brush} onChange={(e) => setBrush(Number(e.target.value))} title="ขนาด" />
          {tool === "text" && (
            <>
              <input className="input w-40" value={text} onChange={(e) => setText(e.target.value)} />
              <Select value={font} onChange={setFont} options={["Prompt", "Sarabun", "IBM Plex Sans Thai", "Tahoma"]} className="w-36" />
            </>
          )}
          <div className="flex-1" />
          <button className="btn btn-sm" onClick={undo} disabled={!history.length}><Undo2 size={14} /></button>
          <button className="btn btn-sm" onClick={rotate} title="หมุน 90°"><RotateCw size={14} /></button>
          <button className="btn btn-sm" onClick={flip} title="พลิก"><FlipHorizontal size={14} /></button>
        </div>
        <div className="grid max-h-[70vh] place-items-center overflow-auto rounded-xl bg-[repeating-conic-gradient(#8882_0_25%,transparent_0_50%)] bg-[length:20px_20px] p-2">
          <canvas ref={view} onPointerDown={down} onPointerMove={move} onPointerUp={up} className="max-h-[66vh] max-w-full cursor-crosshair shadow-2xl" style={{ aspectRatio: `${size.w}/${size.h}` }} />
        </div>
        <div className="mt-1 text-right font-mono text-xs text-muted">{size.w}×{size.h}</div>
      </Card>
      <div className="space-y-4">
        <Card title="เลเยอร์" actions={<button className="btn btn-sm" onClick={() => newLayer(`เลเยอร์ ${layers.length + 1}`)}><Layers size={13} /> เพิ่ม</button>}>
          <div className="space-y-1">
            {[...layers].reverse().map((l) => (
              <div key={l.id} onClick={() => setActive(l.id)} className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm ${active === l.id ? "bg-accent/25" : "hover:bg-fg/5"}`}>
                <button onClick={(e) => { e.stopPropagation(); setLayers((x) => x.map((y) => (y.id === l.id ? { ...y, visible: !y.visible } : y))); }}>
                  {l.visible ? <Eye size={13} /> : <EyeOff size={13} className="text-muted" />}
                </button>
                <span className="flex-1 truncate">{l.name}</span>
                <button onClick={(e) => { e.stopPropagation(); setLayers((x) => x.filter((y) => y.id !== l.id)); }}><Trash2 size={12} /></button>
              </div>
            ))}
          </div>
        </Card>
        <Card title="ปรับภาพ">
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1">
              {Object.keys(IMAGE_FILTERS).map((f) => (
                <button key={f} className={adj.filter === f ? "tab-active" : "tab"} onClick={() => setAdj({ ...adj, filter: f })}>
                  {{ none: "ปกติ", sepia: "ซีเปีย", bw: "ขาวดำ", vintage: "วินเทจ", hdr: "HDR", cool: "เย็น", warm: "อุ่น", fade: "ซีด" }[f]}
                </button>
              ))}
            </div>
            <Slider label="ความสว่าง" value={adj.brightness} min={0} max={200} suffix="%" onChange={(v) => setAdj({ ...adj, brightness: v })} />
            <Slider label="คอนทราสต์" value={adj.contrast} min={0} max={200} suffix="%" onChange={(v) => setAdj({ ...adj, contrast: v })} />
            <Slider label="ความอิ่มตัว" value={adj.saturate} min={0} max={200} suffix="%" onChange={(v) => setAdj({ ...adj, saturate: v })} />
            <Slider label="อุณหภูมิสี" value={adj.temp} min={-100} max={100} onChange={(v) => setAdj({ ...adj, temp: v })} />
          </div>
        </Card>
        <Card title="ขนาด / กรอบ / สติกเกอร์">
          <div className="grid grid-cols-2 gap-1.5">
            <button className="btn btn-sm" onClick={() => resizeOrCrop(Math.round(size.w / 2), Math.round(size.h / 2), false)}>ย่อ 50%</button>
            <button className="btn btn-sm" onClick={() => { const s = Math.min(size.w, size.h); resizeOrCrop(s, s, true); }}>ครอป 1:1</button>
            <button className="btn btn-sm" onClick={() => { const h = Math.round(size.w * 9 / 16); resizeOrCrop(size.w, Math.min(h, size.h), true); }}>ครอป 16:9</button>
            <button className="btn btn-sm" onClick={() => resizeOrCrop(size.w, size.h, false, 20)}>ปรับมุมมอง</button>
            <button className="btn btn-sm" onClick={() => frame("polaroid")}>กรอบโพลารอยด์</button>
            <button className="btn btn-sm" onClick={() => frame("neon")}>กรอบนีออน</button>
            <button className="btn btn-sm col-span-2" onClick={collage}><LayoutGrid size={13} /> สร้างคอลลาจใหม่</button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {STICKERS.map((s) => (
              <button key={s} className="rounded bg-fg/5 px-1 text-lg hover:bg-fg/15" onClick={() => sticker(s)}>{s}</button>
            ))}
          </div>
        </Card>
        <Card>
          <div className="flex gap-2">
            <Select value={exportFmt} onChange={setExportFmt} options={["png", "jpg", "webp", "avif"]} className="w-24" />
            <button className="btn-primary flex-1" onClick={exportImage}><Download size={15} /> ส่งออกรูป</button>
          </div>
          <button className="btn mt-2 w-full" onClick={() => { setLayers([]); setHistory([]); }}>เริ่มใหม่</button>
        </Card>
      </div>
    </div>
  );
}


