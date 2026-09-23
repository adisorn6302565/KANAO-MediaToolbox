// เลือกพื้นที่บนจอด้วยการลากเมาส์: ซ่อนโปรแกรม → ถ่ายทั้งเดสก์ท็อป → ให้ผู้ใช้ลากกรอบบนภาพนั้น
import { useEffect, useRef, useState } from "react";
import { api, fileUrl } from "@/lib/api";
import { joinPath } from "@/lib/format";

export type Rect = { x: number; y: number; w: number; h: number };

/** ถ่ายภาพเดสก์ท็อปทุกจอ (ซ่อนหน้าต่างโปรแกรมก่อน) — คืนพาธ PNG */
export async function grabDesktop(out?: string): Promise<string> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  const path = out ?? joinPath(await api.tempDir(), `desktop-${Date.now()}.png`);
  await win.hide();
  try {
    // รอให้ Windows วาดจอใหม่หลังซ่อนหน้าต่าง
    await new Promise((r) => setTimeout(r, 350));
    await api.ffmpegExec(["-y", "-f", "gdigrab", "-draw_mouse", "0", "-i", "desktop", "-frames:v", "1", "-update", "1", path]);
  } finally {
    await win.show();
    await win.setFocus();
  }
  return path;
}

/** แสดงภาพเดสก์ท็อปเต็มหน้าต่างให้ลากเลือกกรอบ — พิกัดที่คืนเป็นพิกเซลของภาพ (= พิกัดบนเดสก์ท็อปรวม) */
export function RegionPicker({ image, onDone, onCancel }: { image: string; onDone: (r: Rect) => void; onCancel: () => void }) {
  const img = useRef<HTMLImageElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [down, setDown] = useState(false);
  const finishRef = useRef<() => void>(() => {});

  useEffect(() => {
    const setFull = (on: boolean) => import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().setFullscreen(on)).catch(() => {});
    setFull(true);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") finishRef.current();
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      setFull(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toImage = () => {
    const el = img.current;
    if (!el || !drag) return null;
    // object-contain: ภาพจริงอยู่กลางกล่องและมีขอบดำ → หาขอบเขตภาพที่แสดงจริงก่อน
    const b = el.getBoundingClientRect();
    const k = Math.min(b.width / el.naturalWidth, b.height / el.naturalHeight);
    const left = b.left + (b.width - el.naturalWidth * k) / 2;
    const top = b.top + (b.height - el.naturalHeight * k) / 2;
    const x = Math.round((Math.min(drag.x0, drag.x1) - left) / k);
    const y = Math.round((Math.min(drag.y0, drag.y1) - top) / k);
    const w = Math.round(Math.abs(drag.x1 - drag.x0) / k);
    const h = Math.round(Math.abs(drag.y1 - drag.y0) / k);
    const cx = Math.max(0, x);
    const cy = Math.max(0, y);
    return { x: cx, y: cy, w: Math.min(w - (cx - x), el.naturalWidth - cx), h: Math.min(h - (cy - y), el.naturalHeight - cy) };
  };
  const finish = () => {
    const r = toImage();
    if (r && r.w >= 16 && r.h >= 16) onDone(r);
  };
  finishRef.current = finish;
  const r = toImage();
  const box = drag && { left: Math.min(drag.x0, drag.x1), top: Math.min(drag.y0, drag.y1), width: Math.abs(drag.x1 - drag.x0), height: Math.abs(drag.y1 - drag.y0) };

  return (
    <div
      className="fixed inset-0 z-[200] cursor-crosshair select-none bg-black"
      onMouseDown={(e) => {
        setDown(true);
        setDrag({ x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY });
      }}
      onMouseMove={(e) => down && setDrag((d) => d && { ...d, x1: e.clientX, y1: e.clientY })}
      onMouseUp={() => setDown(false)}
      onDoubleClick={finish}
    >
      <img ref={img} src={fileUrl(image)} className="pointer-events-none h-full w-full object-contain opacity-60" alt="" draggable={false} />
      {box && (
        <div className="pointer-events-none absolute border-2 border-accent2 bg-white/10" style={{ ...box, boxShadow: "0 0 0 9999px rgba(0,0,0,.35)" }}>
          {r && <span className="absolute -top-6 left-0 rounded bg-black/80 px-1.5 font-mono text-xs text-white">{r.w} × {r.h}</span>}
        </div>
      )}
      <div className="absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-2 rounded-xl bg-black/80 px-4 py-2 text-sm text-white" onMouseDown={(e) => e.stopPropagation()}>
        ลากเมาส์เพื่อเลือกพื้นที่
        <button className="btn-primary btn-sm" disabled={!r || r.w < 16 || r.h < 16} onClick={finish}>ใช้พื้นที่นี้ (Enter)</button>
        <button className="btn btn-sm" onClick={onCancel}>ยกเลิก (Esc)</button>
      </div>
    </div>
  );
}
