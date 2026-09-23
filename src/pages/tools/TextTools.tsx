// เครื่องมือกลุ่มไฟล์และข้อความ
import { useMemo, useState } from "react";
import { Copy, FolderOpen, RefreshCw } from "lucide-react";
import { DropZone, Field, Select, Slider, Toggle } from "@/components/ui";
import { call, pickFolder, revealPath } from "@/lib/api";
import { attempt, useApp } from "@/store/app";
import { basename, dirname, joinPath, stem } from "@/lib/format";

const copy = (t: string) => {
  navigator.clipboard.writeText(t);
  useApp.getState().toast("คัดลอกแล้ว");
};

function Out({ value, mono = true }: { value: string; mono?: boolean }) {
  return (
    <div className="relative">
      <textarea readOnly className={`input h-40 ${mono ? "font-mono text-xs" : ""}`} value={value} />
      <button className="btn btn-sm absolute right-2 top-2" onClick={() => copy(value)}><Copy size={12} /> คัดลอก</button>
    </div>
  );
}

// ---------- hash ----------
export function HashTool() {
  const [files, setFiles] = useState<string[]>([]);
  const [algo, setAlgo] = useState("sha256");
  const [res, setRes] = useState<Record<string, string>>({});
  const [expect, setExpect] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (list = files) => {
    setBusy(true);
    const r: Record<string, string> = {};
    for (const f of list) r[f] = (await attempt(() => call<string>("hash_file", { path: f, algo }))) ?? "ผิดพลาด";
    setRes(r);
    setBusy(false);
  };
  return (
    <div className="space-y-3">
      <DropZone onFiles={(p) => { setFiles(p); run(p); }} compact label="ลากไฟล์มาวางเพื่อคำนวณ hash" />
      <div className="flex gap-2">
        <Select value={algo} onChange={setAlgo} options={["md5", "sha1", "sha256", "sha512"].map((v) => ({ value: v, label: v.toUpperCase() }))} />
        <button className="btn" disabled={!files.length || busy} onClick={() => run()}><RefreshCw size={14} className={busy ? "animate-spin" : ""} /> คำนวณใหม่</button>
      </div>
      <Field label="เทียบกับค่าที่ควรได้ (ไม่บังคับ)"><input className="input font-mono" value={expect} onChange={(e) => setExpect(e.target.value.trim())} /></Field>
      {Object.entries(res).map(([f, h]) => (
        <div key={f} className="rounded-xl bg-fg/5 p-3">
          <div className="text-sm">{basename(f)} {expect && (h.toLowerCase() === expect.toLowerCase() ? <span className="chip bg-green-500/30">✅ ตรงกัน</span> : <span className="chip bg-red-500/30">❌ ไม่ตรง</span>)}</div>
          <div className="selectable cursor-pointer break-all font-mono text-xs text-muted" onClick={() => copy(h)}>{h}</div>
        </div>
      ))}
    </div>
  );
}

