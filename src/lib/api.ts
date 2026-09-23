// ชั้นเชื่อมต่อกับ backend (Rust) — ทุกคำสั่งผ่าน invoke()
// ถ้าเปิดในเบราว์เซอร์ธรรมดา (ไม่ใช่ Tauri) จะใช้ข้อมูลจำลองเพื่อให้ดูหน้าตาได้
import { invoke as tauriInvoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen as tauriListen, type UnlistenFn } from "@tauri-apps/api/event";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface Settings {
  downloadDir: string;
  concurrentJobs: number;
  ffmpegPath: string;
  ytdlpPath: string;
  proxy: string;
  rateLimit: string;
  cookiesBrowser: string;
  cookiesFile: string;
  theme: string;
  accent: string;
  language: string;
  sound: boolean;
  notify: boolean;
  autoUpdate: boolean;
  autostart: boolean;
  minimizeToTray: boolean;
  buddhistEra: boolean;
  pinHash: string;
  autoLockMinutes: number;
  displayName: string;
  avatar: string;
  notifySound: string;
  shortcuts: Record<string, string>;
  widgets: string[];
  customTheme: Record<string, string>;
  webhookUrl: string;
  onboarded: boolean;
  fullEffects: boolean;
}

export type JobStatus = "queued" | "running" | "paused" | "done" | "failed" | "cancelled";

export interface Job {
  id: string;
  kind: string;
  title: string;
  status: JobStatus;
  progress: number;
  speed: string;
  eta: string;
  message: string;
  input: string;
  output: string;
  sizeBefore: number;
  sizeAfter: number;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  startAt?: string;
  priority: number;
}

export interface FileEntry {
  path: string;
  name: string;
  ext: string;
  size: number;
  modified: number;
  kind: "video" | "audio" | "image" | "document" | "archive" | "other" | "folder";
  isDir: boolean;
}

export interface HistoryItem {
  id: string;
  kind: string;
  title: string;
  input: string;
  output: string;
  status: string;
  sizeBefore: number;
  sizeAfter: number;
  message: string;
  createdAt: string;
}

export interface LogItem {
  id: number;
  level: string;
  source: string;
  message: string;
  createdAt: string;
}

export interface SystemStats {
  cpu: number;
  cores: number[];
  cpuName: string;
  memUsed: number;
  memTotal: number;
  appMem: number;
  disks: { name: string; mount: string; total: number; available: number }[];
  netRx: number;
  netTx: number;
  uptime: number;
  os: string;
  host: string;
}

export interface ServerStatus {
  running: boolean;
  url: string;
  root: string;
  port: number;
}

export interface DownloadOptions {
  urls: string[];
  mode: "video" | "audio" | "subs" | "thumbnail";
  quality: string;
  format: string;
  subtitles: boolean;
  subLangs: string;
  thumbnail: boolean;
  metadata: boolean;
  playlist: boolean;
  liveFromStart: boolean;
  startAt?: string | null;
  outputDir: string;
  template: string;
  extraArgs: string[];
}

export interface FfmpegJobReq {
  kind: string;
  title: string;
  input: string;
  output: string;
  passes: string[][];
  duration?: number;
  gracefulStop?: boolean;
  startAt?: string | null;
}

