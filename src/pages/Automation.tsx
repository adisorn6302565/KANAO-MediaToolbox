// หน้า 7: จัดการอัตโนมัติ (สายงาน / กฎเฝ้าโฟลเดอร์ / ตั้งเวลา / เปลี่ยนชื่อ / จัดเรียง)
import { useState } from "react";
import { Workflow, Plus, Trash2, Play, FolderOpen, GripVertical, Save, ArrowRight, Clock, FolderTree } from "lucide-react";
import { Card, Empty, Field, PageHeader, Select, Tabs, Toggle, useReorder, moveItem } from "@/components/ui";
import { api, call, pickFolder } from "@/lib/api";
import { attempt, useApp } from "@/store/app";
import { useKv } from "@/hooks/useData";
import { RULES_KEY, SCHEDULES_KEY, isScheduleDue, newRule, type Rule, type Schedule } from "@/lib/automation";
import { buildCompressVideo, buildConvertArgs, defaultConvert } from "@/lib/ffmpeg";
import { formatDate, joinPath, outputPath, basename } from "@/lib/format";
import { parseUrls } from "./Downloader";
import { BatchRename } from "./Compressor";

type Tab = "pipeline" | "rules" | "schedule" | "rename" | "organize";

export default function Automation() {
  const [tab, setTab] = useState<Tab>("pipeline");
  return (
    <div>
      <PageHeader title="จัดการอัตโนมัติ" subtitle="สายงานหลายขั้น · กฎถ้า-แล้ว · เฝ้าโฟลเดอร์ · ตั้งเวลาโหลด" icon={<Workflow />} />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "pipeline", label: "สายงาน" },
          { id: "rules", label: "กฎเฝ้าโฟลเดอร์" },
          { id: "schedule", label: "ตั้งเวลาโหลด" },
          { id: "rename", label: "เปลี่ยนชื่อกลุ่ม" },
          { id: "organize", label: "จัดเรียงไฟล์" },
        ]}
      />
      {tab === "pipeline" && <Pipelines />}
      {tab === "rules" && <Rules />}
      {tab === "schedule" && <Schedules />}
      {tab === "rename" && <BatchRename />}
      {tab === "organize" && <Organize />}
    </div>
  );
}

// ---------- สายงาน ----------
export interface Step {
  id: string;
  type: "download" | "convert" | "compress" | "move";
  value: string;
}
interface Pipeline {
  id: string;
  name: string;
  steps: Step[];
}

const STEP_LABEL: Record<Step["type"], { label: string; hint: string; color: string }> = {
  download: { label: "📥 โหลด", hint: "โหมด: video / audio", color: "from-fuchsia-500/40" },
  convert: { label: "🔄 แปลง", hint: "ฟอร์แมตปลายทาง เช่น mp4, mp3", color: "from-cyan-500/40" },
  compress: { label: "🗜️ บีบอัด", hint: "ระดับ CRF เช่น 28", color: "from-lime-500/40" },
  move: { label: "📁 ย้าย", hint: "โฟลเดอร์ปลายทาง", color: "from-amber-500/40" },
};

/** รอให้งานเสร็จ (ดูจากสถานะใน store) */
function waitJob(id: string): Promise<string> {
  return new Promise((res, rej) => {
    const un = useApp.subscribe((s) => {
      const j = s.jobs[id];
      if (!j) return;
      if (j.status === "done") {
        un();
        res(j.output);
      } else if (j.status === "failed" || j.status === "cancelled") {
        un();
        rej(new Error(j.message || "งานไม่สำเร็จ"));
      }
    });
  });
}

