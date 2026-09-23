// สร้างอาร์กิวเมนต์ ffmpeg จากตัวเลือกในหน้าจอ (ฟังก์ชันบริสุทธิ์ ทดสอบได้)
import { AUDIO_EXT, IMAGE_EXT, extname } from "./format";

export type HwAccel = "none" | "nvenc" | "qsv" | "amf";
export type VCodec = "auto" | "h264" | "h265" | "vp9" | "av1" | "prores" | "copy";

export interface ConvertOptions {
  format: string;
  vcodec: VCodec;
  hw: HwAccel;
  /** คุณภาพ 0-51 (ยิ่งน้อยยิ่งชัด) */
  crf: number;
  videoBitrate: string; // เช่น "2500k" — ว่าง = ใช้ crf
  audioBitrate: string; // เช่น "192k"
  width: number; // 0 = คงเดิม
  height: number;
  fps: number; // 0 = คงเดิม
  trimStart: string;
  trimEnd: string;
  crop: string; // "w:h:x:y"
  rotate: 0 | 90 | 180 | 270;
  flipH: boolean;
  flipV: boolean;
  speed: number;
  reverse: boolean;
  normalize: boolean;
  removeAudio: boolean;
  stripMeta: boolean;
  watermarkText: string;
  watermarkImage: string;
  watermarkPos: "tl" | "tr" | "bl" | "br" | "center";
  burnSubtitle: string;
  preset: string; // ultrafast..veryslow
  imageQuality: number; // 1-100
}

export const defaultConvert: ConvertOptions = {
  format: "mp4",
  vcodec: "auto",
  hw: "none",
  crf: 23,
  videoBitrate: "",
  audioBitrate: "192k",
  width: 0,
  height: 0,
  fps: 0,
  trimStart: "",
  trimEnd: "",
  crop: "",
  rotate: 0,
  flipH: false,
  flipV: false,
  speed: 1,
  reverse: false,
  normalize: false,
  removeAudio: false,
  stripMeta: false,
  watermarkText: "",
  watermarkImage: "",
  watermarkPos: "br",
  burnSubtitle: "",
  preset: "medium",
  imageQuality: 85,
};

/** ค่าตั้งสำเร็จรูป */
export const PRESETS: Record<string, { label: string; opts: Partial<ConvertOptions> }> = {
  yt1080: { label: "YouTube 1080p", opts: { format: "mp4", vcodec: "h264", width: 1920, height: 1080, fps: 30, crf: 20, audioBitrate: "192k" } },
  yt4k: { label: "YouTube 4K", opts: { format: "mp4", vcodec: "h265", width: 3840, height: 2160, crf: 22, audioBitrate: "256k" } },
  tiktok: { label: "TikTok / Reels (9:16)", opts: { format: "mp4", vcodec: "h264", width: 1080, height: 1920, fps: 30, crf: 21, audioBitrate: "160k" } },
  igreel: { label: "IG Reel", opts: { format: "mp4", vcodec: "h264", width: 1080, height: 1920, fps: 30, crf: 22, audioBitrate: "128k" } },
  igpost: { label: "IG โพสต์ (1:1)", opts: { format: "mp4", vcodec: "h264", width: 1080, height: 1080, crf: 22 } },
  line: { label: "ส่ง LINE (ไฟล์เล็ก)", opts: { format: "mp4", vcodec: "h264", width: 1280, height: 720, crf: 28, audioBitrate: "96k" } },
  mp3: { label: "เสียง MP3 320k", opts: { format: "mp3", audioBitrate: "320k" } },
  gif: { label: "GIF (480px)", opts: { format: "gif", width: 480, fps: 12 } },
};

export const isAudioFormat = (f: string) => AUDIO_EXT.includes(f);
export const isImageFormat = (f: string) => IMAGE_EXT.includes(f) && f !== "gif";

