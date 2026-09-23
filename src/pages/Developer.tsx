// หน้า 15: นักพัฒนา (ทดสอบ API / API key / webhook / CLI / ปลั๊กอิน / log / cron)
import { useEffect, useMemo, useState } from "react";
import { Code2, Send, KeyRound, Webhook, Terminal, Puzzle, ScrollText, Clock, Plus, Trash2, Play, Copy, Download } from "lucide-react";
import { Card, Empty, Field, PageHeader, Select, Tabs, Toggle } from "@/components/ui";
import { api, call, type LogItem } from "@/lib/api";
import { attempt, useApp } from "@/store/app";
import { useKv } from "@/hooks/useData";
import { downloadText, formatDate, toCSV } from "@/lib/format";
import { SCHEDULES_KEY, type Schedule } from "@/lib/automation";

type Tab = "api" | "keys" | "webhook" | "cli" | "plugins" | "logs" | "cron";

export default function Developer() {
  const [tab, setTab] = useState<Tab>("api");
  return (
    <div>
      <PageHeader title="นักพัฒนา" subtitle="เครื่องมือสำหรับคนชอบลงลึก" icon={<Code2 />} />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "api", label: <span className="flex items-center gap-1"><Send size={14} /> ทดสอบ API</span> },
          { id: "keys", label: <span className="flex items-center gap-1"><KeyRound size={14} /> API key</span> },
          { id: "webhook", label: <span className="flex items-center gap-1"><Webhook size={14} /> Webhook</span> },
          { id: "cli", label: <span className="flex items-center gap-1"><Terminal size={14} /> CLI</span> },
          { id: "plugins", label: <span className="flex items-center gap-1"><Puzzle size={14} /> ปลั๊กอิน</span> },
          { id: "logs", label: <span className="flex items-center gap-1"><ScrollText size={14} /> Log</span> },
          { id: "cron", label: <span className="flex items-center gap-1"><Clock size={14} /> Cron</span> },
        ]}
      />
      {tab === "api" && <ApiTester />}
      {tab === "keys" && <ApiKeys />}
      {tab === "webhook" && <WebhookPanel />}
      {tab === "cli" && <Cli />}
      {tab === "plugins" && <Plugins />}
      {tab === "logs" && <Logs />}
      {tab === "cron" && <Cron />}
    </div>
  );
}

interface HttpResp {
  status: number;
  headers: string;
  body: string;
  millis: number;
}