async function runPipeline(p: Pipeline, input: string) {
  const toast = useApp.getState().toast;
  const settings = useApp.getState().settings!;
  let files: string[] = input.startsWith("http") ? [] : [input];
  for (const [i, s] of p.steps.entries()) {
    toast(`สายงาน "${p.name}" ขั้นที่ ${i + 1}: ${STEP_LABEL[s.type].label}`);
    if (s.type === "download") {
      const audio = s.value === "audio";
      const jobs = await api.startDownload({ urls: parseUrls(input), mode: audio ? "audio" : "video", quality: "best", format: audio ? "mp3" : "mp4", subtitles: false, subLangs: "", thumbnail: false, metadata: true, playlist: false, liveFromStart: false, outputDir: settings.downloadDir, template: "", extraArgs: [] });
      files = await Promise.all(jobs.map((j) => waitJob(j.id)));
    } else if (s.type === "convert") {
      files = await Promise.all(
        files.map(async (f) => {
          const out = outputPath(f, s.value || "mp4", "_แปลง");
          const j = await api.ffmpegJob({ kind: "convert", title: `[${p.name}] แปลง ${basename(f)}`, input: f, output: out, passes: [buildConvertArgs(f, out, { ...defaultConvert, format: s.value || "mp4" })] });
          return waitJob(j.id);
        }),
      );
    } else if (s.type === "compress") {
      files = await Promise.all(
        files.map(async (f) => {
          const out = outputPath(f, "mp4", "_เล็ก");
          const passes = buildCompressVideo(f, out, { mode: "crf", crf: Number(s.value) || 28, targetMB: 0, duration: 0, maxHeight: 1080, twoPass: false, codec: "h264", audioKbps: 128, hw: "none" });
          const j = await api.ffmpegJob({ kind: "compress", title: `[${p.name}] บีบอัด ${basename(f)}`, input: f, output: out, passes });
          return waitJob(j.id);
        }),
      );
    } else if (s.type === "move") {
      files = await call<string[]>("move_files", { paths: files, dest: s.value, copy: false });
    }
  }
  toast(`✅ สายงาน "${p.name}" เสร็จแล้ว (${files.length} ไฟล์)`, "success");
}