const ENCODERS: Record<string, Record<HwAccel, string>> = {
  h264: { none: "libx264", nvenc: "h264_nvenc", qsv: "h264_qsv", amf: "h264_amf" },
  h265: { none: "libx265", nvenc: "hevc_nvenc", qsv: "hevc_qsv", amf: "hevc_amf" },
  av1: { none: "libsvtav1", nvenc: "av1_nvenc", qsv: "av1_qsv", amf: "av1_amf" },
  vp9: { none: "libvpx-vp9", nvenc: "libvpx-vp9", qsv: "vp9_qsv", amf: "libvpx-vp9" },
  prores: { none: "prores_ks", nvenc: "prores_ks", qsv: "prores_ks", amf: "prores_ks" },
};

const AUDIO_CODEC: Record<string, string> = {
  mp3: "libmp3lame",
  aac: "aac",
  m4a: "aac",
  flac: "flac",
  wav: "pcm_s16le",
  ogg: "libvorbis",
  opus: "libopus",
  wma: "wmav2",
};

// ffmpeg แยกค่าใน -vf 2 ชั้น: ค่าของ option (\ ' :) แล้วจึง filtergraph (\ ' [ ] , ;)
// จึงต้อง escape ทั้ง 2 ชั้นตามลำดับ และห้ามครอบด้วย '...' เพิ่ม
const escOption = (s: string) => s.replace(/[\\':]/g, (c) => "\\" + c);
const escGraph = (s: string) => s.replace(/[\\'[\],;]/g, (c) => "\\" + c);

/** ข้อความสำหรับ drawtext=text= (ใส่ตรง ๆ ไม่ต้องครอบ quote) — ทดสอบกับ ' : , % [ ] ; แล้ว */
export function escFilter(s: string): string {
  // drawtext ขยาย %{...} และตีความ \ เอง จึงต้อง escape อีกชั้นก่อน
  return escGraph(escOption(s.replace(/\\/g, "\\\\").replace(/%/g, "\\%")));
}

/** พาธไฟล์สำหรับ filter เช่น subtitles= / lut3d=file= (ใส่ตรง ๆ ไม่ต้องครอบ quote) */
export function escFilterPath(p: string): string {
  return escGraph(escOption(p.replace(/\\/g, "/")));
}

export function atempoChain(speed: number): string {
  // atempo รับ 0.5-2.0 ต่อหนึ่งตัว จึงต้องต่อกันหลายตัว
  const parts: number[] = [];
  let s = speed;
  while (s > 2) {
    parts.push(2);
    s /= 2;
  }
  while (s < 0.5) {
    parts.push(0.5);
    s /= 0.5;
  }
  parts.push(Number(s.toFixed(4)));
  return parts.map((p) => `atempo=${p}`).join(",");
}

const WM_POS: Record<ConvertOptions["watermarkPos"], [string, string]> = {
  tl: ["20", "20"],
  tr: ["W-w-20", "20"],
  bl: ["20", "H-h-20"],
  br: ["W-w-20", "H-h-20"],
  center: ["(W-w)/2", "(H-h)/2"],
};

const TXT_POS: Record<ConvertOptions["watermarkPos"], [string, string]> = {
  tl: ["20", "20"],
  tr: ["w-tw-20", "20"],
  bl: ["20", "h-th-20"],
  br: ["w-tw-20", "h-th-20"],
  center: ["(w-tw)/2", "(h-th)/2"],
};

function codecFor(o: ConvertOptions): string {
  if (o.vcodec === "copy") return "copy";
  const f = o.format;
  let c: string = o.vcodec;
  if (c === "auto") c = f === "webm" ? "vp9" : "h264";
  if (f === "webm" && !["vp9", "av1"].includes(c)) c = "vp9";
  return ENCODERS[c]?.[o.hw] ?? "libx264";
}

function qualityArgs(enc: string, o: ConvertOptions): string[] {
  if (o.videoBitrate) return ["-b:v", o.videoBitrate];
  if (enc.endsWith("_nvenc")) return ["-cq", String(o.crf), "-preset", "p5"];
  if (enc.endsWith("_qsv")) return ["-global_quality", String(o.crf)];
  if (enc.endsWith("_amf")) return ["-rc", "cqp", "-qp_i", String(o.crf), "-qp_p", String(o.crf)];
  if (enc === "libvpx-vp9") return ["-crf", String(Math.min(63, o.crf + 10)), "-b:v", "0", "-row-mt", "1"];
  if (enc === "libsvtav1") return ["-crf", String(Math.min(63, o.crf + 10)), "-preset", "8"];
  if (enc === "prores_ks") return ["-profile:v", "3"];
  return ["-crf", String(o.crf), "-preset", o.preset || "medium"];
}

/** ฟิลเตอร์ภาพ (ใช้ร่วมกันทั้งวิดีโอและรูป) */
export function videoFilters(o: ConvertOptions): string[] {
  const vf: string[] = [];
  if (o.crop.trim()) vf.push(`crop=${o.crop.trim()}`);
  if (o.rotate === 90) vf.push("transpose=1");
  if (o.rotate === 180) vf.push("transpose=1,transpose=1");
  if (o.rotate === 270) vf.push("transpose=2");
  if (o.flipH) vf.push("hflip");
  if (o.flipV) vf.push("vflip");
  if (o.width > 0 || o.height > 0) {
    const w = o.width > 0 ? o.width : -2;
    const h = o.height > 0 ? o.height : -2;
    if (o.width > 0 && o.height > 0) {
      // พอดีกรอบ + เติมขอบดำ (ไม่ยืดภาพ)
      vf.push(`scale=${w}:${h}:force_original_aspect_ratio=decrease`, `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`, "setsar=1");
    } else {
      vf.push(`scale=${w}:${h}`);
    }
  }
  if (o.fps > 0) vf.push(`fps=${o.fps}`);
  if (o.speed !== 1) vf.push(`setpts=PTS/${o.speed}`);
  if (o.reverse) vf.push("reverse");
  if (o.burnSubtitle) vf.push(`subtitles=${escFilterPath(o.burnSubtitle)}`);
  if (o.watermarkText.trim()) {
    const [tx, ty] = TXT_POS[o.watermarkPos];
    vf.push(
      `drawtext=fontfile='C\\:/Windows/Fonts/tahoma.ttf':text=${escFilter(o.watermarkText)}:fontsize=h/22:fontcolor=white@0.85:borderw=2:bordercolor=black@0.5:x=${tx}:y=${ty}`,
    );
  }
  return vf;
}

export function audioFilters(o: ConvertOptions): string[] {
  const af: string[] = [];
  if (o.speed !== 1) af.push(atempoChain(o.speed));
  if (o.reverse) af.push("areverse");
  if (o.normalize) af.push("loudnorm=I=-16:TP=-1.5:LRA=11");
  return af;
}

function trimArgs(o: ConvertOptions): { pre: string[]; post: string[] } {
  const pre: string[] = [];
  const post: string[] = [];
  if (o.trimStart.trim()) pre.push("-ss", o.trimStart.trim());
  if (o.trimEnd.trim()) post.push("-to", o.trimEnd.trim());
  if (o.trimStart.trim() && o.trimEnd.trim()) {
    // -to หลัง -ss (input seeking) นับจากจุดเริ่มใหม่ → แปลงเป็นความยาวแทน
    const toSec = (t: string) => t.split(":").map(Number).reduce((a, b) => a * 60 + b, 0);
    const d = toSec(o.trimEnd) - toSec(o.trimStart);
    post.splice(0, 2, "-t", String(Math.max(0.1, d)));
  }
  return { pre, post };
}

/** สร้างคำสั่งแปลงไฟล์ 1 ไฟล์ */
export function buildConvertArgs(input: string, output: string, o: ConvertOptions): string[] {
  const outFmt = (extname(output) || o.format).toLowerCase();
  const { pre, post } = trimArgs(o);
  const args: string[] = ["-y", ...pre, "-i", input];
  const hasWmImage = !!o.watermarkImage && !isAudioFormat(outFmt);
  if (hasWmImage) args.push("-i", o.watermarkImage);
  args.push(...post);
  if (o.stripMeta) args.push("-map_metadata", "-1");

  // ----- เสียงอย่างเดียว -----
  if (isAudioFormat(outFmt)) {
    const af = audioFilters(o);
    args.push("-vn");
    if (af.length) args.push("-af", af.join(","));
    args.push("-c:a", AUDIO_CODEC[outFmt] ?? "aac");
    if (!["flac", "wav"].includes(outFmt) && o.audioBitrate) args.push("-b:a", o.audioBitrate);
    args.push(output);
    return args;
  }

  // ----- รูปภาพ -----
  if (isImageFormat(outFmt)) {
    const vf = videoFilters({ ...o, fps: 0, speed: 1, reverse: false });
    if (vf.length) args.push("-vf", vf.join(","));
    args.push("-frames:v", "1", ...imageCodecArgs(outFmt, o.imageQuality), "-update", "1", output);
    return args;
  }

  // ----- GIF -----
  if (outFmt === "gif") {
    const vf = videoFilters({ ...o, fps: o.fps || 12, width: o.width || 480 });
    args.push("-filter_complex", `[0:v]${vf.join(",")},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer`, "-an", "-loop", "0", output);
    return args;
  }

  // ----- วิดีโอ -----
  const enc = codecFor(o);
  const vf = enc === "copy" ? [] : videoFilters(o);
  const af = audioFilters(o);
  if (hasWmImage && enc !== "copy") {
    const [x, y] = WM_POS[o.watermarkPos];
    const chain = vf.length ? `[0:v]${vf.join(",")}[base]` : "[0:v]null[base]";
    args.push("-filter_complex", `${chain};[1:v]scale=iw*0.18:-1,format=rgba,colorchannelmixer=aa=0.85[wm];[base][wm]overlay=${x}:${y}[vout]`, "-map", "[vout]", "-map", "0:a?");
  } else if (vf.length) {
    args.push("-vf", vf.join(","));
  }
  args.push("-c:v", enc);
  if (enc !== "copy") {
    args.push(...qualityArgs(enc, o));
    if (enc.includes("264") || enc.includes("hevc") || enc.includes("265")) args.push("-pix_fmt", "yuv420p");
  }
  if (o.removeAudio) {
    args.push("-an");
  } else {
    if (af.length) args.push("-af", af.join(","));
    const ac = outFmt === "webm" ? "libopus" : outFmt === "avi" ? "libmp3lame" : outFmt === "wmv" ? "wmav2" : outFmt === "flv" ? "aac" : "aac";
    if (enc === "copy" && !af.length) args.push("-c:a", "copy");
    else args.push("-c:a", ac, "-b:a", o.audioBitrate || "192k");
  }
  if (["mp4", "mov", "m4v"].includes(outFmt)) args.push("-movflags", "+faststart");
  if (o.burnSubtitle === "" && ["mkv"].includes(outFmt)) args.push("-map", "0", "-c:s", "copy");
  args.push(output);
  return fixMapConflicts(args);
}

/** ถ้ามีทั้ง -map [vout] และ -map 0 ให้เหลืออย่างเดียว */
function fixMapConflicts(args: string[]): string[] {
  const hasVout = args.includes("[vout]");
  if (!hasVout) {
    // -map 0 ต้องมาพร้อมกับ codec copy ของซับเท่านั้น ถ้ามี -vf จะใช้ได้ปกติ
    return args;
  }
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-map" && args[i + 1] === "0") {
      i += 3; // ข้าม "-map 0 -c:s copy"
      continue;
    }
    out.push(args[i]);
  }
  return out;
}

export function imageCodecArgs(fmt: string, quality: number): string[] {
  const q = Math.max(1, Math.min(100, quality));
  switch (fmt) {
    case "jpg":
    case "jpeg":
      // q:v 2 (ดีสุด) - 31 (แย่สุด)
      return ["-q:v", String(Math.round(2 + ((100 - q) / 100) * 29))];
    case "webp":
      return ["-c:v", "libwebp", "-quality", String(q)];
    case "avif":
      return ["-c:v", "libaom-av1", "-still-picture", "1", "-crf", String(Math.round(63 - (q / 100) * 50))];
    case "png":
      return ["-compression_level", "9"];
    case "tif":
    case "tiff":
      return ["-compression_algo", "deflate"];
    default:
      return [];
  }
}

/** บีบอัดวิดีโอ: ตามขนาดเป้าหมาย (two-pass) หรือ CRF */
export function buildCompressVideo(
  input: string,
  output: string,
  opt: { mode: "crf" | "size"; crf: number; targetMB: number; duration: number; maxHeight: number; twoPass: boolean; codec: "h264" | "h265"; audioKbps: number; hw: HwAccel },
): string[][] {
  const enc = ENCODERS[opt.codec][opt.hw];
  // จำกัด "ด้านสั้น" แทนความสูง — คลิปแนวตั้ง 1080×1920 จะไม่ถูกย่อเหลือ 608×1080
  const m = opt.maxHeight;
  const vf = m > 0 ? ["-vf", `scale='if(gt(iw,ih),-2,min(${m},iw))':'if(gt(iw,ih),min(${m},ih),-2)'`] : [];
  const audio = ["-c:a", "aac", "-b:a", `${opt.audioKbps}k`];
  const tail = ["-pix_fmt", "yuv420p", "-movflags", "+faststart"];
  if (opt.mode === "crf" || opt.duration <= 0) {
    const q = enc.endsWith("_nvenc") ? ["-cq", String(opt.crf)] : enc.endsWith("_qsv") ? ["-global_quality", String(opt.crf)] : enc.endsWith("_amf") ? ["-rc", "cqp", "-qp_i", String(opt.crf), "-qp_p", String(opt.crf)] : ["-crf", String(opt.crf), "-preset", "slow"];
    return [["-y", "-i", input, ...vf, "-c:v", enc, ...q, ...audio, ...tail, output]];
  }
  const totalKbps = (opt.targetMB * 8192) / opt.duration;
  const vKbps = Math.max(80, Math.floor(totalKbps - opt.audioKbps));
  const rate = ["-b:v", `${vKbps}k`, "-maxrate", `${Math.floor(vKbps * 1.5)}k`, "-bufsize", `${vKbps * 2}k`];
  if (!opt.twoPass || opt.hw !== "none") {
    return [["-y", "-i", input, ...vf, "-c:v", enc, ...rate, ...audio, ...tail, output]];
  }
  const passlog = output + ".passlog";
  return [
    ["-y", "-i", input, ...vf, "-c:v", enc, ...rate, "-pass", "1", "-passlogfile", passlog, "-an", "-f", "null", "NUL"],
    ["-y", "-i", input, ...vf, "-c:v", enc, ...rate, "-pass", "2", "-passlogfile", passlog, ...audio, ...tail, output],
  ];
}

/** บีบอัดรูป */
export function buildCompressImage(input: string, output: string, opt: { quality: number; maxSide: number; scalePct: number; stripExif: boolean }): string[] {
  const fmt = extname(output);
  const vf: string[] = [];
  if (opt.scalePct > 0 && opt.scalePct < 100) vf.push(`scale=iw*${opt.scalePct / 100}:-2`);
  if (opt.maxSide > 0) vf.push(`scale='if(gt(iw,ih),min(${opt.maxSide},iw),-2)':'if(gt(iw,ih),-2,min(${opt.maxSide},ih))'`);
  const args = ["-y", "-i", input];
  if (vf.length) args.push("-vf", vf.join(","));
  if (opt.stripExif) args.push("-map_metadata", "-1");
  args.push("-frames:v", "1", ...imageCodecArgs(fmt, opt.quality), "-update", "1", output);
  return args;
}

/** ลบข้อมูลเมตา (EXIF/GPS) โดยไม่แปลงไฟล์ */
export function buildStripMeta(input: string, output: string): string[] {
  const img = IMAGE_EXT.includes(extname(input));
  return img
    ? ["-y", "-i", input, "-map_metadata", "-1", "-frames:v", "1", ...imageCodecArgs(extname(output), 95), "-update", "1", output]
    : ["-y", "-i", input, "-map", "0", "-map_metadata", "-1", "-map_chapters", "-1", "-c", "copy", output];
}

/** รวมหลายคลิปด้วย concat demuxer (ไฟล์รายการต้องเขียนก่อน) */
export function concatList(files: string[]): string {
  return files.map((f) => `file '${f.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n");
}
