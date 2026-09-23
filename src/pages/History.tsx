// หน้า 20: ประวัติ
import { useMemo, useState } from "react";
import { History as HistoryIcon, Search, FolderOpen, ExternalLink, Copy, Trash2, FileJson, FileSpreadsheet } from "lucide-react";
import { Card, Empty, PageHeader, Select } from "@/components/ui";
import { call, confirmDialog, openPath, revealPath, type HistoryItem } from "@/lib/api";
import { attempt, useApp } from "@/store/app";
import { useHistory } from "@/hooks/useData";
import { basename, downloadText, formatBytes, formatDate, localDateKey, toCSV } from "@/lib/format";

const KINDS: Record<string, string> = { download: "📥 โหลด", convert: "🔄 แปลง", compress: "🗜️ บีบอัด", edit: "✂️ ตัดต่อ", record: "🔴 อัด", pdf: "📄 PDF" };
const STATUS: Record<string, string> = { done: "✅ สำเร็จ", failed: "⚠️ ไม่สำเร็จ", cancelled: "⏹️ ยกเลิก" };

export interface HistoryFilter {
  q: string;
  kind: string;
  status: string;
  from: string;
  to: string;
}

/** กรองประวัติ (แยกออกมาเพื่อทดสอบได้) */
export function filterHistory(items: HistoryItem[], f: HistoryFilter) {
  const q = f.q.trim().toLowerCase();
  const from = f.from ? new Date(f.from + "T00:00:00").getTime() : -Infinity;
  const to = f.to ? new Date(f.to + "T23:59:59").getTime() : Infinity;
  return items.filter((h) => {
    const t = new Date(h.createdAt).getTime();
    return (
      (f.kind === "all" || h.kind === f.kind) &&
      (f.status === "all" || h.status === f.status) &&
      t >= from &&
      t <= to &&
      (!q || `${h.title} ${h.input} ${h.output} ${h.message}`.toLowerCase().includes(q))
    );
  });
}