// ---------- รหัสผ่าน ----------
const WORDS = "แมว หมา ช้าง ม้า ปลา นก ข้าว น้ำ ฟ้า ดิน ไฟ ลม ภูเขา ทะเล ดาว เดือน ต้นไม้ ดอกไม้ บ้าน รถ apple river stone cloud tiger mango coffee rocket pixel sunny".split(" ");
function rand(n: number) {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % n;
}
export function genPassword(len: number, sets: { upper: boolean; lower: boolean; digit: boolean; symbol: boolean; noAmbiguous: boolean }): string {
  let pools = [sets.upper && "ABCDEFGHIJKLMNOPQRSTUVWXYZ", sets.lower && "abcdefghijklmnopqrstuvwxyz", sets.digit && "0123456789", sets.symbol && "!@#$%^&*()-_=+[]{};:,.?"].filter(Boolean) as string[];
  if (sets.noAmbiguous) pools = pools.map((p) => p.replace(/[O0Il1]/g, ""));
  if (!pools.length) return "";
  const all = pools.join("");
  // ให้มีอย่างน้อย 1 ตัวจากทุกกลุ่ม
  const chars = pools.map((p) => p[rand(p.length)]);
  while (chars.length < len) chars.push(all[rand(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.slice(0, len).join("");
}
export function strength(pw: string): { score: number; label: string } {
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/\d/.test(pw)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) pool += 32;
  const bits = pw.length * Math.log2(pool || 1);
  const score = bits < 40 ? 0 : bits < 60 ? 1 : bits < 80 ? 2 : bits < 110 ? 3 : 4;
  return { score, label: ["อ่อนมาก", "อ่อน", "พอใช้", "แข็งแรง", "แข็งแรงมาก"][score] };
}
export function PasswordGen() {
  const [len, setLen] = useState(20);
  const [opts, setOpts] = useState({ upper: true, lower: true, digit: true, symbol: true, noAmbiguous: false });
  const [words, setWords] = useState(4);
  const [seed, setSeed] = useState(0);
  const pw = useMemo(() => genPassword(len, opts), [len, opts, seed]);
  const phrase = useMemo(() => Array.from({ length: words }, () => WORDS[rand(WORDS.length)]).join("-") + "-" + rand(100), [words, seed]);
  const st = strength(pw);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="selectable input flex-1 break-all font-mono text-lg">{pw}</div>
        <button className="btn" onClick={() => copy(pw)}><Copy size={14} /></button>
        <button className="btn" onClick={() => setSeed(seed + 1)}><RefreshCw size={14} /></button>
      </div>
      <div className="h-2 overflow-hidden rounded bg-fg/10"><div className="h-full bg-gradient-to-r from-red-500 via-amber-400 to-green-400 transition-all" style={{ width: `${(st.score + 1) * 20}%` }} /></div>
      <div className="text-sm text-muted">ความแข็งแรง: {st.label}</div>
      <Slider label="ความยาว" value={len} min={6} max={64} onChange={setLen} />
      <div className="grid grid-cols-2 gap-2">
        {(Object.keys(opts) as (keyof typeof opts)[]).map((k) => (
          <Toggle key={k} label={{ upper: "ตัวพิมพ์ใหญ่ A-Z", lower: "ตัวพิมพ์เล็ก a-z", digit: "ตัวเลข 0-9", symbol: "สัญลักษณ์ !@#", noAmbiguous: "ไม่ใช้ตัวที่สับสน (O0Il1)" }[k]} checked={opts[k]} onChange={(v) => setOpts({ ...opts, [k]: v })} />
        ))}
      </div>
      <div className="divider pt-4">
        <div className="label">วลีรหัสผ่าน (จำง่าย)</div>
        <div className="flex items-center gap-2">
          <div className="selectable input flex-1 font-mono">{phrase}</div>
          <button className="btn" onClick={() => copy(phrase)}><Copy size={14} /></button>
        </div>
        <Slider label="จำนวนคำ" value={words} min={3} max={8} onChange={setWords} />
      </div>
    </div>
  );
}

// ---------- แบ่ง/รวมไฟล์ ----------
export function SplitJoin() {
  const [file, setFile] = useState("");
  const [mb, setMb] = useState(100);
  const [result, setResult] = useState("");
  const split = async () => {
    const parts = await attempt(() => call<string[]>("split_file", { path: file, partMb: mb }));
    if (parts) setResult(`แบ่งเป็น ${parts.length} ส่วน:\n${parts.map(basename).join("\n")}`);
  };
  const join = async (first: string) => {
    const out = await attempt(() => call<string>("join_files", { first }), "รวมไฟล์เสร็จแล้ว");
    if (out) {
      setResult(`รวมเป็น ${out}`);
      revealPath(out);
    }
  };
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-3">
        <div className="label">แบ่งไฟล์</div>
        <DropZone onFiles={(p) => setFile(p[0])} multiple={false} compact label={file ? basename(file) : "ลากไฟล์ที่จะแบ่ง"} />
        <Field label="ขนาดแต่ละส่วน (MB)">
          <div className="flex gap-1.5">
            <input type="number" className="input" value={mb} min={1} onChange={(e) => setMb(Math.max(1, Number(e.target.value)))} />
            {[25, 100, 700, 4000].map((v) => <button key={v} className="chip" onClick={() => setMb(v)}>{v}</button>)}
          </div>
        </Field>
        <button className="btn-primary w-full" disabled={!file} onClick={split}>✂️ แบ่งไฟล์</button>
      </div>
      <div className="space-y-3">
        <div className="label">รวมไฟล์</div>
        <DropZone onFiles={(p) => join(p.find((x) => x.endsWith(".001")) ?? p[0])} multiple={false} compact label="ลากไฟล์ส่วนแรก (.001)" />
        <p className="text-xs text-muted">ไฟล์ .002 .003 ... ต้องอยู่โฟลเดอร์เดียวกัน</p>
      </div>
      {result && <pre className="selectable whitespace-pre-wrap rounded-xl bg-fg/5 p-3 text-xs md:col-span-2">{result}</pre>}
    </div>
  );
}

