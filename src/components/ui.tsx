// ชิ้นส่วน UI ที่ใช้ร่วมกันทุกหน้า
import { useEffect, useRef, useState, type ReactNode } from "react";
import { HelpCircle, X, Upload, FolderOpen } from "lucide-react";
import { useLocation } from "react-router-dom";
import { NAV } from "@/lib/nav";
import { useApp } from "@/store/app";
import { pickFiles, isTauri } from "@/lib/api";

export function PageHeader({ title, subtitle, icon, actions }: { title: string; subtitle?: string; icon?: ReactNode; actions?: ReactNode }) {
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const help = NAV.find((n) => n.path === loc.pathname)?.help;
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3 animate-fadein">
      <div className="flex items-center gap-3">
        {icon && <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-accent to-accent2 text-white shadow-glow">{icon}</div>}
        <div>
          <h1 className="font-display text-2xl font-semibold leading-tight">{title}</h1>
          {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {actions}
        {help && (
          <button className="btn" onClick={() => setOpen(true)} title="วิธีใช้หน้านี้">
            <HelpCircle size={16} /> ช่วยเหลือ
          </button>
        )}
      </div>
      {open && (
        <Modal title={`วิธีใช้: ${title}`} onClose={() => setOpen(false)}>
          <p className="leading-relaxed">{help}</p>
          <p className="mt-3 text-sm text-muted">กด <kbd className="chip">?</kbd> เพื่อดูคีย์ลัดทั้งหมด</p>
        </Modal>
      )}
    </div>
  );
}

export function Card({ title, children, className = "", actions }: { title?: ReactNode; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={`card animate-fadein ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="font-display text-base font-semibold">{title}</h2>}
          <div className="flex items-center gap-2">{actions}</div>
        </div>
      )}
      {children}
    </section>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="glass mb-4 inline-flex flex-wrap gap-1 p-1">
      {tabs.map((t) => (
        <button key={t.id} className={value === t.id ? "tab-active" : "tab"} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children, hint, className = "" }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1.5">
      <span>
        <span className="text-sm">{label}</span>
        {hint && <span className="block text-[11px] text-muted">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? "bg-accent shadow-glow" : "bg-fg/20"}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${checked ? "left-[22px]" : "left-0.5"}`} />
      </button>
    </label>
  );
}

export function Slider({ label, value, min, max, step = 1, onChange, suffix = "", format }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; suffix?: string; format?: (v: number) => string }) {
  return (
    <label className="block">
      <span className="label flex justify-between">
        <span>{label}</span>
        <span className="font-mono text-fg">{format ? format(value) : `${value}${suffix}`}</span>
      </span>
      <input type="range" className="w-full" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

export function Select<T extends string>({ value, onChange, options, className = "" }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] | readonly T[]; className?: string }) {
  return (
    <select className={`input ${className}`} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => {
        const v = typeof o === "string" ? o : o.value;
        const l = typeof o === "string" ? o.toUpperCase() : o.label;
        return (
          <option key={v} value={v}>
            {l}
          </option>
        );
      })}
    </select>
  );
}