export default function HistoryPage() {
  const { items, reload } = useHistory();
  const [f, setF] = useState<HistoryFilter>({ q: "", kind: "all", status: "all", from: "", to: "" });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(100);
  const list = useMemo(() => filterHistory(items, f), [items, f]);
  const kinds = [...new Set(items.map((h) => h.kind))];
  const shown = list.slice(0, limit);
  const toggle = (id: string) => {
    const n = new Set(sel);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setSel(n);
  };
  const del = async (ids: string[]) => {
    if (!(await confirmDialog(`ลบประวัติ ${ids.length} รายการ? (ไฟล์จริงจะไม่ถูกลบ)`))) return;
    await attempt(() => call("delete_history", { ids }), "ลบประวัติแล้ว");
    setSel(new Set());
    reload();
  };
  const clearAll = async () => {
    if (!(await confirmDialog("ล้างประวัติทั้งหมด? (ไฟล์จริงจะไม่ถูกลบ)"))) return;
    await attempt(() => call("clear_history"), "ล้างประวัติแล้ว");
    reload();
  };
  const copy = (t: string) => {
    navigator.clipboard.writeText(t);
    useApp.getState().toast("คัดลอกพาธแล้ว");
  };
  const stamp = localDateKey();
  return (
    <div>
      <PageHeader
        title="ประวัติ"
        subtitle={`ทั้งหมด ${items.length} รายการ`}
        icon={<HistoryIcon />}
        actions={
          <>
            <button className="btn" onClick={() => downloadText(`ประวัติ-${stamp}.csv`, toCSV(list as unknown as Record<string, unknown>[]), "text/csv")}><FileSpreadsheet size={15} /> CSV</button>
            <button className="btn" onClick={() => downloadText(`ประวัติ-${stamp}.json`, JSON.stringify(list, null, 2), "application/json")}><FileJson size={15} /> JSON</button>
            <button className="btn-danger" disabled={!items.length} onClick={clearAll}><Trash2 size={15} /> ล้างทั้งหมด</button>
          </>
        }
      />
      <Card>
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search size={15} className="absolute left-3 top-3 text-muted" />
            <input className="input pl-9" placeholder="ค้นหาชื่อ พาธ หรือข้อความ" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
          </div>
          <Select className="w-36" value={f.kind} onChange={(v) => setF({ ...f, kind: v })} options={[{ value: "all", label: "ทุกประเภท" }, ...kinds.map((k) => ({ value: k, label: KINDS[k] ?? k }))]} />
          <Select className="w-36" value={f.status} onChange={(v) => setF({ ...f, status: v })} options={[{ value: "all", label: "ทุกสถานะ" }, ...Object.entries(STATUS).map(([value, label]) => ({ value, label }))]} />
          <input type="date" className="input w-auto" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} title="ตั้งแต่วันที่" />
          <input type="date" className="input w-auto" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} title="ถึงวันที่" />
        </div>
        {sel.size > 0 && (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-accent/15 px-3 py-2 text-sm">
            เลือก {sel.size} รายการ
            <button className="btn btn-sm" onClick={() => setSel(new Set())}>ยกเลิก</button>
            <button className="btn btn-sm text-red-300" onClick={() => del([...sel])}><Trash2 size={12} /> ลบที่เลือก</button>
          </div>
        )}
        <div className="mt-3 overflow-x-auto">
          {list.length === 0 ? (
            <Empty icon={<HistoryIcon />} text={items.length ? "ไม่พบรายการที่ตรงกับตัวกรอง" : "ยังไม่มีประวัติ"} />
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="w-8 py-2">
                    <input type="checkbox" checked={shown.every((h) => sel.has(h.id))} onChange={(e) => setSel(e.target.checked ? new Set(shown.map((h) => h.id)) : new Set())} />
                  </th>
                  <th>ชื่อ</th>
                  <th>ประเภท</th>
                  <th>สถานะ</th>
                  <th>ขนาด</th>
                  <th>วันที่</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((h) => (
                  <tr key={h.id} className="border-t border-fg/5 hover:bg-fg/[.03]">
                    <td className="py-2"><input type="checkbox" checked={sel.has(h.id)} onChange={() => toggle(h.id)} /></td>
                    <td className="max-w-xs">
                      <div className="truncate" title={h.title}>{h.title}</div>
                      {h.output && <div className="truncate text-xs text-muted" title={h.output}>{basename(h.output)}</div>}
                      {h.status === "failed" && h.message && <div className="truncate text-xs text-red-300" title={h.message}>{h.message}</div>}
                    </td>
                    <td className="whitespace-nowrap">{KINDS[h.kind] ?? h.kind}</td>
                    <td className="whitespace-nowrap">{STATUS[h.status] ?? h.status}</td>
                    <td className="whitespace-nowrap font-mono text-xs">
                      {h.sizeAfter > 0 ? formatBytes(h.sizeAfter) : "-"}
                      {h.sizeBefore > h.sizeAfter && h.sizeAfter > 0 && <span className="ml-1 text-lime-300">-{Math.round((1 - h.sizeAfter / h.sizeBefore) * 100)}%</span>}
                    </td>
                    <td className="whitespace-nowrap text-xs text-muted">{formatDate(h.createdAt)}</td>
                    <td className="whitespace-nowrap text-right">
                      {h.output && (
                        <>
                          <button className="btn btn-sm" title="เปิดไฟล์" onClick={() => openPath(h.output)}><ExternalLink size={12} /></button>
                          <button className="btn btn-sm" title="เปิดโฟลเดอร์" onClick={() => revealPath(h.output)}><FolderOpen size={12} /></button>
                          <button className="btn btn-sm" title="คัดลอกพาธ" onClick={() => copy(h.output)}><Copy size={12} /></button>
                        </>
                      )}
                      <button className="btn btn-sm" title="ลบประวัติ" onClick={() => del([h.id])}><Trash2 size={12} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {list.length > limit && <button className="btn mt-3 w-full" onClick={() => setLimit(limit + 200)}>แสดงเพิ่ม ({list.length - limit} รายการ)</button>}
        </div>
      </Card>
    </div>
  );
}