// ---------- บีบอัด/แตกไฟล์ ----------
export function ArchiveTool() {
  const [files, setFiles] = useState<string[]>([]);
  const [fmt, setFmt] = useState("zip");
  const [name, setName] = useState("");
  const [arc, setArc] = useState("");
  const [pw, setPw] = useState("");
  const pack = async () => {
    const base = name || stem(files[0]);
    const dest = joinPath(dirname(files[0]), `${base}.${fmt}`);
    const out = await attempt(() => call<string>(fmt === "zip" ? "zip_files" : "create_tar", { paths: files, dest }), "บีบอัดเสร็จแล้ว");
    if (out) revealPath(out);
  };
  const unpack = async (toSame: boolean) => {
    const dest = toSame ? joinPath(dirname(arc), stem(arc).replace(/\.(tar|7z)$/i, "")) : await pickFolder("แตกไฟล์ไปที่");
    if (!dest) return;
    const out = await attempt(() => call<string>("extract_archive", { src: arc, dest, password: pw || null }), "แตกไฟล์เสร็จแล้ว");
    if (out) revealPath(out);
  };
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-3">
        <div className="label">บีบอัด</div>
        <DropZone onFiles={setFiles} compact label={files.length ? `${files.length} รายการ` : "ลากไฟล์/โฟลเดอร์มาวาง"} />
        <div className="grid grid-cols-2 gap-2">
          <Select value={fmt} onChange={setFmt} options={[{ value: "zip", label: "ZIP" }, { value: "7z", label: "7Z (เล็กสุด)" }, { value: "tar", label: "TAR" }, { value: "tar.gz", label: "TAR.GZ" }]} />
          <input className="input" placeholder="ชื่อไฟล์" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <button className="btn-primary w-full" disabled={!files.length} onClick={pack}>📦 บีบอัด</button>
      </div>
      <div className="space-y-3">
        <div className="label">แตกไฟล์ (ZIP / 7z / RAR / TAR)</div>
        <DropZone onFiles={(p) => setArc(p[0])} accept={["zip", "7z", "rar", "tar", "gz", "tgz", "bz2", "xz"]} multiple={false} compact label={arc ? basename(arc) : "ลากไฟล์บีบอัดมาวาง"} />
        {arc.toLowerCase().endsWith(".7z") && <input className="input" type="password" placeholder="รหัสผ่าน (ถ้ามี)" value={pw} onChange={(e) => setPw(e.target.value)} />}
        <div className="flex gap-2">
          <button className="btn-primary flex-1" disabled={!arc} onClick={() => unpack(true)}>แตกไว้ที่เดิม</button>
          <button className="btn" disabled={!arc} onClick={() => unpack(false)}><FolderOpen size={14} /> เลือกที่</button>
        </div>
        <p className="text-xs text-muted">ZIP / 7z แตกด้วยตัวโปรแกรมเอง · RAR / TAR / GZ ใช้ tar.exe ของ Windows 10/11 (RAR ที่มีรหัสผ่านยังไม่รองรับ)</p>
      </div>
    </div>
  );
}

// ---------- ข้อความ ----------
export function countText(t: string) {
  const seg = "Segmenter" in Intl ? [...new (Intl as any).Segmenter("th", { granularity: "word" }).segment(t)].filter((s: any) => s.isWordLike).length : t.split(/\s+/).filter(Boolean).length;
  return { chars: [...t].length, noSpace: [...t.replace(/\s/g, "")].length, words: seg, lines: t ? t.split("\n").length : 0, thai: (t.match(/[฀-๿]/g) ?? []).length };
}
const TRANSFORMS: Record<string, (t: string) => string> = {
  "ตัวพิมพ์ใหญ่": (t) => t.toUpperCase(),
  "ตัวพิมพ์เล็ก": (t) => t.toLowerCase(),
  "Title Case": (t) => t.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()),
  "camelCase": (t) => t.toLowerCase().replace(/[^a-z0-9]+(.)/g, (_, c) => c.toUpperCase()),
  "snake_case": (t) => t.trim().toLowerCase().replace(/[^a-z0-9฀-๿]+/g, "_"),
  "kebab-case": (t) => t.trim().toLowerCase().replace(/[^a-z0-9฀-๿]+/g, "-"),
  "กลับด้าน": (t) => [...t].reverse().join(""),
  "เรียงบรรทัด": (t) => t.split("\n").sort((a, b) => a.localeCompare(b, "th")).join("\n"),
  "ลบบรรทัดซ้ำ": (t) => [...new Set(t.split("\n"))].join("\n"),
  "ลบบรรทัดว่าง": (t) => t.split("\n").filter((l) => l.trim()).join("\n"),
  "ตัดช่องว่างเกิน": (t) => t.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).join("\n"),
  "เลขไทย→อารบิก": (t) => t.replace(/[๐-๙]/g, (d) => String(d.charCodeAt(0) - 0x0e50)),
  "เลขอารบิก→ไทย": (t) => t.replace(/[0-9]/g, (d) => String.fromCharCode(0x0e50 + Number(d))),
  "แก้ภาษาลืมเปลี่ยน (EN→TH)": (t) => [...t].map((c) => KEYMAP[c] ?? c).join(""),
};
const EN = "1234567890-=qwertyuiop[]asdfghjkl;'zxcvbnm,./!@#$%^&*()_+QWERTYUIOP{}ASDFGHJKL:\"ZXCVBNM<>?";
const TH = "ๅ/-ภถุึคตจขชๆไำพะัีรนยบลฟหกดเ้่าสวงผปแอิืทมใฝ+๑๒๓๔ู฿๕๖๗๘๙๐\"ฎฑธํ๊ณฯญฐ,ฤฆฏโฌ็๋ษศซ.()ฉฮฺ์?ฒฬฦ";
const KEYMAP: Record<string, string> = Object.fromEntries([...EN].map((c, i) => [c, [...TH][i] ?? c]));

