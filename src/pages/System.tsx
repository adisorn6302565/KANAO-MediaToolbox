// หน้า 18: ระบบ
import { useEffect, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Cpu, MemoryStick, HardDrive, Network, RefreshCw, Save, Upload, FolderOpen, Trash2 } from "lucide-react";
import { Card, PageHeader, Progress, Stat, Tabs } from "@/components/ui";
import { JobList, useJobs } from "@/components/JobList";
import { api, call, openPath, pickFiles, pickSave } from "@/lib/api";
import { attempt, useApp } from "@/store/app";
import { useSystemStats } from "@/hooks/useData";
import { formatBytes, formatDuration, localDateKey } from "@/lib/format";
import { Logs } from "./Developer";

type Tab = "monitor" | "queue" | "logs" | "maintenance";

export default function SystemPage() {
  const [tab, setTab] = useState<Tab>("monitor");
  return (
    <div>
      <PageHeader title="ระบบ" subtitle="ทรัพยากรเครื่อง · คิวงาน · log · สำรองข้อมูล · อัปเดต" icon={<Cpu />} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "monitor", label: "📈 ทรัพยากร" }, { id: "queue", label: "📋 คิวงาน" }, { id: "logs", label: "📜 Log" }, { id: "maintenance", label: "🛠️ สำรอง & อัปเดต" }]} />
      {tab === "monitor" && <Monitor />}
      {tab === "queue" && <Queue />}
      {tab === "logs" && <Logs />}
      {tab === "maintenance" && <Maintenance />}
    </div>
  );
}

function Monitor() {
  const { stats, series } = useSystemStats(1500, 60);
  const [gpu, setGpu] = useState<string[] | null>(null);
  useEffect(() => {
    call<string[]>("gpu_info").then(setGpu).catch(() => setGpu([]));
  }, []);
  if (!stats) return <Card><p className="text-muted">กำลังอ่านข้อมูลระบบ…</p></Card>;
  const memPct = (stats.memUsed / stats.memTotal) * 100;
  const data = series.map((s) => ({ ...s, rxK: s.rx / 1024, txK: s.tx / 1024 }));
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="CPU" value={`${stats.cpu.toFixed(0)}%`} icon={<Cpu />} sub={stats.cpuName} />
        <Stat label="RAM" value={`${memPct.toFixed(0)}%`} icon={<MemoryStick />} color="from-pink-500 to-rose-500" sub={`${formatBytes(stats.memUsed)} / ${formatBytes(stats.memTotal)} · โปรแกรมนี้ ${formatBytes(stats.appMem)}`} />
        <Stat label="เครือข่าย" value={`↓ ${formatBytes(stats.netRx)}/s`} icon={<Network />} color="from-lime-500 to-emerald-500" sub={`↑ ${formatBytes(stats.netTx)}/s`} />
        <Stat label="เปิดเครื่องมา" value={formatDuration(stats.uptime)} icon={<HardDrive />} color="from-amber-500 to-orange-500" sub={`${stats.os} · ${stats.host}`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="CPU / RAM (%)">
          <div className="h-48">
            <ResponsiveContainer>
              <AreaChart data={data}>
                <XAxis dataKey="t" hide />
                <YAxis domain={[0, 100]} width={30} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} labelFormatter={() => ""} contentStyle={{ background: "rgb(var(--bg))", border: "none", borderRadius: 8 }} />
                <Area type="monotone" dataKey="cpu" name="CPU" stroke="#a855f7" fill="#a855f7" fillOpacity={0.25} isAnimationActive={false} />
                <Area type="monotone" dataKey="mem" name="RAM" stroke="#ec4899" fill="#ec4899" fillOpacity={0.15} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="เครือข่าย (KB/s)">
          <div className="h-48">
            <ResponsiveContainer>
              <AreaChart data={data}>
                <XAxis dataKey="t" hide />
                <YAxis width={40} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: number) => `${v.toFixed(0)} KB/s`} labelFormatter={() => ""} contentStyle={{ background: "rgb(var(--bg))", border: "none", borderRadius: 8 }} />
                <Area type="monotone" dataKey="rxK" name="รับ" stroke="#22d3ee" fill="#22d3ee" fillOpacity={0.25} isAnimationActive={false} />
                <Area type="monotone" dataKey="txK" name="ส่ง" stroke="#a3e635" fill="#a3e635" fillOpacity={0.15} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title={`แกน CPU (${stats.cores.length})`}>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
            {stats.cores.map((c, i) => (
              <div key={i} className="text-center">
                <div className="relative mx-auto h-16 w-4 overflow-hidden rounded bg-fg/10"><div className="absolute bottom-0 w-full bg-gradient-to-t from-accent to-accent2" style={{ height: `${c}%` }} /></div>
                <div className="mt-1 font-mono text-[10px] text-muted">{c.toFixed(0)}</div>
              </div>
            ))}
          </div>
        </Card>
        <Card title="ดิสก์ & การ์ดจอ">
          <div className="space-y-3">
            {stats.disks.map((d) => {
              const used = d.total - d.available;
              return (
                <div key={d.mount}>
                  <div className="flex justify-between text-sm"><span>{d.mount} {d.name}</span><span className="text-muted">ว่าง {formatBytes(d.available)} / {formatBytes(d.total)}</span></div>
                  <Progress value={(used / d.total) * 100} />
                </div>
              );
            })}
            <div className="pt-2 text-sm">
              <div className="label">การ์ดจอ</div>
              {gpu === null ? <span className="text-muted">กำลังตรวจสอบ…</span> : gpu.length ? gpu.map((g) => <div key={g}>🎮 {g}</div>) : <span className="text-muted">ไม่พบข้อมูล</span>}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Queue() {
  const jobs = useJobs();
  const count = (s: string[]) => jobs.filter((j) => s.includes(j.status)).length;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="รอคิว" value={count(["queued", "paused"])} icon={<span>⏳</span>} />
        <Stat label="กำลังทำ" value={count(["running"])} icon={<span>⚙️</span>} color="from-cyan-500 to-blue-500" />
        <Stat label="เสร็จ" value={count(["done"])} icon={<span>✅</span>} color="from-lime-500 to-emerald-500" />
        <Stat label="พลาด/ยกเลิก" value={count(["failed", "cancelled"])} icon={<span>⚠️</span>} color="from-red-500 to-rose-500" />
      </div>
      <Card
        title="งานทั้งหมด"
        actions={
          <div className="flex gap-2">
            <button className="btn btn-sm" onClick={() => jobs.filter((j) => j.status === "failed").forEach((j) => api.jobAction(j.id, "retry"))}><RefreshCw size={12} /> ลองใหม่ทั้งหมดที่พลาด</button>
            <button className="btn btn-sm" onClick={() => api.jobAction("", "clear").then(() => useApp.getState().refreshJobs())}><Trash2 size={12} /> ล้างที่จบแล้ว</button>
          </div>
        }
      >
        <JobList />
      </Card>
    </div>
  );
}