// ---------- ข้อมูลจำลองสำหรับโหมดเบราว์เซอร์ ----------
const mockSettings: Settings = {
  downloadDir: "C:\\Users\\คุณ\\Documents\\MediaToolbox",
  concurrentJobs: 3,
  ffmpegPath: "",
  ytdlpPath: "",
  proxy: "",
  rateLimit: "",
  cookiesBrowser: "",
  cookiesFile: "",
  theme: "dark",
  accent: "#a855f7",
  language: "th",
  sound: true,
  notify: true,
  autoUpdate: false,
  autostart: false,
  minimizeToTray: false,
  buddhistEra: true,
  pinHash: "",
  autoLockMinutes: 0,
  displayName: "ผู้ใช้",
  avatar: "",
  notifySound: "ding",
  shortcuts: {},
  widgets: ["stats", "quick", "activity", "system", "recent", "storage"],
  customTheme: {},
  webhookUrl: "",
  onboarded: true,
  fullEffects: false,
};
const mockKv = new Map<string, string>();
const now = Date.now();
const mockFiles: FileEntry[] = [
  { path: "C:\\demo\\ละครไทย ตอนที่ 1.mp4", name: "ละครไทย ตอนที่ 1.mp4", ext: "mp4", size: 734_000_000, modified: now - 3600e3, kind: "video", isDir: false },
  { path: "C:\\demo\\เพลงโปรด.mp3", name: "เพลงโปรด.mp3", ext: "mp3", size: 8_200_000, modified: now - 7200e3, kind: "audio", isDir: false },
  { path: "C:\\demo\\ทะเล.jpg", name: "ทะเล.jpg", ext: "jpg", size: 2_400_000, modified: now - 86400e3, kind: "image", isDir: false },
  { path: "C:\\demo\\เอกสาร.pdf", name: "เอกสาร.pdf", ext: "pdf", size: 1_100_000, modified: now - 2 * 86400e3, kind: "document", isDir: false },
];
function mock(cmd: string, args: any): any {
  switch (cmd) {
    case "get_settings":
      return { ...mockSettings };
    case "save_settings":
      Object.assign(mockSettings, args.settings);
      return { ...mockSettings };
    case "reset_settings":
      return { ...mockSettings };
    case "kv_get":
      return mockKv.get(args.key) ?? null;
    case "kv_set":
      mockKv.set(args.key, args.value);
      return null;
    case "list_jobs":
      return [];
    case "list_history":
      return [
        { id: "1", kind: "download", title: "[YouTube] คลิปตัวอย่าง", input: "https://youtu.be/x", output: "C:\\demo", status: "done", sizeBefore: 0, sizeAfter: 52_000_000, message: "เสร็จแล้ว ✓", createdAt: new Date(now - 3600e3).toISOString() },
        { id: "2", kind: "convert", title: "แปลง ละครไทย.mkv → mp4", input: "a.mkv", output: "a.mp4", status: "done", sizeBefore: 900_000_000, sizeAfter: 610_000_000, message: "เสร็จแล้ว ✓", createdAt: new Date(now - 86400e3).toISOString() },
        { id: "3", kind: "compress", title: "บีบอัด PDF", input: "a.pdf", output: "b.pdf", status: "failed", sizeBefore: 5e6, sizeAfter: 0, message: "ไฟล์เสีย", createdAt: new Date(now - 3 * 86400e3).toISOString() },
      ];
    case "list_logs":
      return [{ id: 1, level: "info", source: "app", message: "เปิดโปรแกรม (โหมดเบราว์เซอร์)", createdAt: new Date().toISOString() }];
    case "system_stats":
      return {
        cpu: 10 + Math.random() * 30,
        cores: Array.from({ length: 8 }, () => Math.random() * 60),
        cpuName: "CPU จำลอง",
        memUsed: 7.2e9 + Math.random() * 5e8,
        memTotal: 16e9,
        appMem: 120e6,
        disks: [
          { name: "Windows", mount: "C:\\", total: 240e9, available: 67e9 },
          { name: "Data", mount: "E:\\", total: 540e9, available: 514e9 },
        ],
        netRx: Math.random() * 2e6,
        netTx: Math.random() * 3e5,
        uptime: 12345,
        os: "Windows 10 Pro",
        host: "MY-PC",
      } satisfies SystemStats;
    case "gpu_info":
      return ["การ์ดจอจำลอง | 4096 MB"];
    case "scan_files":
    case "find_large":
      return mockFiles;
    case "list_dir":
      return mockFiles;
    case "folder_sizes":
      return [
        { name: "วิดีโอ", path: "C:\\demo\\v", size: 12e9, files: 40 },
        { name: "เพลง", path: "C:\\demo\\m", size: 3e9, files: 300 },
        { name: "รูป", path: "C:\\demo\\p", size: 1.5e9, files: 900 },
      ];
    case "find_duplicates":
      return [];
    case "find_empty_dirs":
      return [];
    case "tool_status":
      return [
        { name: "ffmpeg", path: null, version: null },
        { name: "ffprobe", path: null, version: null },
        { name: "yt-dlp", path: null, version: null },
      ];
    case "app_info":
      return { version: "1.1.1", dataDir: "C:\\AppData\\MediaToolbox", downloadDir: mockSettings.downloadDir, args: [] };
    case "server_status":
    case "stop_server":
      return { running: false, url: "", root: "", port: 0 };
    case "has_pin":
      return false;
    case "verify_pin":
      return true;
    case "temp_dir":
      return "C:\\temp";
    case "add_log":
    case "notify":
    case "job_action":
      return null;
    default:
      throw new Error("ฟังก์ชันนี้ใช้ได้เฉพาะในโปรแกรมเดสก์ท็อป (ไม่ใช่เบราว์เซอร์)");
  }
}