export function TextTools() {
  const [text, setText] = useState("");
  const [find, setFind] = useState("");
  const [rep, setRep] = useState("");
  const [useRe, setUseRe] = useState(false);
  const c = countText(text);
  const replace = () => {
    try {
      setText(useRe ? text.replace(new RegExp(find, "g"), rep) : text.split(find).join(rep));
    } catch (e) {
      useApp.getState().toast(`Regex ผิด: ${(e as Error).message}`, "error");
    }
  };
  return (
    <div className="space-y-3">
      <textarea className="input h-48" value={text} onChange={(e) => setText(e.target.value)} placeholder="วางข้อความที่นี่" />
      <div className="grid grid-cols-5 gap-2 text-center text-xs">
        {[["ตัวอักษร", c.chars], ["ไม่รวมช่องว่าง", c.noSpace], ["คำ", c.words], ["บรรทัด", c.lines], ["อักษรไทย", c.thai]].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-fg/5 p-2"><div className="font-mono text-lg">{v}</div>{k}</div>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {Object.keys(TRANSFORMS).map((k) => <button key={k} className="chip hover:bg-accent/40" onClick={() => setText(TRANSFORMS[k](text))}>{k}</button>)}
        <button className="chip hover:bg-accent/40" onClick={() => copy(text)}>📋 คัดลอก</button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input className="input flex-1" placeholder="ค้นหา" value={find} onChange={(e) => setFind(e.target.value)} />
        <input className="input flex-1" placeholder="แทนที่ด้วย" value={rep} onChange={(e) => setRep(e.target.value)} />
        <Toggle label="Regex" checked={useRe} onChange={setUseRe} />
        <button className="btn" disabled={!find} onClick={replace}>แทนที่ทั้งหมด</button>
      </div>
    </div>
  );
}

// ---------- Markdown ----------
const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function inline(s: string) {
  return escHtml(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, a, u) => (/^(https?:|data:image)/.test(u) ? `<img alt="${a}" src="${u}">` : a))
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, a, u) => (/^(https?:|mailto:|#)/.test(u) ? `<a href="${u}" target="_blank" rel="noreferrer">${a}</a>` : a))
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>");
}
/** ตัวแปลง Markdown อย่างง่าย (ปลอดภัย: escape HTML ก่อนเสมอ) */
export function markdownToHtml(md: string): string {
  const out: string[] = [];
  const lines = md.replace(/\r/g, "").split("\n");
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^```/.test(l)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${escHtml(buf.join("\n"))}</code></pre>`);
      continue;
    }
    const h = l.match(/^(#{1,6})\s+(.*)/);
    if (h) {
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(l)) {
      out.push("<hr>");
      i++;
      continue;
    }
    if (/^>\s?/.test(l)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ""));
      out.push(`<blockquote>${inline(buf.join(" "))}</blockquote>`);
      continue;
    }
    if (/^\s*([-*+]|\d+\.)\s+/.test(l)) {
      const ordered = /^\s*\d+\./.test(l);
      const buf: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        const item = lines[i++].replace(/^\s*([-*+]|\d+\.)\s+/, "");
        const task = item.match(/^\[( |x)\]\s*(.*)/i);
        buf.push(task ? `<li><input type="checkbox" disabled ${task[1] !== " " ? "checked" : ""}> ${inline(task[2])}</li>` : `<li>${inline(item)}</li>`);
      }
      out.push(ordered ? `<ol>${buf.join("")}</ol>` : `<ul>${buf.join("")}</ul>`);
      continue;
    }
    if (/^\|.*\|\s*$/.test(l) && /^\|?\s*:?-+/.test(lines[i + 1] ?? "")) {
      const row = (r: string) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = row(l);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && /^\|/.test(lines[i])) body.push(row(lines[i++]));
      out.push(`<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }
    if (!l.trim()) {
      i++;
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#|```|>|\s*([-*+]|\d+\.)\s|\|)/.test(lines[i])) buf.push(lines[i++]);
    if (!buf.length) buf.push(lines[i++]);
    out.push(`<p>${inline(buf.join(" "))}</p>`);
  }
  return out.join("\n");
}
export function MarkdownTool() {
  const [md, setMd] = useState("# หัวข้อ\n\nข้อความ **ตัวหนา** และ *ตัวเอียง* พร้อม `โค้ด`\n\n- [x] งานที่เสร็จ\n- [ ] งานที่ยังไม่เสร็จ\n\n| ชื่อ | ขนาด |\n|---|---|\n| คลิป.mp4 | 120 MB |\n\n> คำคม\n");
  const html = useMemo(() => markdownToHtml(md), [md]);
  const exportHtml = async () => {
    const { pickSave } = await import("@/lib/api");
    const out = await pickSave("เอกสาร.html", [{ name: "HTML", extensions: ["html"] }]);
    if (out) await attempt(() => call("write_text_file", { path: out, content: `<!doctype html><meta charset="utf-8"><style>body{font-family:Sarabun,sans-serif;max-width:800px;margin:auto;padding:2rem}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}pre{background:#f4f4f4;padding:1rem}</style>${html}` }), "บันทึกแล้ว");
  };
  return (
    <div className="space-y-2">
      <div className="grid gap-3 md:grid-cols-2">
        <textarea className="input h-[55vh] font-mono text-xs" value={md} onChange={(e) => setMd(e.target.value)} />
        <div className="md-preview selectable h-[55vh] overflow-auto rounded-xl bg-fg/5 p-4" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
      <div className="flex gap-2">
        <button className="btn" onClick={() => copy(html)}>คัดลอก HTML</button>
        <button className="btn" onClick={exportHtml}>บันทึกเป็น .html</button>
      </div>
    </div>
  );
}