interface ToolInfo {
  name: string;
  version?: string;
  path?: string;
}

function Maintenance() {
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [info, setInfo] = useState<{ version: string; dataDir: string; downloadDir: string } | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateLog, setUpdateLog] = useState("");
  const load = () => {
    call<ToolInfo[]>("tool_status").then(setTools).catch(() => {});
    call<{ version: string; dataDir: string; downloadDir: string }>("app_info").then(setInfo).catch(() => {});
  };
  useEffect(load, []);
  const backup = async () => {
    const out = await pickSave(`MediaToolbox-สำรอง-${localDateKey()}.json`, [{ name: "JSON", extensions: ["json"] }]);
    if (out) await attempt(() => call("backup_settings", { path: out }), "สำรองการตั้งค่าแล้ว");
  };
  const restore = async () => {
    const [f] = await pickFiles({ multiple: false, filters: [{ name: "JSON", extensions: ["json"] }] });
    if (!f) return;
    const s = await attempt(() => call<any>("restore_settings", { path: f }), "กู้คืนแล้ว — ค่าบางอย่างจะมีผลเมื่อเปิดโปรแกรมใหม่");
    if (s) useApp.setState({ settings: s });
  };
  const updateYtdlp = async () => {
    setUpdating(true);
    setUpdateLog(await call<string>("update_ytdlp").catch((e) => String(e)));
    setUpdating(false);
    load();
  };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="ตรวจสอบอัปเดต">
        <div className="space-y-2">
          <div className="flex justify-between text-sm"><span>มีเดียทูลบ็อกซ์</span><span className="font-mono">v{info?.version ?? "-"}</span></div>
          {tools.map((t) => (
            <div key={t.name} className="flex items-center justify-between gap-2 text-sm">
              <span>{t.name}</span>
              <span className={`truncate font-mono text-xs ${t.version ? "" : "text-red-300"}`} title={t.path}>{t.version ?? "ไม่พบ"}</span>
            </div>
          ))}
        </div>
        <button className="btn-primary mt-3" disabled={updating} onClick={updateYtdlp}><RefreshCw size={14} className={updating ? "animate-spin" : ""} /> {updating ? "กำลังอัปเดต…" : "อัปเดต yt-dlp (ต้องต่อเน็ต)"}</button>
        {updateLog && <pre className="selectable mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 p-2 text-xs">{updateLog}</pre>}
        <p className="mt-2 text-xs text-muted">yt-dlp ควรอัปเดตสม่ำเสมอ เพราะเว็บวิดีโอเปลี่ยนระบบบ่อย</p>
      </Card>
      <Card title="สำรอง & กู้คืน">
        <p className="text-sm text-muted">สำรองการตั้งค่า เพลย์ลิสต์ แท็ก กฎอัตโนมัติ และข้อมูลอื่น ๆ เป็นไฟล์ .json</p>
        <div className="mt-3 flex gap-2">
          <button className="btn-primary" onClick={backup}><Save size={14} /> สำรอง</button>
          <button className="btn" onClick={restore}><Upload size={14} /> กู้คืน</button>
        </div>
        {info && (
          <div className="mt-4 space-y-1 text-sm">
            <button className="flex items-center gap-2 hover:text-accent2" onClick={() => openPath(info.dataDir)}><FolderOpen size={14} /> โฟลเดอร์ข้อมูลโปรแกรม</button>
            <div className="selectable truncate font-mono text-xs text-muted">{info.dataDir}</div>
            <button className="flex items-center gap-2 hover:text-accent2" onClick={() => openPath(info.downloadDir)}><FolderOpen size={14} /> โฟลเดอร์ปลายทาง</button>
            <div className="selectable truncate font-mono text-xs text-muted">{info.downloadDir}</div>
          </div>
        )}
      </Card>
    </div>
  );
}
