// ตัวช่วยจัดรูปแบบข้อความ ตัวเลข วันที่ (รองรับ พ.ศ.) และพาธไฟล์

export function formatBytes(n: number, digits = 1): string {
  if (!isFinite(n) || n <= 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : digits)} ${u[i]}`;
}

export function formatDuration(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/** แปลง "1:02:03.5" / "62.5" / "1:02" เป็นวินาที */
export function parseTime(t: string): number {
  const s = t.trim().replace(",", ".");
  if (!s) return 0;
  const parts = s.split(":").map(Number);
  if (parts.some((p) => isNaN(p))) return NaN;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

let useBE = true;
export function setBuddhistEra(v: boolean) {
  useBE = v;
}

/** วันที่แบบไทย — ใช้ พ.ศ. ถ้าเปิดไว้ */
export function formatDate(input: string | number | Date, withTime = true): string {
  const d = new Date(input);
  if (isNaN(d.getTime())) return "-";
  const opts: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  };
  const locale = useBE ? "th-TH-u-ca-buddhist" : "th-TH-u-ca-gregory";
  return d.toLocaleString(locale, opts);
}

export function timeAgo(input: string | number | Date): string {
  const diff = (Date.now() - new Date(input).getTime()) / 1000;
  if (diff < 60) return "เมื่อสักครู่";
  if (diff < 3600) return `${Math.floor(diff / 60)} นาทีที่แล้ว`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ชั่วโมงที่แล้ว`;
  if (diff < 30 * 86400) return `${Math.floor(diff / 86400)} วันที่แล้ว`;
  return formatDate(input, false);
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" ตามเวลาเครื่อง (toISOString() เป็น UTC — ตี 0-7 โมงไทยจะกลายเป็นเมื่อวาน) */
export function localDateKey(input: string | number | Date = new Date()): string {
  const d = new Date(input);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** "YYYY-MM-DD-HH-mm-ss" ตามเวลาเครื่อง สำหรับตั้งชื่อไฟล์ */
export function localStamp(d: Date = new Date()): string {
  return `${localDateKey(d)}-${pad2(d.getHours())}-${pad2(d.getMinutes())}-${pad2(d.getSeconds())}`;
}

export function isToday(input: string | number | Date): boolean {
  const d = new Date(input);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

// ---------- พาธ (Windows) ----------
export function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}
export function dirname(p: string): string {
  const i = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
  return i > 0 ? p.slice(0, i) : p;
}
export function extname(p: string): string {
  const b = basename(p);
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(i + 1).toLowerCase() : "";
}
export function stem(p: string): string {
  const b = basename(p);
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(0, i) : b;
}
export function joinPath(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, "") : p.replace(/^[\\/]+|[\\/]+$/g, "")))
    .join("\\");
}
/** สร้างชื่อไฟล์ปลายทาง เช่น "C:\\a\\คลิป.mkv" → "C:\\out\\คลิป_converted.mp4" */
export function outputPath(input: string, ext: string, suffix = "", dir?: string): string {
  return joinPath(dir || dirname(input), `${stem(input)}${suffix}.${ext}`);
}
/** ลบอักขระที่ใช้เป็นชื่อไฟล์ไม่ได้ */
export function safeName(s: string): string {
  return s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim() || "ไฟล์";
}

export const VIDEO_EXT = ["mp4", "mkv", "avi", "mov", "webm", "flv", "wmv", "m4v", "ts", "3gp"];
export const AUDIO_EXT = ["mp3", "wav", "flac", "aac", "ogg", "m4a", "opus", "wma"];
export const IMAGE_EXT = ["jpg", "jpeg", "png", "webp", "avif", "gif", "bmp", "tif", "tiff", "heic"];
export const SUB_EXT = ["srt", "vtt", "ass", "ssa"];

export function kindOf(path: string): "video" | "audio" | "image" | "other" {
  const e = extname(path);
  if (VIDEO_EXT.includes(e)) return "video";
  if (AUDIO_EXT.includes(e)) return "audio";
  if (IMAGE_EXT.includes(e)) return "image";
  return "other";
}

export function clamp(v: number, a: number, b: number) {
  return Math.min(b, Math.max(a, v));
}

export function downloadText(name: string, text: string, mime = "text/plain") {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function toCSV(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]);
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  // ใส่ BOM เพื่อให้ Excel อ่านภาษาไทยถูก
  return "\ufeff" + [keys.join(","), ...rows.map((r) => keys.map((k) => esc(r[k])).join(","))].join("\r\n");
}
