// หน้า 9: วิเคราะห์ (สถิติ / heatmap / treemap / ไฟล์ซ้ำ / ไฟล์ใหญ่ / โฟลเดอร์ว่าง)
import { useMemo, useState } from "react";
import { BarChart3, FileJson, FileSpreadsheet, FolderOpen, Search, Trash2, HardDrive } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, Treemap, XAxis, YAxis } from "recharts";
import { Card, Empty, Field, PageHeader, Select, Stat, Tabs, Progress } from "@/components/ui";
import { call, confirmDialog, pickFolder, revealPath, type FileEntry } from "@/lib/api";
import { attempt, useApp } from "@/store/app";
import { useHistory, useSystemStats } from "@/hooks/useData";
import { basename, downloadText, formatBytes, formatDate, localDateKey, toCSV } from "@/lib/format";

type Tab = "stats" | "storage" | "dupes" | "large" | "empty";
const COLORS = ["#a855f7", "#22d3ee", "#ff2bd6", "#a3e635", "#fbbf24", "#f97316", "#3b82f6", "#ef4444"];
const KIND_LABEL: Record<string, string> = { download: "โหลด", convert: "แปลง", compress: "บีบอัด", record: "อัด" };
const tip = { contentStyle: { background: "rgba(15,15,30,.92)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 12 } };

export default function Analytics() {
  const [tab, setTab] = useState<Tab>("stats");
  return (
    <div>
      <PageHeader title="วิเคราะห์" subtitle="สถิติการใช้งาน พื้นที่จัดเก็บ และเครื่องมือเก็บกวาดไฟล์" icon={<BarChart3 />} />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "stats", label: "สถิติการใช้งาน" },
          { id: "storage", label: "พื้นที่จัดเก็บ" },
          { id: "dupes", label: "ไฟล์ซ้ำ" },
          { id: "large", label: "ไฟล์ใหญ่" },
          { id: "empty", label: "โฟลเดอร์ว่าง" },
        ]}
      />
      {tab === "stats" && <Stats />}
      {tab === "storage" && <Storage />}
      {tab === "dupes" && <Dupes />}
      {tab === "large" && <Large />}
      {tab === "empty" && <EmptyDirs />}
    </div>
  );
}