function ApiTester() {
  const [method, setMethod] = useState("GET");
  const [url, setUrl] = useState("https://httpbin.org/get");
  const [headers, setHeaders] = useState("Accept: application/json");
  const [body, setBody] = useState("");
  const [resp, setResp] = useState<HttpResp | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useKv<{ method: string; url: string }[]>("dev.apiHistory", []);
  const send = async () => {
    setBusy(true);
    const h = headers.split("\n").map((l) => l.split(/:(.*)/s)).filter((x) => x[0].trim() && x[1] !== undefined).map(([k, v]) => [k.trim(), v.trim()]);
    const r = await attempt(() => call<HttpResp>("http_request", { req: { method, url, headers: h, body } }));
    setBusy(false);
    if (r) {
      setResp(r);
      setHistory([{ method, url }, ...history.filter((x) => x.url !== url || x.method !== method)].slice(0, 20));
    }
  };
  const pretty = useMemo(() => {
    if (!resp) return "";
    try {
      return JSON.stringify(JSON.parse(resp.body), null, 2);
    } catch {
      return resp.body;
    }
  }, [resp]);
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_240px]">
      <Card>
        <div className="flex gap-2">
          <Select value={method} onChange={setMethod} options={["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]} className="w-28" />
          <input className="input flex-1 font-mono text-sm" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
          <button className="btn-primary" disabled={busy} onClick={send}><Send size={14} /> {busy ? "…" : "ส่ง"}</button>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Field label="Headers (บรรทัดละ 1 ค่า)"><textarea className="input h-24 font-mono text-xs" value={headers} onChange={(e) => setHeaders(e.target.value)} /></Field>
          <Field label="Body"><textarea className="input h-24 font-mono text-xs" value={body} onChange={(e) => setBody(e.target.value)} disabled={method === "GET" || method === "HEAD"} /></Field>
        </div>
        {resp && (
          <div className="mt-3">
            <div className="mb-2 flex gap-3 text-sm">
              <span className={`chip ${resp.status < 300 ? "bg-lime-500/30" : resp.status < 400 ? "bg-amber-500/30" : "bg-red-500/30"}`}>{resp.status}</span>
              <span className="text-muted">{resp.millis} ms · {(resp.body.length / 1024).toFixed(1)} KB</span>
            </div>
            <details className="mb-2"><summary className="cursor-pointer text-sm text-muted">Headers</summary><pre className="selectable whitespace-pre-wrap text-xs">{resp.headers}</pre></details>
            <pre className="selectable max-h-[45vh] overflow-auto rounded-xl bg-black/30 p-3 text-xs">{pretty}</pre>
          </div>
        )}
      </Card>
      <Card title="ประวัติ">
        {history.length === 0 && <p className="text-sm text-muted">ยังไม่มี</p>}
        {history.map((h, i) => (
          <button key={i} className="block w-full truncate rounded px-1 py-1 text-left text-xs hover:bg-fg/5" onClick={() => { setMethod(h.method); setUrl(h.url); }}>
            <b className="text-accent2">{h.method}</b> {h.url}
          </button>
        ))}
      </Card>
    </div>
  );
}

