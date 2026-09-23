// หน้า 1: แดชบอร์ด
import { useMemo, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Download, Repeat, Minimize2, Scissors, PlayCircle, FileVideo, HardDrive, Clock, CheckCircle2, Cpu, MemoryStick, Network, Music, Image as ImageIcon, FileText } from "lucide-react";
import { AreaChart, Area, ResponsiveContainer, Tooltip, YAxis, PieChart, Pie, Cell } from "recharts";
import { Particles } from "@/components/Particles";
import { Card, Empty, Stat } from "@/components/ui";
import { JobRow, useJobs } from "@/components/JobList";
import { useApp } from "@/store/app";
import { useFolderFiles, useHistory, useSystemStats } from "@/hooks/useData";
import { fileUrl, openPath, api } from "@/lib/api";
import { formatBytes, isToday, timeAgo } from "@/lib/format";

const QUICK = [
  { to: "/download", label: "โหลดคลิป", icon: Download, color: "from-fuchsia-500 to-purple-600" },
  { to: "/convert", label: "แปลงไฟล์", icon: Repeat, color: "from-cyan-400 to-blue-600" },
  { to: "/compress", label: "บีบอัด", icon: Minimize2, color: "from-lime-400 to-emerald-600" },
  { to: "/editor", label: "ตัดต่อ", icon: Scissors, color: "from-amber-400 to-orange-600" },
  { to: "/player", label: "ดูคลิป", icon: PlayCircle, color: "from-pink-500 to-rose-600" },
];

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "ดึกแล้วนะ";
  if (h < 12) return "อรุณสวัสดิ์";
  if (h < 17) return "สวัสดีตอนบ่าย";
  return "สวัสดีตอนเย็น";
}

