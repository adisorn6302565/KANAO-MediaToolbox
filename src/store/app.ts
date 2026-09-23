// สถานะกลางฝั่งหน้าบ้าน (zustand)
import { create } from "zustand";
import { api, call, listen, type Job, type Settings } from "@/lib/api";
import { setBuddhistEra } from "@/lib/format";
import { playSound } from "@/lib/sound";

export interface Toast {
  id: number;
  kind: "info" | "success" | "error";
  text: string;
}

export interface Activity {
  id: string;
  text: string;
  at: number;
  kind: string;
}

interface AppStore {
  settings: Settings | null;
  jobs: Record<string, Job>;
  toasts: Toast[];
  activity: Activity[];
  locked: boolean;
  droppedFiles: { paths: string[]; at: number } | null;
  helpOpen: boolean;
  shortcutsOpen: boolean;
  achievements: Record<string, number>;
  init: () => Promise<void>;
  saveSettings: (patch: Partial<Settings>) => Promise<void>;
  toast: (text: string, kind?: Toast["kind"]) => void;
  dismiss: (id: number) => void;
  setLocked: (v: boolean) => void;
  setDropped: (paths: string[]) => void;
  setHelp: (v: boolean) => void;
  setShortcuts: (v: boolean) => void;
  unlock: (key: string) => void;
  refreshJobs: () => Promise<void>;
}

let toastId = 1;
let initialized = false;

export const ACHIEVEMENTS: Record<string, { title: string; desc: string; icon: string }> = {
  first_download: { title: "นักโหลดมือใหม่", desc: "โหลดคลิปสำเร็จครั้งแรก", icon: "📥" },
  ten_downloads: { title: "นักสะสม", desc: "โหลดสำเร็จ 10 ครั้ง", icon: "🏆" },
  first_convert: { title: "นักแปลงร่าง", desc: "แปลงไฟล์สำเร็จครั้งแรก", icon: "🔄" },
  saver: { title: "นักประหยัดพื้นที่", desc: "บีบอัดไฟล์สำเร็จ", icon: "💾" },
  konami: { title: "เกมเมอร์ตัวจริง", desc: "ค้นพบรหัสลับ Konami", icon: "🎮" },
  pomodoro: { title: "โฟกัสขั้นเทพ", desc: "ทำ Pomodoro ครบ 1 รอบ", icon: "🍅" },
  night_owl: { title: "นกฮูกราตรี", desc: "ใช้งานหลังเที่ยงคืน", icon: "🦉" },
  explorer: { title: "นักสำรวจ", desc: "เปิดครบ 10 หน้า", icon: "🧭" },
  secure: { title: "ปลอดภัยไว้ก่อน", desc: "เข้ารหัสไฟล์ครั้งแรก", icon: "🔐" },
  cat: { title: "ทาสแมว", desc: "ลูบแมวน้อย", icon: "🐱" },
};

export const useApp = create<AppStore>((set, get) => ({
  settings: null,
  jobs: {},
  toasts: [],
  activity: [],
  locked: false,
  droppedFiles: null,
  helpOpen: false,
  shortcutsOpen: false,
  achievements: {},

  init: async () => {
    if (initialized) return;
    initialized = true;
    const settings = await api.getSettings();
    setBuddhistEra(settings.buddhistEra);
    const hasPin = await call<boolean>("has_pin").catch(() => false);
    const achievements = await api.kvGet<Record<string, number>>("achievements", {});
    set({ settings, locked: hasPin, achievements });
    await get().refreshJobs();
    listen<Job>("job-update", (job) => {
      const prev = get().jobs[job.id];
      set((s) => ({ jobs: { ...s.jobs, [job.id]: job } }));
      if (prev && prev.status !== job.status && ["done", "failed"].includes(job.status)) {
        const ok = job.status === "done";
        get().toast(`${ok ? "เสร็จแล้ว" : "ไม่สำเร็จ"}: ${job.title}`, ok ? "success" : "error");
        set((s) => ({ activity: [{ id: job.id + job.status, text: `${ok ? "✅" : "⚠️"} ${job.title}`, at: Date.now(), kind: job.kind }, ...s.activity].slice(0, 50) }));
        if (get().settings?.sound) playSound(ok ? get().settings?.notifySound ?? "ding" : "error");
        if (ok && job.kind === "download") {
          get().unlock("first_download");
          const n = (Number(localStorage.getItem("mtb-dl-count")) || 0) + 1;
          localStorage.setItem("mtb-dl-count", String(n));
          if (n >= 10) get().unlock("ten_downloads");
        }
        if (ok && job.kind === "convert") get().unlock("first_convert");
        if (ok && job.kind === "compress") get().unlock("saver");
      } else if (!prev) {
        set((s) => ({ activity: [{ id: job.id, text: `➕ เพิ่มงาน: ${job.title}`, at: Date.now(), kind: job.kind }, ...s.activity].slice(0, 50) }));
      }
    });
    listen<string>("job-removed", () => get().refreshJobs());
    if (new Date().getHours() < 4) get().unlock("night_owl");
  },

  refreshJobs: async () => {
    const list = await api.listJobs().catch(() => [] as Job[]);
    set({ jobs: Object.fromEntries(list.map((j) => [j.id, j])) });
  },

  saveSettings: async (patch) => {
    const cur = get().settings;
    if (!cur) return;
    try {
      const saved = await api.saveSettings({ ...cur, ...patch });
      setBuddhistEra(saved.buddhistEra);
      set({ settings: saved });
    } catch (e) {
      get().toast(String(e), "error");
    }
  },

  toast: (text, kind = "info") => {
    const id = toastId++;
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }].slice(-5) }));
    setTimeout(() => get().dismiss(id), kind === "error" ? 8000 : 4000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setLocked: (v) => set({ locked: v }),
  setDropped: (paths) => set({ droppedFiles: { paths, at: Date.now() } }),
  setHelp: (v) => set({ helpOpen: v }),
  setShortcuts: (v) => set({ shortcutsOpen: v }),
  unlock: (key) => {
    if (get().achievements[key] || !ACHIEVEMENTS[key]) return;
    const achievements = { ...get().achievements, [key]: Date.now() };
    set({ achievements });
    api.kvSet("achievements", achievements);
    const a = ACHIEVEMENTS[key];
    get().toast(`${a.icon} ปลดล็อกความสำเร็จ: ${a.title}`, "success");
  },
}));

/** ล็อกเฉพาะเมื่อตั้ง PIN ไว้ — ไม่งั้นจอล็อกจะรับ PIN อะไรก็ได้ */
export async function lockIfPin() {
  if (await call<boolean>("has_pin").catch(() => false)) useApp.getState().setLocked(true);
  else useApp.getState().toast("ยังไม่ได้ตั้ง PIN — ตั้งได้ที่หน้า ความปลอดภัย");
}

/** แปลง error ให้เป็นข้อความอ่านง่าย */
export function errText(e: unknown): string {
  const s = typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e);
  return s || "เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ";
}

/** ครอบการทำงาน async: แสดง toast เมื่อผิดพลาด */
export async function attempt<T>(fn: () => Promise<T>, success?: string): Promise<T | undefined> {
  try {
    const r = await fn();
    if (success) useApp.getState().toast(success, "success");
    return r;
  } catch (e) {
    useApp.getState().toast(errText(e), "error");
    return undefined;
  }
}