interface ApiKey {
  id: string;
  name: string;
  key: string;
  created: number;
}
export function newApiKey(prefix = "mtb") {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return `${prefix}_${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
}
function ApiKeys() {
  const [keys, setKeys] = useKv<ApiKey[]>("dev.apiKeys", []);
  const [name, setName] = useState("");
  const [prefix, setPrefix] = useState("mtb");
  const [reveal, setReveal] = useState<string>("");
  const add = () => {
    const k = { id: crypto.randomUUID(), name: name || `คีย์ ${keys.length + 1}`, key: newApiKey(prefix), created: Date.now() };
    setKeys([k, ...keys]);
    setReveal(k.id);
    setName("");
  };
  return (
    <Card title="สร้าง API key แบบสุ่ม (ใช้กับโปรเจกต์ของคุณเอง)">
      <div className="flex flex-wrap gap-2">
        <input className="input w-24 font-mono" value={prefix} onChange={(e) => setPrefix(e.target.value.replace(/\W/g, ""))} />
        <input className="input flex-1" placeholder="ชื่อคีย์" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn-primary" onClick={add}><Plus size={14} /> สร้าง</button>
      </div>
      <p className="mt-1 text-xs text-muted">สุ่มจาก crypto.getRandomValues (192 บิต) เก็บไว้ในเครื่องเท่านั้น</p>
      <div className="mt-3 space-y-1.5">
        {keys.map((k) => (
          <div key={k.id} className="flex items-center gap-2 rounded-lg bg-fg/5 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="text-sm">{k.name} <span className="text-xs text-muted">· {formatDate(k.created)}</span></div>
              <div className="selectable truncate font-mono text-xs">{reveal === k.id ? k.key : k.key.slice(0, prefix.length + 5) + "•".repeat(20)}</div>
            </div>
            <button className="btn btn-sm" onClick={() => setReveal(reveal === k.id ? "" : k.id)}>{reveal === k.id ? "ซ่อน" : "ดู"}</button>
            <button className="btn btn-sm" onClick={() => { navigator.clipboard.writeText(k.key); useApp.getState().toast("คัดลอกแล้ว"); }}><Copy size={12} /></button>
            <button className="btn btn-sm" onClick={() => setKeys(keys.filter((x) => x.id !== k.id))}><Trash2 size={12} /></button>
          </div>
        ))}
      </div>
    </Card>
  );
}

function WebhookPanel() {
  const settings = useApp((s) => s.settings)!;
  const saveSettings = useApp((s) => s.saveSettings);
  const [url, setUrl] = useState(settings.webhookUrl);
  const [msg, setMsg] = useState("ทดสอบจากมีเดียทูลบ็อกซ์ 🎬");
  const kind = /discord(app)?\.com/.test(url) ? "Discord" : /hooks\.slack\.com/.test(url) ? "Slack" : url ? "ทั่วไป (JSON)" : "";
  return (
    <Card title="Webhook แจ้งเตือนเมื่องานเสร็จ/ล้มเหลว">
      <Field label="URL ของ webhook" hint="Discord / Slack ใช้ URL ของ Incoming Webhook ได้เลย">
        <input className="input font-mono text-xs" value={url} onChange={(e) => setUrl(e.target.value)} />
      </Field>
      {kind && <p className="mt-1 text-sm">ตรวจพบ: <b className="text-accent2">{kind}</b></p>}
      <div className="mt-3 flex gap-2">
        <button className="btn-primary" onClick={() => saveSettings({ webhookUrl: url.trim() }).then(() => useApp.getState().toast("บันทึกแล้ว", "success"))}>บันทึก</button>
        <input className="input flex-1" value={msg} onChange={(e) => setMsg(e.target.value)} />
        <button className="btn" disabled={!url} onClick={() => attempt(() => call<string>("send_webhook", { url, text: msg })).then((code) => code && useApp.getState().toast(`ส่งแล้ว (HTTP ${code})`, Number(code) < 300 ? "success" : "error"))}><Send size={14} /> ทดสอบ</button>
      </div>
      <p className="mt-3 text-xs text-muted">หมายเหตุ: LINE Notify ปิดให้บริการไปแล้วตั้งแต่ 31 มี.ค. 2025 — แนะนำให้ใช้ Discord หรือ Slack แทน</p>
    </Card>
  );
}

function Cli() {
  const [args, setArgs] = useState<string[]>([]);
  useEffect(() => {
    call<{ args: string[] }>("app_info").then((i) => setArgs(i.args)).catch(() => {});
  }, []);
  const rows = [
    ["MediaToolbox.exe --download <ลิงก์>", "เพิ่มงานโหลดคลิปเข้าคิว"],
    ["MediaToolbox.exe --download <ลิงก์> --audio", "โหลดเฉพาะเสียง (MP3)"],
    ["MediaToolbox.exe --convert <ไฟล์เข้า> <ไฟล์ออก>", "แปลงไฟล์ (รูปแบบตามนามสกุลปลายทาง)"],
    ["MediaToolbox.exe <ไฟล์วิดีโอ>", "เปิดไฟล์ในเครื่องเล่น"],
    ["MediaToolbox.exe --minimized", "เปิดโดยย่อลงถาดระบบ"],
  ];
  return (
    <Card title="โหมดคำสั่ง (CLI)">
      <p className="mb-3 text-sm text-muted">ถ้าโปรแกรมเปิดอยู่แล้ว คำสั่งจะถูกส่งเข้าหน้าต่างเดิม (ไม่เปิดซ้ำ)</p>
      <div className="space-y-2">
        {rows.map(([c, d]) => (
          <div key={c} className="flex items-center gap-2 rounded-lg bg-black/30 p-2">
            <code className="selectable flex-1 text-xs text-lime-300">{c}</code>
            <span className="text-xs text-muted">{d}</span>
            <button className="btn btn-sm" onClick={() => navigator.clipboard.writeText(c)}><Copy size={12} /></button>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">อาร์กิวเมนต์ของรอบนี้: <code>{args.length ? args.join(" ") : "(ไม่มี)"}</code></p>
    </Card>
  );
}

// ---------- ปลั๊กอิน ----------
interface Plugin {
  id: string;
  name: string;
  enabled: boolean;
  code: string;
}
const SAMPLE_PLUGIN = `// ปลั๊กอินตัวอย่าง: ทำงานเมื่อกด "รัน" หรือเมื่อเปิดโปรแกรม (ถ้าเปิดใช้งาน)
// ใช้ได้: mtb.toast(ข้อความ), mtb.call(คำสั่ง, อาร์กิวเมนต์), mtb.settings, mtb.log(ข้อความ)
const jobs = await mtb.call("list_jobs");
mtb.toast("ตอนนี้มีงานในคิว " + jobs.length + " งาน");
`;
export async function runPlugin(p: Pick<Plugin, "name" | "code">, out: (s: string) => void = () => {}) {
  const mtb = {
    toast: (t: string) => useApp.getState().toast(`[${p.name}] ${t}`),
    call: (cmd: string, args?: Record<string, unknown>) => call(cmd, args),
    settings: useApp.getState().settings,
    log: (m: unknown) => {
      out(typeof m === "string" ? m : JSON.stringify(m));
      api.log("info", `plugin:${p.name}`, String(m));
    },
  };
  // ปลั๊กอินเป็นโค้ดที่ผู้ใช้เขียน/วางเองในเครื่อง ทำงานในหน้าต่างโปรแกรม
  const AsyncFn = Object.getPrototypeOf(async () => {}).constructor;
  return new AsyncFn("mtb", p.code)(mtb);
}
function Plugins() {
  const [plugins, setPlugins] = useKv<Plugin[]>("dev.plugins", []);
  const [sel, setSel] = useState<string>("");
  const [output, setOutput] = useState<string[]>([]);
  const cur = plugins.find((p) => p.id === sel);
  const update = (patch: Partial<Plugin>) => setPlugins(plugins.map((p) => (p.id === sel ? { ...p, ...patch } : p)));
  const run = async () => {
    if (!cur) return;
    setOutput([]);
    try {
      await runPlugin(cur, (s) => setOutput((o) => [...o, s]));
      setOutput((o) => [...o, "✅ ทำงานเสร็จ"]);
    } catch (e) {
      setOutput((o) => [...o, `❌ ${(e as Error).message}`]);
    }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
      <Card title="ปลั๊กอิน">
        <button className="btn mb-2 w-full" onClick={() => { const p = { id: crypto.randomUUID(), name: `ปลั๊กอิน ${plugins.length + 1}`, enabled: false, code: SAMPLE_PLUGIN }; setPlugins([...plugins, p]); setSel(p.id); }}><Plus size={14} /> สร้างใหม่</button>
        {plugins.map((p) => (
          <button key={p.id} onClick={() => setSel(p.id)} className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${sel === p.id ? "bg-accent/25" : "hover:bg-fg/5"}`}>
            <span className={`h-2 w-2 rounded-full ${p.enabled ? "bg-lime-400" : "bg-fg/30"}`} /> {p.name}
          </button>
        ))}
      </Card>
      {cur ? (
        <Card>
          <div className="flex flex-wrap items-center gap-2">
            <input className="input flex-1" value={cur.name} onChange={(e) => update({ name: e.target.value })} />
            <Toggle label="รันตอนเปิดโปรแกรม" checked={cur.enabled} onChange={(v) => update({ enabled: v })} />
            <button className="btn-primary" onClick={run}><Play size={14} /> รัน</button>
            <button className="btn" onClick={() => downloadText(`${cur.name}.js`, cur.code, "text/javascript")}><Download size={14} /></button>
            <button className="btn text-red-300" onClick={() => { setPlugins(plugins.filter((p) => p.id !== sel)); setSel(""); }}><Trash2 size={14} /></button>
          </div>
          <textarea spellCheck={false} className="input mt-3 h-72 font-mono text-xs" value={cur.code} onChange={(e) => update({ code: e.target.value })} />
          <p className="mt-1 text-xs text-amber-300">⚠️ ปลั๊กอินมีสิทธิ์สั่งงานโปรแกรมได้เต็มที่ — อย่าวางโค้ดจากแหล่งที่ไม่ไว้ใจ</p>
          {output.length > 0 && <pre className="selectable mt-3 max-h-40 overflow-auto rounded-xl bg-black/30 p-3 text-xs">{output.join("\n")}</pre>}
        </Card>
      ) : (
        <Card><Empty icon={<Puzzle />} text="เลือกหรือสร้างปลั๊กอิน" /></Card>
      )}
    </div>
  );
}

