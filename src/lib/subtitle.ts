// เครื่องมือซับไตเติ้ล: อ่าน/เขียน SRT, VTT, ASS/SSA, เลื่อนเวลา, รวม, แยก, เนื้อเพลง LRC

export interface Cue {
  start: number; // วินาที
  end: number;
  text: string;
}

function parseTs(t: string): number {
  const m = t.trim().match(/(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?/);
  if (!m) return NaN;
  const [, h, mi, s, ms] = m;
  return Number(h ?? 0) * 3600 + Number(mi) * 60 + Number(s) + Number((ms ?? "0").padEnd(3, "0")) / 1000;
}

function fmtTs(sec: number, sep: "," | ".", hoursDigits = 2): string {
  sec = Math.max(0, sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec - Math.floor(sec)) * 1000);
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${p(h, hoursDigits)}:${p(m)}:${p(s)}${sep}${p(ms === 1000 ? 999 : ms, 3)}`;
}

function fmtAss(sec: number): string {
  sec = Math.max(0, sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec - Math.floor(sec)) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

export function detectFormat(text: string): "srt" | "vtt" | "ass" | "lrc" {
  const t = text.trimStart();
  if (t.startsWith("WEBVTT")) return "vtt";
  if (/^\[Script Info\]/im.test(t) || /^Dialogue:/m.test(t)) return "ass";
  if (/^\[\d+:\d+(?:\.\d+)?\]/m.test(t)) return "lrc";
  return "srt";
}

export function parseSrtVtt(text: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = text.replace(/\r/g, "").split(/\n{2,}/);
  for (const b of blocks) {
    const lines = b.split("\n").filter((l) => l.trim() !== "");
    const i = lines.findIndex((l) => l.includes("-->"));
    if (i < 0) continue;
    const [a, z] = lines[i].split("-->");
    const start = parseTs(a);
    const end = parseTs(z.trim().split(/\s+/)[0]);
    if (isNaN(start) || isNaN(end)) continue;
    cues.push({ start, end, text: lines.slice(i + 1).join("\n") });
  }
  return cues;
}

export function parseAss(text: string): Cue[] {
  const cues: Cue[] = [];
  let fields: string[] = ["Layer", "Start", "End", "Style", "Name", "MarginL", "MarginR", "MarginV", "Effect", "Text"];
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (line.startsWith("Format:") && fields.length && /Start/.test(line)) {
      fields = line.slice(7).split(",").map((s) => s.trim());
    } else if (line.startsWith("Dialogue:")) {
      const parts = line.slice(9).split(",");
      const n = fields.length;
      const vals = [...parts.slice(0, n - 1), parts.slice(n - 1).join(",")];
      const get = (k: string) => vals[fields.indexOf(k)]?.trim() ?? "";
      cues.push({
        start: parseTs(get("Start")),
        end: parseTs(get("End")),
        text: get("Text").replace(/\{[^}]*\}/g, "").replace(/\\N/gi, "\n"),
      });
    }
  }
  return cues.filter((c) => !isNaN(c.start));
}

export function parseLrc(text: string): Cue[] {
  const out: Cue[] = [];
  for (const line of text.replace(/\r/g, "").split("\n")) {
    const tags = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!tags.length) continue;
    const lyric = line.replace(/\[[^\]]*\]/g, "").trim();
    for (const t of tags) out.push({ start: Number(t[1]) * 60 + Number(t[2]), end: 0, text: lyric });
  }
  out.sort((a, b) => a.start - b.start);
  out.forEach((c, i) => (c.end = out[i + 1]?.start ?? c.start + 5));
  return out;
}

export function parseAny(text: string): Cue[] {
  switch (detectFormat(text)) {
    case "ass":
      return parseAss(text);
    case "lrc":
      return parseLrc(text);
    default:
      return parseSrtVtt(text);
  }
}

export function toSrt(cues: Cue[]): string {
  return cues.map((c, i) => `${i + 1}\n${fmtTs(c.start, ",")} --> ${fmtTs(c.end, ",")}\n${c.text}\n`).join("\n");
}

export function toVtt(cues: Cue[]): string {
  return "WEBVTT\n\n" + cues.map((c) => `${fmtTs(c.start, ".")} --> ${fmtTs(c.end, ".")}\n${c.text}\n`).join("\n");
}

export function toAss(cues: Cue[], font = "Tahoma"): string {
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${font},64,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,3,1,2,40,40,50,222

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  return head + cues.map((c) => `Dialogue: 0,${fmtAss(c.start)},${fmtAss(c.end)},Default,,0,0,0,,${c.text.replace(/\n/g, "\\N")}`).join("\n") + "\n";
}

export function convert(text: string, to: "srt" | "vtt" | "ass"): string {
  const cues = parseAny(text);
  return to === "vtt" ? toVtt(cues) : to === "ass" ? toAss(cues) : toSrt(cues);
}

export function shift(cues: Cue[], seconds: number): Cue[] {
  return cues.map((c) => ({ ...c, start: Math.max(0, c.start + seconds), end: Math.max(0, c.end + seconds) }));
}

/** ปรับความเร็ว (เช่น 25fps → 23.976fps) */
export function scale(cues: Cue[], factor: number): Cue[] {
  return cues.map((c) => ({ ...c, start: c.start * factor, end: c.end * factor }));
}

export function merge(a: Cue[], b: Cue[]): Cue[] {
  return [...a, ...b].sort((x, y) => x.start - y.start);
}

/** แยกซับที่จุดเวลา — ส่วนหลังเลื่อนให้เริ่มที่ 0 */
export function split(cues: Cue[], at: number): [Cue[], Cue[]] {
  return [cues.filter((c) => c.start < at), shift(cues.filter((c) => c.start >= at), -at)];
}

export function cueAt(cues: Cue[], t: number): Cue | undefined {
  return cues.find((c) => t >= c.start && t <= c.end);
}
