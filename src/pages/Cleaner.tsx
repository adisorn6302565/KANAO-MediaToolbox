// หน้า: ล้างเครื่อง (ไฟล์ขยะ / แคช / ถังขยะ) + โปรแกรมเปิดพร้อม Windows
import { useEffect, useMemo, useState } from "react";
import { Sparkles, Trash2, RefreshCw, ShieldAlert, Rocket, HardDrive } from "lucide-react";
import { Card, Empty, PageHeader, Stat, Tabs } from "@/components/ui";
import { call, confirmDialog } from "@/lib/api";
import { attempt, useApp } from "@/store/app";
import { formatBytes } from "@/lib/format";
import { playSound } from "@/lib/sound";

type Category = { id: string; group: string; label: string; desc: string; size: number; count: number; recommended: boolean; needsAdmin: boolean };
type CleanResult = { freed: number; deleted: number; skipped: number };
type StartupItem = { name: string; command: string; location: string; enabled: boolean; editable: boolean };

export default function Cleaner() {
  const [tab, setTab] = useState<"junk" | "startup">("junk");
  return (
    <div>
      <PageHeader title="ล้างเครื่อง" subtitle="ลบไฟล์ขยะ แคช ถังขยะ และปิดโปรแกรมที่เปิดพร้อม Windows ให้เครื่องเร็วขึ้น" icon={<Sparkles />} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "junk", label: "ไฟล์ขยะ" }, { id: "startup", label: "โปรแกรมเปิดพร้อมเครื่อง" }]} />
      {tab === "junk" ? <Junk /> : <Startup />}
    </div>
  );
}