export async function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!isTauri) return mock(cmd, args) as T;
  return tauriInvoke<T>(cmd, args);
}

export function listen<T>(event: string, cb: (payload: T) => void): Promise<UnlistenFn> {
  if (!isTauri) return Promise.resolve(() => {});
  return tauriListen<T>(event, (e) => cb(e.payload));
}

/** แปลงพาธไฟล์ในเครื่องเป็น URL ที่ webview เปิดได้ */
export function fileUrl(path: string): string {
  if (!path) return "";
  if (!isTauri) return "";
  return convertFileSrc(path);
}

// ---------- dialog / opener ----------
export async function pickFiles(opts: { multiple?: boolean; filters?: { name: string; extensions: string[] }[]; title?: string } = {}): Promise<string[]> {
  if (!isTauri) return [];
  const { open } = await import("@tauri-apps/plugin-dialog");
  const r = await open({ multiple: opts.multiple ?? true, filters: opts.filters, title: opts.title });
  if (!r) return [];
  return Array.isArray(r) ? r : [r];
}

export async function pickFolder(title = "เลือกโฟลเดอร์"): Promise<string | null> {
  if (!isTauri) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const r = await open({ directory: true, title });
  return typeof r === "string" ? r : null;
}

export async function pickSave(defaultPath: string, filters?: { name: string; extensions: string[] }[]): Promise<string | null> {
  if (!isTauri) return null;
  const { save } = await import("@tauri-apps/plugin-dialog");
  return (await save({ defaultPath, filters })) ?? null;
}

export async function confirmDialog(message: string, title = "ยืนยัน"): Promise<boolean> {
  if (!isTauri) return window.confirm(message);
  const { confirm } = await import("@tauri-apps/plugin-dialog");
  return confirm(message, { title, kind: "warning", okLabel: "ตกลง", cancelLabel: "ยกเลิก" });
}

export async function openPath(path: string) {
  if (!isTauri) return;
  const { openPath } = await import("@tauri-apps/plugin-opener");
  await openPath(path);
}

export async function revealPath(path: string) {
  if (!isTauri) return;
  const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
  await revealItemInDir(path);
}

export async function openUrl(url: string) {
  if (!isTauri) {
    window.open(url, "_blank");
    return;
  }
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
}

// ---------- ทางลัดคำสั่งที่ใช้บ่อย ----------
export const api = {
  getSettings: () => call<Settings>("get_settings"),
  saveSettings: (settings: Settings) => call<Settings>("save_settings", { settings }),
  kvGet: async <T>(key: string, fallback: T): Promise<T> => {
    try {
      const v = await call<string | null>("kv_get", { key });
      return v ? (JSON.parse(v) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  kvSet: (key: string, value: unknown) => call<void>("kv_set", { key, value: JSON.stringify(value) }),
  listJobs: () => call<Job[]>("list_jobs"),
  jobAction: (id: string, action: string) => call<void>("job_action", { id, action }),
  startDownload: (options: DownloadOptions) => call<Job[]>("start_download", { options }),
  fetchInfo: (url: string) => call<any>("fetch_info", { url }),
  ffmpegJob: (req: FfmpegJobReq) => call<Job>("ffmpeg_job", { req }),
  ffmpegExec: (args: string[]) => call<string>("ffmpeg_exec", { args }),
  probe: (path: string) => call<any>("probe_media", { path }),
  thumbnail: (path: string) => call<string>("make_thumbnail", { path }),
  scan: (dir: string, recursive = true, mediaOnly = false, since?: number) =>
    call<FileEntry[]>("scan_files", { dir, recursive, mediaOnly, since: since ?? null }),
  log: (level: string, source: string, message: string) => call<void>("add_log", { level, source, message }).catch(() => {}),
  notify: (title: string, body: string) => call<void>("notify", { title, body }).catch(() => {}),
  tempDir: () => call<string>("temp_dir"),
};