// ---------- JSON / XML / YAML ----------
export function toYaml(v: unknown, ind = 0): string {
  const pad = "  ".repeat(ind);
  const scalar = (x: unknown) => {
    if (x === null || x === undefined) return "null";
    if (typeof x === "string") return /^[\w฀-๿][\w฀-๿ .\/-]*$/.test(x) && !/^(true|false|null|yes|no|[\d.]+)$/i.test(x) ? x : JSON.stringify(x);
    return String(x);
  };
  if (Array.isArray(v)) {
    if (!v.length) return "[]";
    return v.map((x) => (x && typeof x === "object" ? `${pad}-\n${toYaml(x, ind + 1)}` : `${pad}- ${scalar(x)}`)).join("\n");
  }
  if (v && typeof v === "object") {
    const e = Object.entries(v);
    if (!e.length) return "{}";
    return e.map(([k, x]) => (x && typeof x === "object" && Object.keys(x).length ? `${pad}${scalar(k)}:\n${toYaml(x, ind + 1)}` : `${pad}${scalar(k)}: ${x && typeof x === "object" ? (Array.isArray(x) ? "[]" : "{}") : scalar(x)}`)).join("\n");
  }
  return pad + scalar(v);
}
/** อ่าน YAML แบบพื้นฐาน (map/list/scalar แบบย่อหน้า) */
export function fromYaml(src: string): unknown {
  const lines = src.replace(/\r/g, "").split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));
  let i = 0;
  const scalar = (s: string): unknown => {
    s = s.trim();
    if (s === "" || s === "null" || s === "~") return null;
    if (s === "true") return true;
    if (s === "false") return false;
    if (s === "[]") return [];
    if (s === "{}") return {};
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
    if (/^".*"$/.test(s)) return JSON.parse(s);
    if (/^'.*'$/.test(s)) return s.slice(1, -1).replace(/''/g, "'");
    if (/^\[.*\]$/.test(s)) return s.slice(1, -1).split(",").map((x) => scalar(x)).filter((x) => x !== null);
    return s;
  };
  const indent = (l: string) => l.length - l.trimStart().length;
  const block = (level: number): unknown => {
    if (i >= lines.length) return null;
    if (lines[i].trimStart().startsWith("-")) {
      const arr: unknown[] = [];
      while (i < lines.length && indent(lines[i]) === level && lines[i].trimStart().startsWith("-")) {
        const rest = lines[i].trimStart().slice(1).trim();
        i++;
        if (!rest) arr.push(block(i < lines.length ? indent(lines[i]) : level + 2));
        else if (/^[^"'\s][^:]*:(\s|$)/.test(rest)) {
          // รายการที่เป็น map บรรทัดเดียวกัน
          const inner = level + 2;
          lines.splice(i, 0, " ".repeat(inner) + rest);
          arr.push(block(inner));
        } else arr.push(scalar(rest));
      }
      return arr;
    }
    const obj: Record<string, unknown> = {};
    while (i < lines.length && indent(lines[i]) === level) {
      const m = lines[i].trim().match(/^("[^"]*"|[^:]+):\s*(.*)$/);
      if (!m) throw new Error(`อ่านบรรทัดไม่ได้: ${lines[i].trim()}`);
      const key = String(scalar(m[1]));
      i++;
      if (m[2] === "" && i < lines.length && indent(lines[i]) > level) obj[key] = block(indent(lines[i]));
      else if (m[2] === "" && i < lines.length && indent(lines[i]) === level && lines[i].trimStart().startsWith("-")) obj[key] = block(level);
      else obj[key] = scalar(m[2]);
    }
    return obj;
  };
  return lines.length ? block(indent(lines[0])) : null;
}
function xmlToObj(n: Element): unknown {
  const kids = [...n.children];
  if (!kids.length && !n.attributes.length) return n.textContent ?? "";
  const o: Record<string, unknown> = {};
  for (const a of n.attributes) o[`@${a.name}`] = a.value;
  for (const k of kids) {
    const v = xmlToObj(k);
    o[k.tagName] = k.tagName in o ? [...(Array.isArray(o[k.tagName]) ? (o[k.tagName] as unknown[]) : [o[k.tagName]]), v] : v;
  }
  if (!kids.length && n.textContent) o["#text"] = n.textContent;
  return o;
}
function objToXml(v: unknown, tag: string, ind = 0): string {
  const pad = "  ".repeat(ind);
  const safe = tag.replace(/[^\w฀-๿.-]/g, "_").replace(/^(\d)/, "_$1");
  if (Array.isArray(v)) return v.map((x) => objToXml(x, tag, ind)).join("\n");
  if (v && typeof v === "object") {
    const e = Object.entries(v);
    const attrs = e.filter(([k]) => k.startsWith("@")).map(([k, x]) => ` ${k.slice(1)}="${escHtml(String(x))}"`).join("");
    const body = e.filter(([k]) => !k.startsWith("@") && k !== "#text").map(([k, x]) => objToXml(x, k, ind + 1)).join("\n");
    const text = (v as any)["#text"];
    if (!body) return `${pad}<${safe}${attrs}>${text !== undefined ? escHtml(String(text)) : ""}</${safe}>`;
    return `${pad}<${safe}${attrs}>\n${body}\n${pad}</${safe}>`;
  }
  return `${pad}<${safe}>${escHtml(String(v ?? ""))}</${safe}>`;
}
export function DataFormatter() {
  const [input, setInput] = useState('{"ชื่อ":"มีเดียทูลบ็อกซ์","เวอร์ชัน":1,"ฟีเจอร์":["โหลด","แปลง"]}');
  const [from, setFrom] = useState("json");
  const [to, setTo] = useState("json");
  const [indent, setIndent] = useState(2);
  const { output, error } = useMemo(() => {
    try {
      let data: unknown;
      if (from === "json") data = JSON.parse(input);
      else if (from === "yaml") data = fromYaml(input);
      else {
        const doc = new DOMParser().parseFromString(input, "application/xml");
        const err = doc.querySelector("parsererror");
        if (err) throw new Error(err.textContent ?? "XML ไม่ถูกต้อง");
        data = { [doc.documentElement.tagName]: xmlToObj(doc.documentElement) };
      }
      if (to === "json") return { output: JSON.stringify(data, null, indent), error: "" };
      if (to === "json-min") return { output: JSON.stringify(data), error: "" };
      if (to === "yaml") return { output: toYaml(data), error: "" };
      const obj = data as Record<string, unknown>;
      const keys = obj && typeof obj === "object" && !Array.isArray(obj) ? Object.keys(obj) : [];
      return { output: '<?xml version="1.0" encoding="UTF-8"?>\n' + (keys.length === 1 ? objToXml(obj[keys[0]], keys[0]) : objToXml(data, "root")), error: "" };
    } catch (e) {
      return { output: "", error: (e as Error).message };
    }
  }, [input, from, to, indent]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={from} onChange={setFrom} options={[{ value: "json", label: "จาก JSON" }, { value: "yaml", label: "จาก YAML" }, { value: "xml", label: "จาก XML" }]} />
        →
        <Select value={to} onChange={setTo} options={[{ value: "json", label: "JSON (จัดรูป)" }, { value: "json-min", label: "JSON (ย่อ)" }, { value: "yaml", label: "YAML" }, { value: "xml", label: "XML" }]} />
        <Select value={String(indent)} onChange={(v) => setIndent(Number(v))} options={[{ value: "2", label: "เว้น 2" }, { value: "4", label: "เว้น 4" }]} />
      </div>
      <textarea className="input h-40 font-mono text-xs" value={input} onChange={(e) => setInput(e.target.value)} />
      {error ? <p className="rounded-lg bg-red-500/15 p-2 text-sm text-red-300">❌ {error}</p> : <p className="text-sm text-green-300">✅ ข้อมูลถูกต้อง</p>}
      <Out value={output} />
    </div>
  );
}

// ---------- Base64 / URL ----------
export const b64encode = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
export const b64decode = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, "")), (c) => c.charCodeAt(0)));
const CODECS: Record<string, [(s: string) => string, (s: string) => string]> = {
  base64: [b64encode, b64decode],
  url: [encodeURIComponent, decodeURIComponent],
  html: [escHtml, (s) => new DOMParser().parseFromString(s, "text/html").documentElement.textContent ?? ""],
  hex: [(s) => [...new TextEncoder().encode(s)].map((b) => b.toString(16).padStart(2, "0")).join(" "), (s) => new TextDecoder().decode(Uint8Array.from(s.replace(/[^0-9a-f]/gi, "").match(/../g) ?? [], (h) => parseInt(h, 16)))],
  unicode: [(s) => [...s].map((c) => (c.charCodeAt(0) > 127 ? `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}` : c)).join(""), (s) => s.replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))],
};
export function EncodeTool() {
  const [text, setText] = useState("สวัสดี MediaToolbox");
  const [codec, setCodec] = useState("base64");
  const [dir, setDir] = useState<"enc" | "dec">("enc");
  let out = "";
  let err = "";
  try {
    out = CODECS[codec][dir === "enc" ? 0 : 1](text);
  } catch {
    err = "ถอดรหัสไม่ได้ ข้อมูลไม่ถูกรูปแบบ";
  }
  const jwt = codec === "base64" && dir === "dec" && /^[\w-]+\.[\w-]+\.[\w-]*$/.test(text.trim()) ? text.trim().split(".").slice(0, 2).map((p) => { try { return JSON.stringify(JSON.parse(b64decode(p)), null, 2); } catch { return ""; } }) : null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Select value={codec} onChange={setCodec} options={[{ value: "base64", label: "Base64" }, { value: "url", label: "URL" }, { value: "html", label: "HTML entity" }, { value: "hex", label: "Hex" }, { value: "unicode", label: "Unicode escape" }]} />
        <Select value={dir} onChange={setDir} options={[{ value: "enc", label: "เข้ารหัส" }, { value: "dec", label: "ถอดรหัส" }]} />
        <button className="btn" onClick={() => { setText(out); setDir(dir === "enc" ? "dec" : "enc"); }}>⇅ สลับ</button>
      </div>
      <textarea className="input h-32 font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} />
      {err ? <p className="text-sm text-red-300">{err}</p> : <Out value={out} />}
      {jwt && <div><div className="label">ข้อมูลใน JWT</div><Out value={jwt.join("\n\n")} /></div>}
    </div>
  );
}

