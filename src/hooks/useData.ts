// hooks สำหรับดึงข้อมูลที่ใช้บ่อย
import { useCallback, useEffect, useState } from "react";
import { api, call, listen, type FileEntry, type HistoryItem, type SystemStats } from "@/lib/api";

/** สถิติเครื่องแบบ real-time เก็บย้อนหลัง N จุด */
export function useSystemStats(intervalMs = 2000, keep = 40) {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [series, setSeries] = useState<{ t: number; cpu: number; mem: number; rx: number; tx: number }[]>([]);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      // หน้าต่างถูกซ่อน/ย่อ → ไม่ต้องดึงข้อมูล ประหยัด CPU
      if (document.hidden) return;
      const s = await call<SystemStats>("system_stats").catch(() => null);
      if (!alive || !s) return;
      setStats(s);
      setSeries((prev) => [...prev, { t: Date.now(), cpu: s.cpu, mem: (s.memUsed / s.memTotal) * 100, rx: s.netRx, tx: s.netTx }].slice(-keep));
    };
    tick();
    const t = setInterval(tick, intervalMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [intervalMs, keep]);
  return { stats, series };
}

export function useHistory() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const reload = useCallback(() => call<HistoryItem[]>("list_history", { limit: 5000 }).then(setItems).catch(() => {}), []);
  useEffect(() => {
    reload();
    // ออกจากหน้าก่อน listen เสร็จ → ต้องยกเลิกทันทีที่ได้ตัวยกเลิก ไม่งั้นตัวฟังค้างสะสม
    let dead = false;
    let un: (() => void) | undefined;
    listen("history-changed", reload).then((u) => (dead ? u() : (un = u)));
    return () => {
      dead = true;
      un?.();
    };
  }, [reload]);
  return { items, reload };
}

export function useFolderFiles(dir: string | undefined, mediaOnly = true) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const reload = useCallback(async () => {
    if (!dir) return;
    setLoading(true);
    try {
      setFiles(await api.scan(dir, true, mediaOnly));
    } catch {
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [dir, mediaOnly]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { files, loading, reload };
}

/** เก็บค่าใน kv ของฐานข้อมูล (คงอยู่ข้ามการเปิดโปรแกรม) */
export function useKv<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    api.kvGet<T>(key, initial).then((v) => {
      setValue(v);
      setLoaded(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const save = useCallback(
    (v: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v;
        api.kvSet(key, next);
        return next;
      });
    },
    [key],
  );
  return [value, save, loaded] as const;
}