function Pipelines() {
  const [pipes, setPipes] = useKv<Pipeline[]>("automation.pipelines", [
    { id: "p1", name: "โหลดเพลงแล้วเก็บเข้าโฟลเดอร์", steps: [{ id: "a", type: "download", value: "audio" }, { id: "b", type: "move", value: "" }] },
  ]);
  const [sel, setSel] = useState(0);
  const [input, setInput] = useState("");
  const p = pipes[sel];
  const upd = (patch: Partial<Pipeline>) => setPipes((all) => all.map((x, i) => (i === sel ? { ...x, ...patch } : x)));
  const reorder = useReorder((from, to) => setPipes((all) => all.map((x, i) => (i === sel ? { ...x, steps: moveItem(x.steps, from, to) } : x))));
  const updStep = (id: string, value: string) => upd({ steps: p.steps.map((s) => (s.id === id ? { ...s, value } : s)) });

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <Card title="สายงานที่บันทึกไว้" actions={<button className="btn btn-sm" onClick={() => { setPipes([...pipes, { id: crypto.randomUUID(), name: "สายงานใหม่", steps: [] }]); setSel(pipes.length); }}><Plus size={13} /></button>}>
        {pipes.map((x, i) => (
          <div key={x.id} onClick={() => setSel(i)} className={`group flex cursor-pointer items-center rounded-lg px-2 py-1.5 text-sm ${i === sel ? "bg-accent/25" : "hover:bg-fg/5"}`}>
            <span className="flex-1 truncate">{x.name}</span>
            <button className="hidden group-hover:block" onClick={(e) => { e.stopPropagation(); setPipes(pipes.filter((_, k) => k !== i)); setSel(0); }}><Trash2 size={12} /></button>
          </div>
        ))}
      </Card>
      {p ? (
        <Card>
          <input className="input mb-3 text-lg font-semibold" value={p.name} onChange={(e) => upd({ name: e.target.value })} />
          <div className="mb-2 flex flex-wrap gap-1.5">
            <span className="label w-full">กดเพื่อเพิ่มขั้นตอน (ลากการ์ดเพื่อสลับลำดับ)</span>
            {(Object.keys(STEP_LABEL) as Step["type"][]).map((t) => (
              <button key={t} className="chip hover:bg-accent/40" onClick={() => upd({ steps: [...p.steps, { id: crypto.randomUUID(), type: t, value: t === "convert" ? "mp4" : t === "compress" ? "28" : t === "download" ? "video" : "" }] })}>
                {STEP_LABEL[t].label}
              </button>
            ))}
          </div>
          <div
            className="flex min-h-40 flex-wrap items-center gap-2 rounded-xl border-2 border-dashed border-fg/10 p-3"
          >
            {p.steps.length === 0 && <span className="m-auto text-sm text-muted">กดปุ่มด้านบนเพื่อเพิ่มขั้นตอน</span>}
            {p.steps.map((s, i) => (
              <div key={s.id} className="flex items-center gap-2">
                {i > 0 && <ArrowRight size={16} className="text-muted" />}
                <div
                  {...reorder(i)}
                  className={`w-48 rounded-xl border border-fg/10 bg-gradient-to-br ${STEP_LABEL[s.type].color} to-transparent p-2`}
                >
                  <div className="mb-1 flex items-center gap-1 text-sm font-semibold">
                    <GripVertical size={13} className="cursor-grab text-muted" /> {i + 1}. {STEP_LABEL[s.type].label}
                    <button className="ml-auto" onClick={() => upd({ steps: p.steps.filter((x) => x.id !== s.id) })}><Trash2 size={12} /></button>
                  </div>
                  {s.type === "move" ? (
                    <button className="input truncate text-left text-xs" onClick={async () => { const d = await pickFolder(); if (d) updStep(s.id, d); }}>{s.value || "เลือกโฟลเดอร์…"}</button>
                  ) : s.type === "download" ? (
                    <Select value={s.value} onChange={(v) => updStep(s.id, v)} options={[{ value: "video", label: "วิดีโอ" }, { value: "audio", label: "เสียง MP3" }]} />
                  ) : (
                    <input className="input text-xs" value={s.value} placeholder={STEP_LABEL[s.type].hint} onChange={(e) => updStep(s.id, e.target.value)} />
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex gap-2">
            <input className="input" value={input} onChange={(e) => setInput(e.target.value)} placeholder={p.steps[0]?.type === "download" ? "วางลิงก์ที่จะโหลด" : "พาธไฟล์เริ่มต้น"} />
            <button className="btn-primary" disabled={!input || !p.steps.length} onClick={() => runPipeline(p, input.trim()).catch((e) => useApp.getState().toast(`สายงานหยุด: ${e.message ?? e}`, "error"))}>
              <Play size={15} /> รันสายงาน
            </button>
          </div>
          <p className="mt-2 flex items-center gap-1 text-xs text-muted"><Save size={12} /> บันทึกอัตโนมัติ — ใช้ซ้ำได้ทุกครั้ง</p>
        </Card>
      ) : (
        <Empty text="ยังไม่มีสายงาน" />
      )}
    </div>
  );
}

// ---------- กฎเฝ้าโฟลเดอร์ ----------
function Rules() {
  const [rules, setRules] = useKv<Rule[]>(RULES_KEY, []);
  const upd = (id: string, patch: Partial<Rule>) => setRules(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const templates: { label: string; make: () => Rule }[] = [
    { label: "ถ้า .mov → แปลงเป็น .mp4", make: () => ({ ...newRule(), name: "MOV → MP4", exts: ["mov"], action: "convert", target: "mp4" }) },
    { label: "ถ้าใหญ่กว่า 500MB → บีบอัด", make: () => ({ ...newRule(), name: "บีบอัดไฟล์ใหญ่", exts: ["mp4", "mkv", "mov"], minSizeMB: 500, action: "compress", target: "28" }) },
    { label: "ถ้าเป็นรูป → ย้ายไปโฟลเดอร์รูป", make: () => ({ ...newRule(), name: "ย้ายรูป", exts: ["jpg", "png", "webp", "heic"], action: "move", target: "" }) },
  ];
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">เริ่มจากแม่แบบ:</span>
          {templates.map((t) => (
            <button key={t.label} className="chip hover:bg-accent/40" onClick={() => setRules([...rules, t.make()])}>{t.label}</button>
          ))}
          <button className="btn btn-sm ml-auto" onClick={() => setRules([...rules, newRule()])}><Plus size={13} /> กฎว่าง</button>
        </div>
        <p className="mt-2 text-xs text-muted">ระบบตรวจโฟลเดอร์ทุก 15 วินาที เฉพาะไฟล์ใหม่ที่เกิดหลังสร้างกฎ (ทำงานตอนโปรแกรมเปิดหรือย่ออยู่ในถาดระบบ)</p>
      </Card>
      {rules.length === 0 && <Empty text="ยังไม่มีกฎ" />}
      {rules.map((r) => (
        <Card key={r.id}>
          <div className="flex flex-wrap items-center gap-2">
            <Toggle label="" checked={r.enabled} onChange={(v) => upd(r.id, { enabled: v })} />
            <input className="input w-56 font-semibold" value={r.name} onChange={(e) => upd(r.id, { name: e.target.value })} />
            <span className="chip">ทำงานแล้ว {r.count} ครั้ง</span>
            <button className="btn btn-sm ml-auto" onClick={() => setRules(rules.filter((x) => x.id !== r.id))}><Trash2 size={13} /></button>
          </div>
          <div className="mt-3 grid items-end gap-2 md:grid-cols-[1.4fr_1fr_0.6fr_auto_0.8fr_1.2fr]">
            <Field label="เฝ้าโฟลเดอร์">
              <button className="input truncate text-left text-xs" onClick={async () => { const d = await pickFolder(); if (d) upd(r.id, { folder: d, lastRun: Date.now() }); }}>
                <FolderOpen size={12} className="mr-1 inline" /> {r.folder || "เลือก…"}
              </button>
            </Field>
            <Field label="ถ้านามสกุลเป็น">
              <input className="input font-mono text-xs" value={r.exts.join(", ")} placeholder="ทุกไฟล์" onChange={(e) => upd(r.id, { exts: e.target.value.split(/[,\s]+/).filter(Boolean) })} />
            </Field>
            <Field label="และใหญ่กว่า (MB)">
              <input type="number" className="input" value={r.minSizeMB} onChange={(e) => upd(r.id, { minSizeMB: Number(e.target.value) })} />
            </Field>
            <ArrowRight className="mb-2 text-muted" />
            <Field label="แล้ว">
              <Select value={r.action} onChange={(v) => upd(r.id, { action: v, target: v === "convert" ? "mp4" : v === "compress" ? "28" : "" })} options={[{ value: "convert", label: "แปลง" }, { value: "compress", label: "บีบอัด" }, { value: "move", label: "ย้าย" }, { value: "copy", label: "คัดลอก" }]} />
            </Field>
            <Field label={r.action === "convert" ? "เป็นฟอร์แมต" : r.action === "compress" ? "ระดับ CRF" : "ไปยังโฟลเดอร์"}>
              {r.action === "move" || r.action === "copy" ? (
                <button className="input truncate text-left text-xs" onClick={async () => { const d = await pickFolder(); if (d) upd(r.id, { target: d }); }}>{r.target || "เลือก…"}</button>
              ) : (
                <input className="input" value={r.target} onChange={(e) => upd(r.id, { target: e.target.value })} />
              )}
            </Field>
          </div>
        </Card>
      ))}
    </div>
  );
}

// ---------- ตั้งเวลาโหลด ----------
function Schedules() {
  const [items, setItems] = useKv<Schedule[]>(SCHEDULES_KEY, []);
  const [draft, setDraft] = useState<Schedule>({ id: "", name: "ช่องโปรด", enabled: true, urls: [], mode: "video", time: "06:00", lastRun: "" });
  const [urls, setUrls] = useState("");
  const add = () => {
    const u = parseUrls(urls);
    if (!u.length) return useApp.getState().toast("ใส่ลิงก์อย่างน้อย 1 ลิงก์", "error");
    const item = { ...draft, id: crypto.randomUUID(), urls: u, lastRun: "" };
    // เพิ่มหลังเวลาที่ตั้งไว้ของวันนี้ → เริ่มรันพรุ่งนี้ (ไม่เด้งโหลดทันทีตอนกดเพิ่ม)
    if (isScheduleDue(item, new Date())) item.lastRun = new Date().toDateString();
    setItems([...items, item]);
    setUrls("");
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
      <Card title="เพิ่มงานตั้งเวลา">
        <div className="space-y-3">
          <Field label="ชื่อ (ใช้เป็นชื่อโฟลเดอร์)">
            <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </Field>
          <Field label="ลิงก์ช่อง / เพลย์ลิสต์" hint="โหลดเฉพาะคลิปใหม่ที่ยังไม่เคยโหลด (ใช้ไฟล์ archive.txt)">
            <textarea className="input h-24 font-mono text-xs" value={urls} onChange={(e) => setUrls(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="เวลา (ทุกวัน)">
              <input type="time" className="input" value={draft.time} onChange={(e) => setDraft({ ...draft, time: e.target.value })} />
            </Field>
            <Field label="โหมด">
              <Select value={draft.mode} onChange={(v) => setDraft({ ...draft, mode: v })} options={[{ value: "video", label: "วิดีโอ" }, { value: "audio", label: "เสียง" }]} />
            </Field>
          </div>
          <button className="btn-primary w-full" onClick={add}><Clock size={15} /> เพิ่มงาน</button>
        </div>
      </Card>
      <Card title="งานตั้งเวลา">
        {items.length === 0 && <Empty text="ยังไม่มีงานตั้งเวลา" />}
        {items.map((s) => (
          <div key={s.id} className="flex items-center gap-3 border-b border-fg/5 py-2">
            <Toggle label="" checked={s.enabled} onChange={(v) => setItems(items.map((x) => (x.id === s.id ? { ...x, enabled: v } : x)))} />
            <span className="font-mono text-lg text-accent2">{s.time}</span>
            <div className="min-w-0 flex-1">
              <div className="font-medium">{s.name} <span className="chip">{s.mode === "audio" ? "เสียง" : "วิดีโอ"}</span></div>
              <div className="truncate text-xs text-muted">{s.urls.join(" · ")}</div>
              <div className="text-[11px] text-muted">รันล่าสุด: {s.lastRun ? formatDate(s.lastRun, false) : "ยังไม่เคย"}</div>
            </div>
            <button className="btn btn-sm" title="รันเดี๋ยวนี้" onClick={() => { const st = useApp.getState().settings!; attempt(() => api.startDownload({ urls: s.urls, mode: s.mode, quality: "best", format: s.mode === "audio" ? "mp3" : "mp4", subtitles: false, subLangs: "", thumbnail: false, metadata: true, playlist: true, liveFromStart: false, outputDir: joinPath(st.downloadDir, s.name), template: "", extraArgs: ["--download-archive", joinPath(st.downloadDir, s.name, "archive.txt")] }), "เริ่มโหลดแล้ว"); }}><Play size={13} /></button>
            <button className="btn btn-sm" onClick={() => setItems(items.filter((x) => x.id !== s.id))}><Trash2 size={13} /></button>
          </div>
        ))}
      </Card>
    </div>
  );
}

// ---------- จัดเรียงไฟล์ ----------
function Organize() {
  const [dir, setDir] = useState("");
  const [by, setBy] = useState("kind");
  const run = async () => {
    const n = await attempt(() => call<number>("organize_files", { dir, by }));
    if (n !== undefined) useApp.getState().toast(`จัดเรียงแล้ว ${n} ไฟล์`, "success");
  };
  return (
    <Card>
      <div className="grid max-w-xl gap-3">
        <Field label="โฟลเดอร์ที่ต้องการจัด">
          <div className="flex gap-2">
            <input className="input" value={dir} onChange={(e) => setDir(e.target.value)} />
            <button className="btn" onClick={async () => { const d = await pickFolder(); if (d) setDir(d); }}><FolderOpen size={14} /></button>
          </div>
        </Field>
        <Field label="จัดตาม">
          <Select value={by} onChange={setBy} options={[{ value: "kind", label: "ชนิดไฟล์ (วิดีโอ/เสียง/รูป/เอกสาร…)" }, { value: "ext", label: "นามสกุล (MP4/JPG…)" }, { value: "date", label: "ปี-เดือน ที่แก้ไข" }, { value: "size", label: "ขนาด (เล็ก/กลาง/ใหญ่)" }]} />
        </Field>
        <button className="btn-primary" disabled={!dir} onClick={run}><FolderTree size={15} /> จัดเรียงเลย</button>
        <p className="text-xs text-muted">ไฟล์จะถูกย้ายเข้าโฟลเดอร์ย่อยภายในโฟลเดอร์เดิม ถ้าชื่อซ้ำจะเติมตัวเลขต่อท้าย</p>
      </div>
    </Card>
  );
}