// ---------- Regex ----------
const REGEX_PRESETS: [string, string][] = [
  ["อีเมล", "[\\w.+-]+@[\\w-]+\\.[\\w.]+"],
  ["เบอร์มือถือไทย", "0[689]\\d-?\\d{3}-?\\d{4}"],
  ["เลขบัตรประชาชน", "\\d-?\\d{4}-?\\d{5}-?\\d{2}-?\\d"],
  ["URL", "https?://[^\\s]+"],
  ["วันที่ dd/mm/yyyy", "\\d{1,2}/\\d{1,2}/\\d{4}"],
  ["ภาษาไทย", "[\\u0E00-\\u0E7F]+"],
];
export function RegexTester() {
  const [pattern, setPattern] = useState("[\\w.+-]+@[\\w-]+\\.[\\w.]+");
  const [flags, setFlags] = useState("g");
  const [text, setText] = useState("ติดต่อ hello@example.com หรือ admin@test.co.th โทร 081-234-5678");
  const [repl, setRepl] = useState("");
  const { matches, error, html } = useMemo(() => {
    try {
      const re = new RegExp(pattern, flags.includes("g") ? flags : flags + "g");
      const ms = pattern ? [...text.matchAll(re)] : [];
      let last = 0;
      let h = "";
      for (const m of ms) {
        if (m[0] === "") continue;
        h += escHtml(text.slice(last, m.index)) + `<mark class="rounded bg-accent/50 text-fg">${escHtml(m[0])}</mark>`;
        last = m.index! + m[0].length;
      }
      return { matches: ms, error: "", html: h + escHtml(text.slice(last)) };
    } catch (e) {
      return { matches: [], error: (e as Error).message, html: escHtml(text) };
    }
  }, [pattern, flags, text]);
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="flex flex-1 items-center rounded-xl bg-fg/5 px-2 font-mono">/<input className="flex-1 bg-transparent p-2 outline-none" value={pattern} onChange={(e) => setPattern(e.target.value)} />/</div>
        <input className="input w-20 font-mono" value={flags} onChange={(e) => setFlags(e.target.value.replace(/[^gimsuy]/g, ""))} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {REGEX_PRESETS.map(([n, p]) => <button key={n} className="chip hover:bg-accent/40" onClick={() => setPattern(p)}>{n}</button>)}
      </div>
      {error && <p className="text-sm text-red-300">❌ {error}</p>}
      <textarea className="input h-28" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="selectable whitespace-pre-wrap rounded-xl bg-fg/5 p-3" dangerouslySetInnerHTML={{ __html: html }} />
      <div className="text-sm text-muted">พบ {matches.length} รายการ</div>
      <div className="max-h-40 overflow-auto font-mono text-xs">
        {matches.map((m, i) => (
          <div key={i}>#{i + 1} @{m.index}: <b>{m[0]}</b> {m.length > 1 && <span className="text-muted">กลุ่ม: {m.slice(1).map((g) => JSON.stringify(g)).join(", ")}</span>}</div>
        ))}
      </div>
      <Field label="แทนที่ด้วย ($1 = กลุ่มที่ 1)"><input className="input font-mono" value={repl} onChange={(e) => setRepl(e.target.value)} /></Field>
      {repl && !error && <Out value={text.replace(new RegExp(pattern, flags), repl)} mono={false} />}
    </div>
  );
}