export default function Dashboard() {
  const settings = useApp((s) => s.settings)!;
  const activity = useApp((s) => s.activity);
  const nav = useNavigate();
  const { items } = useHistory();
  const { stats, series } = useSystemStats();
  const { files } = useFolderFiles(settings.downloadDir);
  const jobs = useJobs();
  const active = jobs.filter((j) => ["running", "queued", "paused"].includes(j.status));

  const s = useMemo(() => {
    const today = items.filter((h) => isToday(h.createdAt) && h.status === "done").length;
    const saved = items.filter((h) => h.status === "done" && h.sizeBefore > h.sizeAfter && h.sizeAfter > 0).reduce((a, h) => a + (h.sizeBefore - h.sizeAfter), 0);
    const done = items.filter((h) => h.status === "done").length;
    return { today, saved, done };
  }, [items]);

  const storage = useMemo(() => {
    const by: Record<string, number> = { video: 0, audio: 0, image: 0, other: 0 };
    for (const f of files) by[f.kind in by ? f.kind : "other"] += f.size;
    return [
      { name: "วิดีโอ", value: by.video, color: "#a855f7" },
      { name: "เสียง", value: by.audio, color: "#22d3ee" },
      { name: "รูปภาพ", value: by.image, color: "#ff2bd6" },
      { name: "อื่น ๆ", value: by.other, color: "#fbbf24" },
    ].filter((x) => x.value > 0);
  }, [files]);

  const widgets = settings.widgets.length ? settings.widgets : ["stats", "quick", "activity", "system", "recent", "storage"];
  const sysDisk = stats?.disks.find((d) => settings.downloadDir.toUpperCase().startsWith(d.mount.toUpperCase())) ?? stats?.disks[0];

  const blocks: Record<string, JSX.Element> = {
    stats: (
      <div key="stats" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="ไฟล์วันนี้" value={s.today} icon={<FileVideo size={18} />} color="from-fuchsia-500 to-purple-600" />
        <Stat label="ขนาดที่ประหยัดได้" value={formatBytes(s.saved)} icon={<HardDrive size={18} />} color="from-lime-400 to-emerald-600" />
        <Stat label="งานที่รอ" value={jobs.filter((j) => ["queued", "running", "paused"].includes(j.status)).length} icon={<Clock size={18} />} color="from-amber-400 to-orange-600" />
        <Stat label="งานสำเร็จทั้งหมด" value={s.done} icon={<CheckCircle2 size={18} />} color="from-cyan-400 to-blue-600" />
      </div>
    ),
    quick: (
      <Card key="quick" title="ทางลัด">
        <div className="grid grid-cols-5 gap-3">
          {QUICK.map((q) => (
            <button key={q.to} onClick={() => nav(q.to)} className="group flex flex-col items-center gap-2 rounded-2xl p-3 transition hover:bg-fg/5">
              <div className={`grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br ${q.color} text-white shadow-lg transition group-hover:scale-110 group-hover:shadow-glow`}>
                <q.icon size={24} />
              </div>
              <span className="text-sm">{q.label}</span>
            </button>
          ))}
        </div>
      </Card>
    ),
    activity: (
      <div key="activity" className="grid gap-4 lg:grid-cols-2">
        <Card title="งานที่กำลังทำ">
          {active.length ? <div className="max-h-72 space-y-2 overflow-auto">{active.slice(0, 6).map((j) => <JobRow key={j.id} job={j} />)}</div> : <Empty icon="😴" text="ไม่มีงานที่กำลังทำ" />}
        </Card>
        <Card title="กิจกรรมล่าสุด">
          {activity.length || items.length ? (
            <ul className="max-h-72 space-y-1.5 overflow-auto text-sm">
              {activity.slice(0, 10).map((a) => (
                <li key={a.id} className="flex justify-between gap-2 rounded-lg px-2 py-1 hover:bg-fg/5">
                  <span className="truncate">{a.text}</span>
                  <span className="shrink-0 text-xs text-muted">{timeAgo(a.at)}</span>
                </li>
              ))}
              {items.slice(0, 10 - Math.min(10, activity.length)).map((h) => (
                <li key={h.id} className="flex justify-between gap-2 rounded-lg px-2 py-1 hover:bg-fg/5">
                  <span className="truncate">
                    {h.status === "done" ? "✅" : h.status === "failed" ? "⚠️" : "⏹️"} {h.title}
                  </span>
                  <span className="shrink-0 text-xs text-muted">{timeAgo(h.createdAt)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty text="ยังไม่มีกิจกรรม เริ่มจากโหลดคลิปแรกกันเลย!" />
          )}
        </Card>
      </div>
    ),
    system: (
      <Card key="system" title="ระบบ (real-time)">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <MiniChart label="CPU" icon={<Cpu size={14} />} value={`${stats?.cpu.toFixed(0) ?? 0}%`} data={series} k="cpu" color="#a855f7" />
          <MiniChart label="RAM" icon={<MemoryStick size={14} />} value={stats ? `${formatBytes(stats.memUsed)} / ${formatBytes(stats.memTotal)}` : "-"} data={series} k="mem" color="#22d3ee" />
          <div>
            <div className="mb-1 flex items-center gap-1 text-xs text-muted">
              <HardDrive size={14} /> ดิสก์ {sysDisk?.mount}
            </div>
            {sysDisk && (
              <>
                <div className="font-mono text-sm">เหลือ {formatBytes(sysDisk.available)}</div>
                <div className="progress mt-2">
                  <div style={{ width: `${(1 - sysDisk.available / sysDisk.total) * 100}%` }} />
                </div>
                <div className="mt-1 text-[11px] text-muted">จาก {formatBytes(sysDisk.total)}</div>
              </>
            )}
          </div>
          <MiniChart label="เครือข่าย ↓" icon={<Network size={14} />} value={`${formatBytes(stats?.netRx ?? 0)}/s`} data={series} k="rx" color="#a3e635" />
        </div>
      </Card>
    ),
    recent: (
      <Card key="recent" title="ไฟล์ล่าสุด" actions={<button className="btn btn-sm" onClick={() => nav("/library")}>ดูทั้งหมด</button>}>
        {files.length ? (
          <div className="grid grid-cols-3 gap-3 md:grid-cols-4 xl:grid-cols-6">
            {files.slice(0, 12).map((f) => (
              <RecentTile key={f.path} path={f.path} name={f.name} kind={f.kind} onOpen={() => (f.kind === "video" || f.kind === "audio" ? nav(`/player?file=${encodeURIComponent(f.path)}`) : openPath(f.path))} />
            ))}
          </div>
        ) : (
          <Empty text={`ยังไม่มีไฟล์ใน ${settings.downloadDir}`} />
        )}
      </Card>
    ),
    storage: (
      <Card key="storage" title="พื้นที่จัดเก็บ (โฟลเดอร์ดาวน์โหลด)">
        {storage.length ? (
          <div className="flex items-center gap-6">
            <div className="h-40 w-40">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={storage} dataKey="value" innerRadius={42} outerRadius={70} paddingAngle={3} stroke="none">
                    {storage.map((e) => (
                      <Cell key={e.name} fill={e.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => formatBytes(v)} contentStyle={{ background: "rgb(var(--bg))", border: "none", borderRadius: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="space-y-2 text-sm">
              {storage.map((e) => (
                <li key={e.name} className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded" style={{ background: e.color }} />
                  <span className="w-16">{e.name}</span>
                  <span className="font-mono">{formatBytes(e.value)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <Empty text="ยังไม่มีข้อมูล" />
        )}
      </Card>
    ),
  };

  return (
    <div className="space-y-4">
      <div className="glass relative overflow-hidden p-6">
        {settings.fullEffects && <Particles />}
        <div className="relative">
          <p className="text-sm text-muted">{greeting()},</p>
          <h1 className="font-display text-3xl font-semibold">
            <span className="gradient-text">{settings.displayName}</span> 👋
          </h1>
          <p className="mt-1 text-muted">โปรแกรมเดียวจบ ครบทุกงานมีเดีย — วันนี้อยากทำอะไรดี?</p>
        </div>
      </div>
      {widgets.filter((w) => blocks[w]).map((w) => blocks[w])}
    </div>
  );
}

function MiniChart({ label, icon, value, data, k, color }: { label: string; icon: JSX.Element; value: string; data: any[]; k: string; color: string }) {
  return (
    <div>
      <div className="flex items-center gap-1 text-xs text-muted">
        {icon} {label}
      </div>
      <div className="font-mono text-sm">{value}</div>
      <div className="h-14">
        <ResponsiveContainer>
          <AreaChart data={data}>
            <defs>
              <linearGradient id={`g-${k}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.6} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <YAxis hide domain={k === "cpu" || k === "mem" ? [0, 100] : [0, "auto"]} />
            <Area type="monotone" dataKey={k} stroke={color} fill={`url(#g-${k})`} strokeWidth={2} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function RecentTile({ path, name, kind, onOpen }: { path: string; name: string; kind: string; onOpen: () => void }) {
  const [thumb, setThumb] = useState("");
  useEffect(() => {
    if (kind === "image") setThumb(fileUrl(path));
    else if (kind === "video") api.thumbnail(path).then((t) => setThumb(fileUrl(t))).catch(() => {});
  }, [path, kind]);
  const Icon = kind === "audio" ? Music : kind === "image" ? ImageIcon : kind === "video" ? FileVideo : FileText;
  return (
    <button onClick={onOpen} className="group overflow-hidden rounded-xl border border-fg/10 text-left transition hover:border-accent" title={name}>
      <div className="grid aspect-video place-items-center bg-fg/5">
        {thumb ? <img src={thumb} className="h-full w-full object-cover transition group-hover:scale-105" alt="" loading="lazy" /> : <Icon className="text-muted" />}
      </div>
      <div className="truncate px-2 py-1 text-xs">{name}</div>
    </button>
  );
}