function Junk() {
  const [cats, setCats] = useState<Category[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [admin, setAdmin] = useState(true);
  const [last, setLast] = useState<CleanResult | null>(null);

  const scan = async () => {
    setScanning(true);
    const r = await attempt(() => call<Category[]>("clean_scan"));
    setScanning(false);
    if (!r) return;
    setCats(r);
    // เลือกค่าแนะนำไว้ให้ (ครั้งแรก) — ข้ามรายการที่ต้องใช้สิทธิ์แอดมินถ้าไม่มีสิทธิ์
    setSel((old) => (old.size ? old : new Set(r.filter((c) => c.recommended && c.size > 0 && (admin || !c.needsAdmin)).map((c) => c.id))));
  };

  useEffect(() => {
    call<boolean>("is_admin").then(setAdmin).catch(() => setAdmin(false));
    scan();
  }, []);

  const total = useMemo(() => (cats ?? []).filter((c) => sel.has(c.id)).reduce((a, c) => a + c.size, 0), [cats, sel]);
  const all = useMemo(() => (cats ?? []).reduce((a, c) => a + c.size, 0), [cats]);
  const groups = useMemo(() => {
    const m = new Map<string, Category[]>();
    for (const c of cats ?? []) m.set(c.group, [...(m.get(c.group) ?? []), c]);
    return [...m.entries()];
  }, [cats]);

  const toggle = (id: string) => setSel((s) => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const clean = async () => {
    const ids = [...sel];
    if (!ids.length) return;
    const warn = ids.includes("recycle") ? "\n\n⚠️ รวมถังขยะด้วย — ไฟล์ในถังขยะจะหายถาวร" : "";
    if (!(await confirmDialog(`ลบไฟล์ขยะประมาณ ${formatBytes(total)}?\nไฟล์ที่โปรแกรมอื่นกำลังใช้จะถูกข้ามไปเอง${warn}`, "ล้างเครื่อง"))) return;
    setCleaning(true);
    const r = await attempt(() => call<CleanResult>("clean_run", { ids }));
    setCleaning(false);
    if (r) {
      setLast(r);
      playSound("coin");
      useApp.getState().toast(`คืนพื้นที่ ${formatBytes(r.freed)} แล้ว 🎉`, "success");
      setSel(new Set());
      scan();
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <Stat label="พบไฟล์ขยะทั้งหมด" value={cats ? formatBytes(all) : "…"} icon={<HardDrive size={18} />} />
        <Stat label="ที่เลือกไว้" value={formatBytes(total)} icon={<Trash2 size={18} />} color="from-pink-500 to-orange-400" />
        <Stat label="ล้างครั้งล่าสุด" value={last ? formatBytes(last.freed) : "—"} sub={last ? `ลบ ${last.deleted.toLocaleString()} ไฟล์ · ข้าม ${last.skipped.toLocaleString()} ไฟล์ที่ใช้อยู่` : undefined} icon={<Sparkles size={18} />} color="from-lime-400 to-emerald-500" />
      </div>

      {!admin && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm">
          <ShieldAlert size={18} className="text-amber-400" />
          <span className="flex-1">บางรายการ (Windows Update, Temp ของระบบ) ต้องใช้สิทธิ์แอดมิน — ตอนนี้จะข้ามไฟล์ที่ลบไม่ได้</span>
          <button className="btn btn-sm" onClick={() => attempt(() => call("relaunch_admin"))}>เปิดใหม่แบบแอดมิน</button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" disabled={cleaning || scanning || !sel.size} onClick={clean}>
          <Trash2 size={16} /> {cleaning ? "กำลังล้าง..." : `ล้างที่เลือก (${formatBytes(total)})`}
        </button>
        <button className="btn" disabled={scanning || cleaning} onClick={scan}>
          <RefreshCw size={16} className={scanning ? "animate-spin" : ""} /> {scanning ? "กำลังสแกน..." : "สแกนใหม่"}
        </button>
        <button className="btn" onClick={() => setSel(new Set((cats ?? []).filter((c) => c.recommended && c.size > 0).map((c) => c.id)))}>เลือกค่าแนะนำ</button>
        <button className="btn" onClick={() => setSel(new Set((cats ?? []).filter((c) => c.size > 0).map((c) => c.id)))}>เลือกทั้งหมด</button>
        <button className="btn" onClick={() => setSel(new Set())}>ไม่เลือก</button>
      </div>

      {!cats ? (
        <Empty icon={<RefreshCw className="animate-spin" />} text="กำลังสแกนเครื่อง..." />
      ) : (
        groups.map(([g, items]) => (
          <Card key={g} title={g}>
            <div className="divide-y divide-fg/5">
              {items.map((c) => (
                <label key={c.id} className={`flex cursor-pointer items-center gap-3 py-2.5 ${c.size === 0 ? "opacity-50" : ""}`}>
                  <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--accent))]" checked={sel.has(c.id)} disabled={c.size === 0} onChange={() => toggle(c.id)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 font-medium">
                      {c.label}
                      {c.recommended && <span className="rounded bg-lime-400/15 px-1.5 text-[10px] text-lime-400">แนะนำ</span>}
                      {c.needsAdmin && <span className="rounded bg-amber-400/15 px-1.5 text-[10px] text-amber-400">แอดมิน</span>}
                    </div>
                    <div className="truncate text-xs text-fg/50">{c.desc}</div>
                  </div>
                  <div className="text-right font-mono text-sm">
                    {formatBytes(c.size)}
                    <div className="text-[10px] text-fg/40">{c.count.toLocaleString()} ไฟล์</div>
                  </div>
                </label>
              ))}
            </div>
          </Card>
        ))
      )}
      <p className="text-xs text-fg/50">ไม่แตะเอกสาร รูป รหัสผ่าน ประวัติเว็บ หรือการล็อกอิน · ไฟล์ชั่วคราวลบเฉพาะที่เก่ากว่า 1 วัน · ปิดเบราว์เซอร์ก่อนจะล้างแคชเบราว์เซอร์ได้หมด</p>
    </div>
  );
}

const LOC: Record<string, string> = { hkcu: "ผู้ใช้นี้ (Registry)", hklm: "ทั้งเครื่อง (Registry)", folder_user: "โฟลเดอร์ Startup", folder_common: "Startup ทั้งเครื่อง" };

function Startup() {
  const [items, setItems] = useState<StartupItem[] | null>(null);
  const load = () => call<StartupItem[]>("startup_list").then(setItems).catch(() => setItems([]));
  useEffect(() => {
    load();
  }, []);

  const set = async (it: StartupItem, enabled: boolean) => {
    const ok = await attempt(() => call("startup_set", { name: it.name, location: it.location, enabled }));
    if (ok !== undefined) load();
  };

  if (!items) return <Empty icon={<RefreshCw className="animate-spin" />} text="กำลังโหลด..." />;
  if (!items.length) return <Empty icon={<Rocket />} text="ไม่มีโปรแกรมที่เปิดพร้อม Windows" />;
  return (
    <Card title={`โปรแกรมเปิดพร้อม Windows (${items.filter((i) => i.enabled).length}/${items.length} เปิดอยู่)`}>
      <div className="divide-y divide-fg/5">
        {items.map((it) => (
          <div key={it.location + it.name} className="flex items-center gap-3 py-2.5">
            <Rocket size={16} className={it.enabled ? "text-accent" : "text-fg/30"} />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{it.name}</div>
              <div className="truncate text-xs text-fg/50" title={it.command}>{LOC[it.location] ?? it.location} · {it.command}</div>
            </div>
            <button className={`btn btn-sm ${it.enabled ? "" : "btn-primary"}`} onClick={() => set(it, !it.enabled)} title={it.editable ? "" : "รายการของทั้งเครื่อง อาจต้องเปิดโปรแกรมแบบแอดมิน"}>
              {it.enabled ? "ปิด" : "เปิด"}
            </button>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-fg/50">ปิดแล้วโปรแกรมยังอยู่ครบ แค่ไม่เปิดเองตอนเปิดเครื่อง (แบบเดียวกับ Task Manager) — เปิดกลับได้ทุกเมื่อ</p>
    </Card>
  );
}