// ---------- แปลงหน่วย ----------
type Unit = [string, number];
const UNITS: Record<string, Unit[]> = {
  "ความยาว": [["มิลลิเมตร", 0.001], ["เซนติเมตร", 0.01], ["เมตร", 1], ["กิโลเมตร", 1000], ["นิ้ว", 0.0254], ["ฟุต", 0.3048], ["หลา", 0.9144], ["ไมล์", 1609.344], ["วา", 2], ["เส้น", 40]],
  "พื้นที่": [["ตารางเมตร", 1], ["ตารางวา", 4], ["งาน", 400], ["ไร่", 1600], ["ตารางกิโลเมตร", 1e6], ["ตารางฟุต", 0.092903], ["เอเคอร์", 4046.856], ["เฮกตาร์", 10000]],
  "น้ำหนัก": [["กรัม", 1], ["กิโลกรัม", 1000], ["ตัน", 1e6], ["ขีด", 100], ["ออนซ์", 28.3495], ["ปอนด์", 453.592], ["บาท (ทอง)", 15.244], ["สลึง (ทอง)", 3.811]],
  "ปริมาตร": [["มิลลิลิตร", 1], ["ลิตร", 1000], ["ลูกบาศก์เมตร", 1e6], ["ช้อนชา", 5], ["ช้อนโต๊ะ", 15], ["ถ้วยตวง", 240], ["แกลลอน (US)", 3785.41], ["ถัง", 20000]],
  "ข้อมูล": [["ไบต์", 1], ["KB", 1024], ["MB", 1024 ** 2], ["GB", 1024 ** 3], ["TB", 1024 ** 4], ["บิต", 1 / 8], ["Mbit", 1024 ** 2 / 8]],
  "เวลา": [["มิลลิวินาที", 0.001], ["วินาที", 1], ["นาที", 60], ["ชั่วโมง", 3600], ["วัน", 86400], ["สัปดาห์", 604800], ["ปี", 31557600]],
  "ความเร็ว": [["เมตร/วินาที", 1], ["กม./ชม.", 1 / 3.6], ["ไมล์/ชม.", 0.44704], ["นอต", 0.514444]],
  "อุณหภูมิ": [["เซลเซียส", 0], ["ฟาเรนไฮต์", 0], ["เคลวิน", 0]],
};
export function convertTemp(v: number, from: string, to: string) {
  const c = from === "ฟาเรนไฮต์" ? ((v - 32) * 5) / 9 : from === "เคลวิน" ? v - 273.15 : v;
  return to === "ฟาเรนไฮต์" ? (c * 9) / 5 + 32 : to === "เคลวิน" ? c + 273.15 : c;
}
export function UnitConverter() {
  const [cat, setCat] = useState("ความยาว");
  const [val, setVal] = useState(1);
  const [from, setFrom] = useState(UNITS["ความยาว"][2][0]);
  const units = UNITS[cat];
  const f = units.find((u) => u[0] === from) ?? units[0];
  const fmt = (n: number) => (Math.abs(n) >= 1e9 || (Math.abs(n) < 1e-4 && n !== 0) ? n.toExponential(4) : n.toLocaleString("th-TH", { maximumFractionDigits: 6 }));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {Object.keys(UNITS).map((k) => <button key={k} className={`chip ${cat === k ? "bg-accent/40" : ""}`} onClick={() => { setCat(k); setFrom(UNITS[k][0][0]); }}>{k}</button>)}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input type="number" className="input font-mono text-lg" value={val} onChange={(e) => setVal(Number(e.target.value))} />
        <Select value={f[0]} onChange={setFrom} options={units.map((u) => u[0])} />
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {units.filter((u) => u[0] !== f[0]).map((u) => {
          const r = cat === "อุณหภูมิ" ? convertTemp(val, f[0], u[0]) : (val * f[1]) / u[1];
          return (
            <div key={u[0]} className="flex cursor-pointer justify-between rounded-lg bg-fg/5 px-3 py-2 hover:bg-fg/10" onClick={() => copy(String(r))}>
              <span className="text-muted">{u[0]}</span><span className="font-mono">{fmt(r)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