function Stats() {
  const { items } = useHistory();
  const [range, setRange] = useState("30");
  const [kind, setKind] = useState("all");
  const filtered = useMemo(() => {
    const since = range === "all" ? 0 : Date.now() - Number(range) * 86400000;
    return items.filter((i) => new Date(i.createdAt).getTime() >= since && (kind === "all" || i.kind === kind));
  }, [items, range, kind]);
  const ok = filtered.filter((i) => i.status === "done");
  const saved = ok.filter((i) => i.kind === "compress" && i.sizeAfter > 0).reduce((a, i) => a + Math.max(0, i.sizeBefore - i.sizeAfter), 0);

  // รายวัน (เส้น)
  const daily = useMemo(() => {
    const days = range === "all" ? 60 : Number(range);
    const map = new Map<string, Record<string, number>>();
    for (let d = days - 1; d >= 0; d--) {
      const k = localDateKey(Date.now() - d * 86400000);
      map.set(k, { download: 0, convert: 0, compress: 0 });
    }
    for (const i of ok) {
      const k = localDateKey(i.createdAt);
      const row = map.get(k);
      if (row) row[i.kind] = (row[i.kind] ?? 0) + 1;
    }
    return [...map.entries()].map(([day, v]) => ({ day: day.slice(5), ...v }));
  }, [ok, range]);

  // แผนที่ความร้อน 7 วัน × 24 ชั่วโมง
  const heat = useMemo(() => {
    const m = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
    for (const i of filtered) {
      const d = new Date(i.createdAt);
      m[d.getDay()][d.getHours()]++;
    }
    return m;
  }, [filtered]);
  const heatMax = Math.max(1, ...heat.flat());

  const byKind = Object.entries(filtered.reduce<Record<string, number>>((a, i) => ((a[i.kind] = (a[i.kind] ?? 0) + 1), a), {})).map(([k, v]) => ({ name: KIND_LABEL[k] ?? k, value: v }));
  const byStatus = [
    { name: "สำเร็จ", value: ok.length },
    { name: "ไม่สำเร็จ", value: filtered.filter((i) => i.status === "failed").length },
  ];

  const exportData = (fmt: "csv" | "json") => {
    const rows = filtered.map((i) => ({ วันที่: formatDate(i.createdAt), ประเภท: KIND_LABEL[i.kind] ?? i.kind, ชื่อ: i.title, สถานะ: i.status, ขนาดก่อน: i.sizeBefore, ขนาดหลัง: i.sizeAfter, ไฟล์: i.output }));
    if (fmt === "csv") downloadText("สถิติ-มีเดียทูลบ็อกซ์.csv", toCSV(rows), "text/csv");
    else downloadText("สถิติ-มีเดียทูลบ็อกซ์.json", JSON.stringify(rows, null, 2), "application/json");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="ช่วงเวลา">
          <Select value={range} onChange={setRange} options={[{ value: "7", label: "7 วัน" }, { value: "30", label: "30 วัน" }, { value: "90", label: "90 วัน" }, { value: "365", label: "1 ปี" }, { value: "all", label: "ทั้งหมด" }]} className="w-32" />
        </Field>
        <Field label="ชนิด">
          <Select value={kind} onChange={setKind} options={[{ value: "all", label: "ทั้งหมด" }, { value: "download", label: "โหลด" }, { value: "convert", label: "แปลง" }, { value: "compress", label: "บีบอัด" }]} className="w-32" />
        </Field>
        <div className="flex-1" />
        <button className="btn" onClick={() => exportData("csv")}><FileSpreadsheet size={14} /> CSV</button>
        <button className="btn" onClick={() => exportData("json")}><FileJson size={14} /> JSON</button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="ไฟล์ที่โหลด" value={ok.filter((i) => i.kind === "download").length} icon="📥" />
        <Stat label="ไฟล์ที่แปลง" value={ok.filter((i) => i.kind === "convert").length} icon="🔄" color="from-cyan-500 to-blue-500" />
        <Stat label="ไฟล์ที่บีบอัด" value={ok.filter((i) => i.kind === "compress").length} icon="🗜️" color="from-lime-500 to-emerald-500" />
        <Stat label="ประหยัดพื้นที่" value={formatBytes(saved)} icon="💾" color="from-amber-500 to-orange-500" />
      </div>
      <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <Card title="งานสำเร็จรายวัน">
          <div className="h-64">
            <ResponsiveContainer>
              <AreaChart data={daily}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,.15)" />
                <XAxis dataKey="day" fontSize={11} stroke="currentColor" opacity={0.5} />
                <YAxis allowDecimals={false} fontSize={11} stroke="currentColor" opacity={0.5} />
                <Tooltip {...tip} />
                <Area dataKey="download" name="โหลด" stackId="1" stroke={COLORS[0]} fill={COLORS[0]} fillOpacity={0.4} />
                <Area dataKey="convert" name="แปลง" stackId="1" stroke={COLORS[1]} fill={COLORS[1]} fillOpacity={0.4} />
                <Area dataKey="compress" name="บีบอัด" stackId="1" stroke={COLORS[3]} fill={COLORS[3]} fillOpacity={0.4} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="สัดส่วน">
          <div className="grid h-64 grid-cols-2">
            {[byKind, byStatus].map((d, k) => (
              <ResponsiveContainer key={k}>
                <PieChart>
                  <Pie data={d} dataKey="value" nameKey="name" innerRadius={35} outerRadius={60} paddingAngle={2} label={({ name }) => name} fontSize={11}>
                    {d.map((_, i) => <Cell key={i} fill={k === 1 ? (i ? "#ef4444" : "#a3e635") : COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip {...tip} />
                </PieChart>
              </ResponsiveContainer>
            ))}
          </div>
        </Card>
      </div>
      <Card title="แผนที่ความร้อนการใช้งาน (วัน × ชั่วโมง)">
        <div className="overflow-x-auto">
          <table className="border-separate border-spacing-0.5 text-[10px]">
            <thead>
              <tr>
                <th />
                {Array.from({ length: 24 }, (_, h) => <th key={h} className="w-6 font-normal text-muted">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"].map((d, i) => (
                <tr key={d}>
                  <td className="pr-2 text-muted">{d}</td>
                  {heat[i].map((v, h) => (
                    <td key={h} title={`${d} ${h}:00 — ${v} งาน`} className="h-6 w-6 rounded" style={{ background: v ? `rgb(var(--accent) / ${0.15 + (v / heatMax) * 0.85})` : "rgba(128,128,128,.08)" }} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ---------- พื้นที่จัดเก็บ ----------
interface SizeItem {
  name: string;
  path: string;
  size: number;
  files: number;
}

function Storage() {
  const settings = useApp((s) => s.settings);
  const { stats } = useSystemStats(5000, 2);
  const [dir, setDir] = useState(settings?.downloadDir ?? "");
  const [items, setItems] = useState<SizeItem[]>([]);
  const [loading, setLoading] = useState(false);
  const scan = async (d = dir) => {
    setLoading(true);
    const r = await attempt(() => call<SizeItem[]>("folder_sizes", { dir: d }));
    setLoading(false);
    if (r) setItems(r.filter((x) => x.size > 0).sort((a, b) => b.size - a.size));
  };
  const total = items.reduce((a, i) => a + i.size, 0);
  const TreeCell = (props: any) => {
    const { x, y, width, height, index, name, size } = props;
    if (width < 4 || height < 4 || name === undefined) return null;
    return (
      <g onClick={() => { const it = items[index]; if (it && it.path !== dir) { setDir(it.path); scan(it.path); } }} style={{ cursor: "pointer" }}>
        <rect x={x} y={y} width={width} height={height} fill={COLORS[index % COLORS.length]} fillOpacity={0.7} stroke="rgba(0,0,0,.4)" rx={6} />
        {width > 70 && height > 30 && (
          <>
            <text x={x + 8} y={y + 18} fill="#fff" fontSize={12}>{String(name).slice(0, Math.floor(width / 8))}</text>
            <text x={x + 8} y={y + 34} fill="#fff" fontSize={10} opacity={0.8}>{formatBytes(size)}</text>
          </>
        )}
      </g>
    );
  };
  return (
    <div className="space-y-4">
      <Card title="ดิสก์ในเครื่อง">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {stats?.disks.map((d) => (
            <div key={d.mount} className="rounded-xl bg-fg/[.04] p-3">
              <div className="flex items-center gap-2 text-sm"><HardDrive size={14} /> {d.mount} <span className="text-muted">{d.name}</span></div>
              <div className="my-2"><Progress value={((d.total - d.available) / d.total) * 100} /></div>
              <div className="text-xs text-muted">ว่าง {formatBytes(d.available)} จาก {formatBytes(d.total)}</div>
            </div>
          ))}
        </div>
      </Card>
      <Card title="วิเคราะห์โฟลเดอร์ (คลิกกล่องเพื่อเจาะลึก)">
        <div className="mb-3 flex gap-2">
          <FolderPick value={dir} onChange={setDir} />
          <button className="btn-primary" disabled={!dir || loading} onClick={() => scan()}><Search size={14} /> {loading ? "กำลังสแกน…" : "สแกน"}</button>
        </div>
        {items.length > 0 ? (
          <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
            <div className="h-96">
              <ResponsiveContainer>
                <Treemap data={items.map((i) => ({ name: i.name, size: i.size }))} dataKey="size" isAnimationActive={false} content={<TreeCell />} />
              </ResponsiveContainer>
            </div>
            <div>
              <div className="mb-2 text-sm">รวม {formatBytes(total)} · โฟลเดอร์ใหญ่สุด</div>
              <div className="h-80">
                <ResponsiveContainer>
                  <BarChart data={items.slice(0, 10)} layout="vertical" margin={{ left: 10 }}>
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="name" width={110} fontSize={11} stroke="currentColor" opacity={0.6} />
                    <Tooltip {...tip} formatter={(v: number) => formatBytes(v)} />
                    <Bar dataKey="size" name="ขนาด" radius={[0, 6, 6, 0]}>
                      {items.slice(0, 10).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        ) : (
          <Empty text="เลือกโฟลเดอร์แล้วกดสแกน" />
        )}
      </Card>
    </div>
  );
}

function FolderPick({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-1 gap-1">
      <input className="input" value={value} onChange={(e) => onChange(e.target.value)} />
      <button className="btn" onClick={async () => { const d = await pickFolder(); if (d) onChange(d); }}><FolderOpen size={14} /></button>
    </div>
  );
}

function FileTable({ files, selected, onToggle }: { files: FileEntry[]; selected: Set<string>; onToggle: (p: string) => void }) {
  return (
    <table className="w-full text-sm">
      <tbody>
        {files.map((f) => (
          <tr key={f.path} className="border-b border-fg/5 hover:bg-fg/5">
            <td className="w-8"><input type="checkbox" checked={selected.has(f.path)} onChange={() => onToggle(f.path)} /></td>
            <td className="max-w-md truncate py-1" title={f.path}>{f.name}<div className="truncate text-[11px] text-muted">{f.path}</div></td>
            <td className="whitespace-nowrap font-mono text-xs">{formatBytes(f.size)}</td>
            <td className="whitespace-nowrap text-xs text-muted">{formatDate(f.modified, false)}</td>
            <td><button className="btn btn-sm" onClick={() => revealPath(f.path)}><FolderOpen size={12} /></button></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function useSelection() {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const toggle = (p: string) => setSel((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  return { sel, setSel, toggle };
}

async function trashSelected(paths: string[], after: () => void) {
  if (!paths.length) return;
  if (!(await confirmDialog(`ย้าย ${paths.length} ไฟล์ไปถังขยะ?`))) return;
  const n = await attempt(() => call<number>("delete_files", { paths, permanent: false }));
  if (n !== undefined) {
    useApp.getState().toast(`ย้ายไปถังขยะแล้ว ${n} ไฟล์ (กู้คืนได้)`, "success");
    after();
  }
}

function Dupes() {
  const settings = useApp((s) => s.settings);
  const [dir, setDir] = useState(settings?.downloadDir ?? "");
  const [minMB, setMinMB] = useState(1);
  const [groups, setGroups] = useState<FileEntry[][] | null>(null);
  const [loading, setLoading] = useState(false);
  const { sel, setSel, toggle } = useSelection();
  const scan = async () => {
    setLoading(true);
    const g = await attempt(() => call<FileEntry[][]>("find_duplicates", { dir, minSize: minMB * 1048576 }));
    setLoading(false);
    if (g) {
      setGroups(g);
      // เลือกให้อัตโนมัติ: เก็บไฟล์แรก (เก่าสุด) ไว้
      setSel(new Set(g.flatMap((x) => [...x].sort((a, b) => a.modified - b.modified).slice(1).map((f) => f.path))));
    }
  };
  const waste = groups?.reduce((a, g) => a + g[0].size * (g.length - 1), 0) ?? 0;
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <FolderPick value={dir} onChange={setDir} />
        <Field label="ขนาดขั้นต่ำ (MB)"><input type="number" className="input w-24" value={minMB} onChange={(e) => setMinMB(Number(e.target.value))} /></Field>
        <button className="btn-primary" disabled={!dir || loading} onClick={scan}><Search size={14} /> {loading ? "กำลังเทียบ hash…" : "หาไฟล์ซ้ำ"}</button>
        <button className="btn-danger" disabled={!sel.size} onClick={() => trashSelected([...sel], scan)}><Trash2 size={14} /> ลบที่เลือก ({sel.size})</button>
      </div>
      {groups === null ? <Empty text="เทียบไฟล์ด้วยขนาด + SHA-256 จึงแม่นยำ 100%" /> : groups.length === 0 ? <Empty text="ไม่พบไฟล์ซ้ำ 🎉" /> : (
        <>
          <p className="mb-2 text-sm">พบ {groups.length} กลุ่ม · เปลืองพื้นที่ {formatBytes(waste)}</p>
          <div className="max-h-[60vh] space-y-3 overflow-auto">
            {groups.map((g, i) => (
              <div key={i} className="rounded-xl bg-fg/[.03] p-2">
                <div className="mb-1 text-xs text-muted">กลุ่มที่ {i + 1} · {basename(g[0].path)}</div>
                <FileTable files={g} selected={sel} onToggle={toggle} />
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

function Large() {
  const settings = useApp((s) => s.settings);
  const [dir, setDir] = useState(settings?.downloadDir ?? "");
  const [minMB, setMinMB] = useState(500);
  const [files, setFiles] = useState<FileEntry[] | null>(null);
  const { sel, toggle } = useSelection();
  const scan = async () => {
    const f = await attempt(() => call<FileEntry[]>("find_large", { dir, minSize: minMB * 1048576 }));
    if (f) setFiles(f);
  };
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <FolderPick value={dir} onChange={setDir} />
        <Field label="ใหญ่กว่า (MB)"><input type="number" className="input w-24" value={minMB} onChange={(e) => setMinMB(Number(e.target.value))} /></Field>
        <button className="btn-primary" disabled={!dir} onClick={scan}><Search size={14} /> ค้นหา</button>
        <button className="btn-danger" disabled={!sel.size} onClick={() => trashSelected([...sel], scan)}><Trash2 size={14} /> ลบที่เลือก ({sel.size})</button>
      </div>
      {files === null ? <Empty text="ค้นหาไฟล์ขนาดใหญ่เพื่อเคลียร์พื้นที่" /> : files.length === 0 ? <Empty text="ไม่พบไฟล์ใหญ่" /> : (
        <div className="max-h-[60vh] overflow-auto">
          <p className="mb-2 text-sm">{files.length} ไฟล์ · รวม {formatBytes(files.reduce((a, f) => a + f.size, 0))}</p>
          <FileTable files={files} selected={sel} onToggle={toggle} />
        </div>
      )}
    </Card>
  );
}

function EmptyDirs() {
  const settings = useApp((s) => s.settings);
  const [dir, setDir] = useState(settings?.downloadDir ?? "");
  const [list, setList] = useState<string[] | null>(null);
  const scan = async () => {
    const l = await attempt(() => call<string[]>("find_empty_dirs", { dir }));
    if (l) setList(l);
  };
  const remove = async () => {
    if (!list?.length || !(await confirmDialog(`ลบ ${list.length} โฟลเดอร์ว่าง?`))) return;
    const n = await attempt(() => call<number>("remove_empty_dirs", { paths: list }));
    if (n !== undefined) {
      useApp.getState().toast(`ลบแล้ว ${n} โฟลเดอร์`, "success");
      scan();
    }
  };
  return (
    <Card>
      <div className="mb-3 flex gap-2">
        <FolderPick value={dir} onChange={setDir} />
        <button className="btn-primary" disabled={!dir} onClick={scan}><Search size={14} /> ค้นหา</button>
        <button className="btn-danger" disabled={!list?.length} onClick={remove}><Trash2 size={14} /> ลบทั้งหมด</button>
      </div>
      {list === null ? <Empty text="ค้นหาโฟลเดอร์ที่ไม่มีไฟล์อยู่ข้างใน" /> : list.length === 0 ? <Empty text="ไม่พบโฟลเดอร์ว่าง 🎉" /> : (
        <div className="max-h-[60vh] overflow-auto font-mono text-xs">
          {list.map((d) => <div key={d} className="border-b border-fg/5 py-1">{d}</div>)}
        </div>
      )}
    </Card>
  );
}