export function Logs() {
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [level, setLevel] = useState("all");
  const [q, setQ] = useState("");
  const load = () => call<LogItem[]>("list_logs", { limit: 2000 }).then(setLogs).catch(() => {});
  useEffect(() => {
    load();
  }, []);
  const list = logs.filter((l) => (level === "all" || l.level === level) && (!q || `${l.source} ${l.message}`.toLowerCase().includes(q.toLowerCase())));
  const color: Record<string, string> = { error: "text-red-300", warn: "text-amber-300", info: "text-cyan-300", debug: "text-muted" };
  return (
    <Card>
      <div className="mb-3 flex flex-wrap gap-2">
        <input className="input flex-1" placeholder="ค้นหาใน log" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select value={level} onChange={setLevel} options={[{ value: "all", label: "ทุกระดับ" }, { value: "error", label: "ข้อผิดพลาด" }, { value: "warn", label: "คำเตือน" }, { value: "info", label: "ข้อมูล" }]} />
        <button className="btn" onClick={load}>รีเฟรช</button>
        <button className="btn" onClick={() => downloadText("logs.csv", toCSV(list as unknown as Record<string, unknown>[]), "text/csv")}>CSV</button>
        <button className="btn text-red-300" onClick={() => call("clear_logs").then(load)}>ล้าง</button>
      </div>
      <div className="max-h-[60vh] overflow-auto font-mono text-xs">
        {list.length === 0 && <Empty text="ไม่มี log" />}
        {list.map((l) => (
          <div key={l.id} className="selectable flex gap-2 border-b border-fg/5 py-1">
            <span className="shrink-0 text-muted">{formatDate(l.createdAt)}</span>
            <span className={`w-12 shrink-0 uppercase ${color[l.level] ?? ""}`}>{l.level}</span>
            <span className="w-24 shrink-0 truncate text-accent2">{l.source}</span>
            <span className="break-all">{l.message}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Cron() {
  const [schedules, setSchedules] = useKv<Schedule[]>(SCHEDULES_KEY, []);
  return (
    <Card title="งานตั้งเวลา (cron)">
      <p className="mb-3 text-sm text-muted">งานโหลดอัตโนมัติรายวัน สร้างได้ที่หน้า "อัตโนมัติ" → ตั้งเวลาโหลด · ที่นี่ใช้ดูภาพรวมและเปิด/ปิด</p>
      {schedules.length === 0 && <Empty icon={<Clock />} text="ยังไม่มีงานตั้งเวลา" />}
      <table className="w-full text-sm">
        {schedules.length > 0 && (
          <thead className="text-left text-xs text-muted"><tr><th className="py-1">ชื่อ</th><th>cron</th><th>ลิงก์</th><th>ทำล่าสุด</th><th>เปิด</th></tr></thead>
        )}
        <tbody>
          {schedules.map((s) => {
            const [hh, mm] = s.time.split(":").map(Number);
            return (
              <tr key={s.id} className="border-t border-fg/5">
                <td className="py-1.5">{s.name}</td>
                <td className="font-mono text-xs">{`${mm} ${hh} * * *`}</td>
                <td>{s.urls.length}</td>
                <td className="text-xs text-muted">{s.lastRun || "-"}</td>
                <td><Toggle label="" checked={s.enabled} onChange={(v) => setSchedules(schedules.map((x) => (x.id === s.id ? { ...x, enabled: v } : x)))} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
