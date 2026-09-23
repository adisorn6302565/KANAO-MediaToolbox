// หน้า 4: บีบอัดไฟล์ (PDF / รูป / วิดีโอ)
import { useState } from "react";
import { Minimize2, FileText, Image as ImageIcon, Film, Play, Lock, RotateCw, Trash2, FilePlus, Merge, Split, Eye, TextCursorInput } from "lucide-react";
import { Card, DropZone, Field, PageHeader, Select, Slider, Tabs, Toggle } from "@/components/ui";
import { JobList, useJobs } from "@/components/JobList";
import { api, call, pickSave, revealPath } from "@/lib/api";
import { attempt, useApp } from "@/store/app";
import { buildCompressImage, buildCompressVideo, type HwAccel } from "@/lib/ffmpeg";
import { IMAGE_EXT, VIDEO_EXT, basename, dirname, extname, formatBytes, joinPath, outputPath, stem } from "@/lib/format";
import { CompareModal, probeSummary } from "./Converter";

type Tab = "pdf" | "image" | "video" | "rename";

export default function Compressor() {
  const [tab, setTab] = useState<Tab>("pdf");
  return (
    <div>
      <PageHeader title="บีบอัดไฟล์" subtitle="ลดขนาด PDF รูป และวิดีโอ พร้อมดูขนาดก่อน-หลัง" icon={<Minimize2 />} />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "pdf", label: <span className="flex items-center gap-1.5"><FileText size={14} /> PDF</span> },
          { id: "image", label: <span className="flex items-center gap-1.5"><ImageIcon size={14} /> รูปภาพ</span> },
          { id: "video", label: <span className="flex items-center gap-1.5"><Film size={14} /> วิดีโอ</span> },
          { id: "rename", label: <span className="flex items-center gap-1.5"><TextCursorInput size={14} /> เปลี่ยนชื่อกลุ่ม</span> },
        ]}
      />
      {tab === "pdf" && <PdfTab />}
      {tab === "image" && <ImageTab />}
      {tab === "video" && <VideoTab />}
      {tab === "rename" && <BatchRename />}
    </div>
  );
}

function SizeResult({ before, after }: { before: number; after: number }) {
  const pct = before ? Math.round((1 - after / before) * 100) : 0;
  return (
    <div className="rounded-xl bg-fg/[.04] p-3">
      <div className="flex justify-between text-sm">
        <span>ก่อน {formatBytes(before)}</span>
        <span>หลัง {formatBytes(after)}</span>
      </div>
      <div className="progress mt-2">
        <div style={{ width: `${before ? Math.min(100, (after / before) * 100) : 0}%` }} />
      </div>
      <div className={`mt-1 text-center font-mono text-lg ${pct > 0 ? "text-lime-300" : "text-amber-300"}`}>{pct > 0 ? `ลดลง ${pct}%` : `ไม่ลดลง (${pct}%)`}</div>
    </div>
  );
}