export function Modal({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div className={`glass max-h-[88vh] w-full overflow-auto p-5 animate-fadein ${wide ? "max-w-4xl" : "max-w-lg"}`} style={{ background: "rgb(var(--bg) / 0.92)" }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold">{title}</h3>
          <button className="btn btn-sm" onClick={onClose} aria-label="ปิด">
            <X size={14} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Progress({ value }: { value: number }) {
  return (
    <div className="progress">
      <div style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Empty({ icon, text, children }: { icon?: ReactNode; text: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-muted">
      <div className="text-4xl opacity-60">{icon ?? "📭"}</div>
      <p className="text-sm">{text}</p>
      {children}
    </div>
  );
}

export function Stat({ label, value, icon, color = "from-accent to-accent2", sub }: { label: string; value: ReactNode; icon: ReactNode; color?: string; sub?: string }) {
  return (
    <div className="card relative overflow-hidden animate-fadein">
      <div className={`absolute -right-6 -top-6 h-24 w-24 rounded-full bg-gradient-to-br ${color} opacity-20 blur-xl`} />
      <div className="flex items-center gap-3">
        <div className={`grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br ${color} text-white`}>{icon}</div>
        <div className="min-w-0">
          <div className="text-xs text-muted">{label}</div>
          <div className="truncate font-mono text-xl font-semibold">{value}</div>
          {sub && <div className="text-[11px] text-muted">{sub}</div>}
        </div>
      </div>
    </div>
  );
}

/** รับไฟล์ที่ลากมาวางบนหน้าต่าง (Tauri ส่งพาธจริงมาให้) */
export function useFileDrop(handler: (paths: string[]) => void) {
  const dropped = useApp((s) => s.droppedFiles);
  const ref = useRef(handler);
  ref.current = handler;
  const seen = useRef(dropped?.at ?? 0);
  useEffect(() => {
    if (dropped && dropped.at !== seen.current) {
      seen.current = dropped.at;
      ref.current(dropped.paths);
    }
  }, [dropped]);
}

export function DropZone({ onFiles, accept, label = "ลากไฟล์มาวางที่นี่", multiple = true, compact }: { onFiles: (paths: string[]) => void; accept?: string[]; label?: string; multiple?: boolean; compact?: boolean }) {
  const filter = (paths: string[]) => (accept ? paths.filter((p) => accept.includes(p.split(".").pop()?.toLowerCase() ?? "")) : paths);
  const toast = useApp((s) => s.toast);
  useFileDrop((paths) => {
    const ok = filter(paths);
    if (!ok.length) toast("ไฟล์ที่ลากมาไม่ใช่ชนิดที่หน้านี้รองรับ", "error");
    else onFiles(multiple ? ok : ok.slice(0, 1));
  });
  const browse = async () => {
    const files = await pickFiles({ multiple, filters: accept ? [{ name: "ไฟล์ที่รองรับ", extensions: accept }] : undefined });
    if (files.length) onFiles(files);
  };
  return (
    <button
      type="button"
      onClick={browse}
      className={`group flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-fg/15 text-muted transition hover:border-accent hover:bg-accent/5 hover:text-fg ${compact ? "py-5" : "py-10"}`}
    >
      <Upload className="transition group-hover:-translate-y-1 group-hover:text-accent" size={compact ? 22 : 34} />
      <span className="text-sm font-medium">{label}</span>
      <span className="flex items-center gap-1 text-xs">
        <FolderOpen size={12} /> หรือคลิกเพื่อเลือกไฟล์ {accept && `(${accept.slice(0, 8).join(", ")}${accept.length > 8 ? " ..." : ""})`}
      </span>
      {!isTauri && <span className="text-[11px] text-amber-400">โหมดเบราว์เซอร์: เลือกไฟล์ได้เฉพาะในโปรแกรมเดสก์ท็อป</span>}
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md border border-fg/20 bg-fg/10 px-1.5 py-0.5 font-mono text-[11px]">{children}</kbd>;
}

/**
 * จัดลำดับด้วยการลาก (ใช้ pointer events แทน HTML5 drag-drop
 * เพราะ WebView2 ปิด HTML5 DnD เมื่อเปิดรับไฟล์ลากจาก Explorer)
 */
export function useReorder(move: (from: number, to: number) => void) {
  const [dragging, setDragging] = useState<number | null>(null);
  useEffect(() => {
    if (dragging === null) return;
    const up = () => setDragging(null);
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, [dragging]);
  return (i: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest("button,input,select,textarea")) return;
      e.preventDefault();
      setDragging(i);
    },
    onPointerEnter: () => {
      if (dragging !== null && dragging !== i) {
        move(dragging, i);
        setDragging(i);
      }
    },
    "data-dragging": dragging === i ? "" : undefined,
    style: { cursor: dragging !== null ? "grabbing" : "grab", opacity: dragging === i ? 0.6 : 1, touchAction: "none" as const },
  });
}

export function moveItem<T>(arr: T[], from: number, to: number): T[] {
  const a = [...arr];
  const [m] = a.splice(from, 1);
  a.splice(to, 0, m);
  return a;
}