// ---------- PDF ----------
function PdfTab() {
  const toast = useApp((s) => s.toast);
  const [files, setFiles] = useState<string[]>([]);
  const [level, setLevel] = useState(1);
  const [result, setResult] = useState<{ before: number; after: number; out: string } | null>(null);
  const [pages, setPages] = useState("");
  const [rotate, setRotate] = useState("90");
  const [password, setPassword] = useState("");
  const [insertAt, setInsertAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const levels = ["low", "medium", "high"] as const;
  const levelLabel = ["ต่ำ (ไม่เสียคุณภาพ)", "กลาง (บีบรูป คมชัดดี)", "สูง (เล็กสุด เหมาะอ่านบนจอ)"];
  const first = files[0];

  const run = async (action: string, arg: string, suffix: string, inputs = files) => {
    if (!first) return toast("เลือกไฟล์ PDF ก่อน", "error");
    const out = action === "split" ? joinPath(dirname(first), `${stem(first)}_แยก`) : await pickSave(outputPath(first, "pdf", suffix));
    if (!out) return;
    setBusy(true);
    const r = await attempt(() => call<any>("pdf_tool", { action, inputs, output: out, arg }), "เสร็จแล้ว");
    setBusy(false);
    if (r && action === "compress") setResult({ before: r.before, after: r.after, out });
    if (r && action === "compress" && r.after >= r.before) toast("ไฟล์นี้บีบเพิ่มไม่ได้แล้ว (ไม่มีรูปที่ย่อได้) — ลองระดับ สูง");
    if (r?.files) toast(`แยกได้ ${r.files.length} ไฟล์`, "success");
    if (r) revealPath(action === "split" ? r.files?.[0] ?? out : out);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="ไฟล์ PDF">
        <DropZone onFiles={(p) => setFiles((f) => [...f, ...p.filter((x) => !f.includes(x))])} accept={["pdf"]} label="ลากไฟล์ PDF มาวาง (หลายไฟล์ = รวมได้)" compact={files.length > 0} />
        <div className="mt-2 space-y-1">
          {files.map((f, i) => (
            <div key={f} className="flex items-center gap-2 rounded-lg bg-fg/[.04] px-2 py-1.5 text-sm">
              <span className="font-mono text-xs text-muted">{i + 1}</span>
              <span className="flex-1 truncate">{basename(f)}</span>
              <button className="btn btn-sm" disabled={i === 0} onClick={() => setFiles((a) => { const b = [...a]; [b[i - 1], b[i]] = [b[i], b[i - 1]]; return b; })}>↑</button>
              <button className="btn btn-sm" onClick={() => setFiles((a) => a.filter((x) => x !== f))}><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
        {result && (
          <div className="mt-3">
            <SizeResult before={result.before} after={result.after} />
          </div>
        )}
      </Card>
      <div className="space-y-4">
        <Card title="ลดขนาด">
          <Slider label="ระดับการบีบอัด" value={level} min={0} max={2} format={(v) => levelLabel[v]} onChange={setLevel} />
          <p className="mt-1 text-xs text-muted">ลบข้อมูลเมตา ออบเจ็กต์ซ้ำ และสตรีมที่ไม่ใช้เสมอ · ระดับกลาง/สูงจะลดความละเอียดรูปถ้ามี Ghostscript</p>
          <button className="btn-primary mt-3 w-full" disabled={busy || !first} onClick={() => run("compress", levels[level], "_บีบอัด", [first])}>
            <Play size={15} /> บีบอัด PDF
          </button>
        </Card>
        <Card title="จัดการหน้า">
          <Field label="หน้า (เช่น 1,3,5-8)" hint="ใช้กับการลบ/หมุน/แยก — แยก: เว้นว่าง = แยกทุกหน้า">
            <input className="input font-mono" value={pages} onChange={(e) => setPages(e.target.value)} />
          </Field>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button className="btn" disabled={busy || files.length < 2} onClick={() => run("merge", "", "_รวม")}><Merge size={14} /> รวม {files.length} ไฟล์</button>
            <button className="btn" disabled={busy || !first} onClick={() => run("split", pages, "", [first])}><Split size={14} /> แยกหน้า</button>
            <button className="btn" disabled={busy || !first || !pages} onClick={() => run("delete", pages, "_ลบหน้า", [first])}><Trash2 size={14} /> ลบหน้า</button>
            <div className="flex gap-1">
              <Select value={rotate} onChange={setRotate} options={["90", "180", "270"]} className="w-20" />
              <button className="btn flex-1" disabled={busy || !first} onClick={() => run("rotate", `${rotate}|${pages}`, "_หมุน", [first])}><RotateCw size={14} /> หมุน</button>
            </div>
            <div className="col-span-2 flex gap-1">
              <input type="number" className="input w-24" min={0} value={insertAt} onChange={(e) => setInsertAt(Number(e.target.value))} title="แทรกหลังหน้าที่ (0 = หน้าแรก)" />
              <button className="btn flex-1" disabled={busy || !first} onClick={() => run("insert", String(insertAt), "_แทรก", [first])}><FilePlus size={14} /> แทรกหน้าว่างหลังหน้าที่ {insertAt}</button>
            </div>
          </div>
        </Card>
        <Card title="ใส่รหัสผ่าน">
          <div className="flex gap-2">
            <input type="password" className="input" placeholder="รหัสผ่าน" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button className="btn" disabled={busy || !first || password.length < 4} onClick={() => run("encrypt", password, "_ล็อก", [first])}><Lock size={14} /> ล็อก</button>
          </div>
          <p className="mt-1 text-xs text-muted">เข้ารหัส AES-256 ในตัวโปรแกรม (เปิดได้ใน Adobe Reader, Chrome, Edge) · ลายน้ำ PDF: ใช้หน้าความปลอดภัย</p>
        </Card>
      </div>
    </div>
  );
}

// ---------- รูปภาพ ----------
function ImageTab() {
  const toast = useApp((s) => s.toast);
  const [files, setFiles] = useState<string[]>([]);
  const [mode, setMode] = useState<"percent" | "size" | "dimension">("dimension");
  const [quality, setQuality] = useState(80);
  const [pct, setPct] = useState(70);
  const [maxSide, setMaxSide] = useState(1920);
  const [targetKB, setTargetKB] = useState(300);
  const [fmt, setFmt] = useState("webp");
  const [stripExif, setStripExif] = useState(true);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ in: string; out: string; before: number; after: number }[]>([]);
  const [compare, setCompare] = useState<{ a: string; b: string } | null>(null);

  const size = (p: string) => call<{ size: number }>("path_info", { path: p }).then((r) => r.size).catch(() => 0);

  const run = async () => {
    setBusy(true);
    const out: typeof results = [];
    for (const f of files) {
      const dest = outputPath(f, fmt === "เดิม" ? extname(f) : fmt, "_เล็ก");
      const before = await size(f);
      try {
        if (mode === "size") {
          // จำกัดขนาดไฟล์: ลดคุณภาพทีละขั้นจนได้ขนาดตามเป้า
          let q = 90;
          let after = Infinity;
          let side = 0;
          while (q >= 20) {
            await api.ffmpegExec(buildCompressImage(f, dest, { quality: q, maxSide: side, scalePct: 0, stripExif }));
            after = await size(dest);
            if (after <= targetKB * 1024) break;
            q -= 10;
            if (q < 40 && side === 0) side = 1920;
            else if (q < 40) side = Math.round(side * 0.8);
          }
          out.push({ in: f, out: dest, before, after });
        } else {
          await api.ffmpegExec(buildCompressImage(f, dest, { quality, maxSide: mode === "dimension" ? maxSide : 0, scalePct: mode === "percent" ? pct : 0, stripExif }));
          out.push({ in: f, out: dest, before, after: await size(dest) });
        }
      } catch (e) {
        toast(`${basename(f)}: ${String(e)}`, "error");
      }
      setResults([...out]);
    }
    setBusy(false);
    const b = out.reduce((a, r) => a + r.before, 0);
    const a = out.reduce((a, r) => a + r.after, 0);
    if (out.length) {
      toast(`บีบอัด ${out.length} รูป ประหยัด ${formatBytes(b - a)}`, "success");
      useApp.getState().unlock("saver");
    }
  };
  const tb = results.reduce((a, r) => a + r.before, 0);
  const ta = results.reduce((a, r) => a + r.after, 0);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <Card title={`รูปภาพ (${files.length})`} actions={files.length > 0 && <button className="btn btn-sm" onClick={() => { setFiles([]); setResults([]); }}>ล้าง</button>}>
        <DropZone onFiles={(p) => setFiles((f) => [...new Set([...f, ...p])])} accept={IMAGE_EXT} label="ลากรูปมาวาง (หลายรูปพร้อมกันได้)" compact={files.length > 0} />
        {results.length > 0 && (
          <div className="mt-3">
            <SizeResult before={tb} after={ta} />
          </div>
        )}
        <div className="mt-3 max-h-96 space-y-1 overflow-auto">
          {files.map((f) => {
            const r = results.find((x) => x.in === f);
            return (
              <div key={f} className="flex items-center gap-2 rounded-lg bg-fg/[.04] px-2 py-1.5 text-sm">
                <span className="flex-1 truncate">{basename(f)}</span>
                {r && (
                  <>
                    <span className="font-mono text-xs text-muted">{formatBytes(r.before)} → {formatBytes(r.after)}</span>
                    <span className="chip">{Math.round((1 - r.after / (r.before || 1)) * 100)}%</span>
                    <button className="btn btn-sm" onClick={() => setCompare({ a: r.in, b: r.out })}><Eye size={12} /></button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </Card>
      <Card title="ตัวเลือก">
        <Field label="โหมด">
          <Select value={mode} onChange={setMode} options={[{ value: "percent", label: "ลดเป็น %" }, { value: "size", label: "จำกัดขนาดไฟล์ (KB)" }, { value: "dimension", label: "จำกัดความละเอียด (px)" }]} />
        </Field>
        <div className="mt-3 space-y-3">
          {mode === "percent" && <Slider label="ขนาดภาพ" value={pct} min={10} max={100} suffix="%" onChange={setPct} />}
          {mode === "dimension" && <Slider label="ด้านยาวสุดไม่เกิน" value={maxSide} min={320} max={4096} step={16} suffix=" px" onChange={setMaxSide} />}
          {mode === "size" ? (
            <Field label="ขนาดไม่เกิน (KB)">
              <input type="number" className="input" value={targetKB} onChange={(e) => setTargetKB(Number(e.target.value))} />
            </Field>
          ) : (
            <Slider label="คุณภาพ" value={quality} min={10} max={100} suffix="%" onChange={setQuality} />
          )}
          <Field label="ส่งออกเป็น">
            <Select value={fmt} onChange={setFmt} options={["webp", "avif", "jpg", "png", "เดิม"]} />
          </Field>
          <Toggle label="ลบ EXIF / GPS" checked={stripExif} onChange={setStripExif} />
          <button className="btn-primary w-full" disabled={busy || !files.length} onClick={run}>
            <Play size={15} /> {busy ? `กำลังบีบอัด ${results.length}/${files.length}` : "เริ่มบีบอัด"}
          </button>
        </div>
      </Card>
      {compare && <CompareModal a={compare.a} b={compare.b} onClose={() => setCompare(null)} />}
    </div>
  );
}

// ---------- วิดีโอ ----------
function VideoTab() {
  const [files, setFiles] = useState<string[]>([]);
  const [mode, setMode] = useState<"crf" | "size">("crf");
  const [crf, setCrf] = useState(28);
  const [targetMB, setTargetMB] = useState(25);
  const [maxHeight, setMaxHeight] = useState("1080");
  const [twoPass, setTwoPass] = useState(true);
  const [codec, setCodec] = useState<"h264" | "h265">("h264");
  const [hw, setHw] = useState<HwAccel>("none");
  const [audioKbps, setAudioKbps] = useState(128);
  const jobs = useJobs(["compress"]);
  const [compare, setCompare] = useState<{ a: string; b: string } | null>(null);

  const run = async () => {
    for (const f of files) {
      const info = await probeSummary(f).catch(() => undefined);
      const duration = info?.duration ?? 0;
      const out = outputPath(f, "mp4", "_เล็ก");
      const passes = buildCompressVideo(f, out, { mode, crf, targetMB, duration, maxHeight: Number(maxHeight), twoPass, codec, audioKbps, hw });
      await attempt(() => api.ffmpegJob({ kind: "compress", title: `บีบอัด ${basename(f)}${mode === "size" ? ` → ${targetMB}MB` : ""}`, input: f, output: out, passes, duration }));
    }
    setFiles([]);
  };
  const done = jobs.filter((j) => j.status === "done");

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <Card>
          <DropZone onFiles={(p) => setFiles((f) => [...new Set([...f, ...p])])} accept={VIDEO_EXT} label="ลากวิดีโอมาวาง" compact={files.length > 0} />
          {files.map((f) => (
            <div key={f} className="mt-1 flex items-center gap-2 rounded-lg bg-fg/[.04] px-2 py-1.5 text-sm">
              <span className="flex-1 truncate">{basename(f)}</span>
              <button className="btn btn-sm" onClick={() => setFiles((a) => a.filter((x) => x !== f))}><Trash2 size={12} /></button>
            </div>
          ))}
        </Card>
        {done.length > 0 && (
          <Card title="ผลลัพธ์ล่าสุด" actions={<button className="btn btn-sm" onClick={() => setCompare({ a: done[0].input, b: done[0].output })}><Eye size={13} /> เทียบก่อน-หลัง</button>}>
            <SizeResult before={done.reduce((a, j) => a + j.sizeBefore, 0)} after={done.reduce((a, j) => a + j.sizeAfter, 0)} />
          </Card>
        )}
        <Card title="คิวบีบอัด">
          <JobList kinds={["compress"]} />
        </Card>
      </div>
      <Card title="ตัวเลือก">
        <div className="space-y-3">
          <Field label="วิธีบีบอัด">
            <Select value={mode} onChange={setMode} options={[{ value: "crf", label: "ตามคุณภาพ (แนะนำ)" }, { value: "size", label: "ตามขนาดไฟล์เป้าหมาย" }]} />
          </Field>
          {mode === "crf" ? (
            <Slider label="ระดับการบีบอัด (มาก = เล็กลง)" value={crf} min={18} max={40} onChange={setCrf} />
          ) : (
            <>
              <Field label="ขนาดเป้าหมาย (MB)" hint="Discord 10MB · LINE 300MB · อีเมล 25MB">
                <input type="number" className="input" value={targetMB} onChange={(e) => setTargetMB(Number(e.target.value))} />
              </Field>
              <Toggle label="Two-pass (แม่นยำกว่า ใช้เวลา 2 เท่า)" checked={twoPass} onChange={setTwoPass} />
            </>
          )}
          <Field label="ความละเอียดสูงสุด">
            <Select value={maxHeight} onChange={setMaxHeight} options={[{ value: "0", label: "คงเดิม" }, { value: "2160", label: "4K" }, { value: "1080", label: "1080p" }, { value: "720", label: "720p" }, { value: "480", label: "480p" }, { value: "360", label: "360p" }]} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Codec">
              <Select value={codec} onChange={setCodec} options={[{ value: "h264", label: "H.264" }, { value: "h265", label: "H.265 (เล็กกว่า)" }]} />
            </Field>
            <Field label="การ์ดจอ">
              <Select value={hw} onChange={setHw} options={[{ value: "none", label: "CPU" }, { value: "nvenc", label: "NVENC" }, { value: "qsv", label: "QSV" }, { value: "amf", label: "AMF" }]} />
            </Field>
          </div>
          <Slider label="บิตเรตเสียง" value={audioKbps} min={48} max={320} step={16} suffix=" kbps" onChange={setAudioKbps} />
          <button className="btn-primary w-full" disabled={!files.length} onClick={run}>
            <Play size={15} /> เริ่มบีบอัด ({files.length})
          </button>
        </div>
      </Card>
      {compare && <CompareModal a={compare.a} b={compare.b} onClose={() => setCompare(null)} />}
    </div>
  );
}

// ---------- เปลี่ยนชื่อเป็นกลุ่ม (ใช้ร่วมกับหน้าอัตโนมัติ) ----------
export function computeRename(files: string[], o: { pattern: string; find: string; replace: string; regex: boolean; start: number; pad: number; case: string }): { from: string; to: string }[] {
  return files.map((f, i) => {
    let name = stem(f);
    if (o.find) {
      try {
        name = o.regex ? name.replace(new RegExp(o.find, "g"), o.replace) : name.split(o.find).join(o.replace);
      } catch {
        /* regex ผิด ไม่เปลี่ยน */
      }
    }
    const n = String(o.start + i).padStart(o.pad, "0");
    let out = (o.pattern || "{name}").replace(/\{name\}/g, name).replace(/\{n\}/g, n).replace(/\{ext\}/g, extname(f));
    if (o.case === "upper") out = out.toUpperCase();
    if (o.case === "lower") out = out.toLowerCase();
    // คงตัวพิมพ์ของนามสกุลเดิม (extname() แปลงเป็นตัวเล็ก → .JPG จะถูกเปลี่ยนชื่อทั้งที่ไม่ได้สั่ง)
    const ext = extname(f) ? basename(f).slice(stem(f).length + 1) : "";
    return { from: f, to: joinPath(dirname(f), ext ? `${out}.${ext}` : out) };
  });
}

export function BatchRename() {
  const [files, setFiles] = useState<string[]>([]);
  const [o, setO] = useState({ pattern: "{name}", find: "", replace: "", regex: false, start: 1, pad: 3, case: "none" });
  const preview = computeRename(files, o);
  const apply = async () => {
    const changed = preview.filter((p) => p.from !== p.to);
    const done = await attempt(() => call<string[]>("rename_files", { pairs: changed }));
    if (done !== undefined) {
      useApp.getState().toast(`เปลี่ยนชื่อแล้ว ${done.length} ไฟล์`, "success");
      // ใช้ชื่อจริงที่ได้ (อาจมี " (1)" ถ้าชนกับไฟล์อื่น) ไม่ใช่ชื่อที่คาดไว้
      const actual = new Map(changed.map((p, i) => [p.from, done[i] ?? p.to]));
      setFiles(files.map((f) => actual.get(f) ?? f));
    }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <Card title="ตัวอย่างชื่อใหม่">
        <DropZone onFiles={(p) => setFiles((f) => [...new Set([...f, ...p])])} label="ลากไฟล์ที่ต้องการเปลี่ยนชื่อมาวาง" compact={files.length > 0} />
        <div className="mt-2 max-h-[28rem] overflow-auto text-sm">
          {preview.map((p) => (
            <div key={p.from} className="grid grid-cols-2 gap-2 border-b border-fg/5 py-1">
              <span className="truncate text-muted">{basename(p.from)}</span>
              <span className={`truncate ${p.from !== p.to ? "text-accent2" : ""}`}>{basename(p.to)}</span>
            </div>
          ))}
        </div>
      </Card>
      <Card title="กฎการตั้งชื่อ">
        <div className="space-y-3">
          <Field label="แพทเทิร์น" hint="{name} = ชื่อเดิม, {n} = ตัวนับ, {ext} = นามสกุล">
            <input className="input font-mono" value={o.pattern} onChange={(e) => setO({ ...o, pattern: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="ค้นหา">
              <input className="input" value={o.find} onChange={(e) => setO({ ...o, find: e.target.value })} />
            </Field>
            <Field label="แทนที่ด้วย">
              <input className="input" value={o.replace} onChange={(e) => setO({ ...o, replace: e.target.value })} />
            </Field>
          </div>
          <Toggle label="ใช้ Regex" checked={o.regex} onChange={(v) => setO({ ...o, regex: v })} />
          <div className="grid grid-cols-2 gap-2">
            <Field label="เริ่มนับที่">
              <input type="number" className="input" value={o.start} onChange={(e) => setO({ ...o, start: Number(e.target.value) })} />
            </Field>
            <Field label="จำนวนหลัก">
              <input type="number" className="input" min={1} max={8} value={o.pad} onChange={(e) => setO({ ...o, pad: Number(e.target.value) })} />
            </Field>
          </div>
          <Field label="ตัวพิมพ์">
            <Select value={o.case} onChange={(v) => setO({ ...o, case: v })} options={[{ value: "none", label: "คงเดิม" }, { value: "upper", label: "พิมพ์ใหญ่" }, { value: "lower", label: "พิมพ์เล็ก" }]} />
          </Field>
          <button className="btn-primary w-full" disabled={!files.length} onClick={apply}>เปลี่ยนชื่อ {files.length} ไฟล์</button>
        </div>
      </Card>
    </div>
  );
}
