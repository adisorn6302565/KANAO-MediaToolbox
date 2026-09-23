// หน้า 2: โหลดคลิป
import { useMemo, useState } from "react";
import { Download, Link2, Search, Save, Clipboard, Cookie, Globe, Gauge, Clock, FolderOpen } from "lucide-react";
import { Card, Field, PageHeader, Select, Toggle } from "@/components/ui";
import { JobList } from "@/components/JobList";
import { api, pickFiles, pickFolder, type DownloadOptions } from "@/lib/api";
import { attempt, useApp } from "@/store/app";
import { useKv } from "@/hooks/useData";
import { formatDuration } from "@/lib/format";

export const PLATFORMS: { key: string; name: string; icon: string; color: string }[] = [
  { key: "youtu", name: "YouTube", icon: "▶️", color: "bg-red-500/20" },
  { key: "facebook.|fb.watch", name: "Facebook", icon: "📘", color: "bg-blue-500/20" },
  { key: "instagram.", name: "Instagram", icon: "📸", color: "bg-pink-500/20" },
  { key: "tiktok.", name: "TikTok", icon: "🎵", color: "bg-cyan-500/20" },
  { key: "twitter.|x.com", name: "X / Twitter", icon: "✖️", color: "bg-zinc-500/20" },
  { key: "reddit.", name: "Reddit", icon: "👽", color: "bg-orange-500/20" },
  { key: "pinterest.|pin.it", name: "Pinterest", icon: "📌", color: "bg-red-400/20" },
  { key: "vimeo.", name: "Vimeo", icon: "🎞️", color: "bg-sky-500/20" },
  { key: "dailymotion.", name: "Dailymotion", icon: "🎬", color: "bg-indigo-500/20" },
  { key: "twitch.", name: "Twitch", icon: "🟣", color: "bg-purple-500/20" },
  { key: "bilibili.", name: "Bilibili", icon: "📺", color: "bg-sky-400/20" },
  { key: "soundcloud.", name: "SoundCloud", icon: "☁️", color: "bg-orange-400/20" },
];

export function detectPlatform(url: string) {
  const u = url.toLowerCase();
  return PLATFORMS.find((p) => p.key.split("|").some((k) => u.includes(k))) ?? { key: "", name: "เว็บอื่น (yt-dlp)", icon: "🌐", color: "bg-fg/10" };
}

export function parseUrls(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).map((s) => s.trim()).filter((s) => /^https?:\/\//i.test(s)))];
}

const QUALITIES = [
  { value: "best", label: "ดีที่สุด" },
  { value: "4320", label: "8K (4320p)" },
  { value: "2160", label: "4K (2160p)" },
  { value: "1440", label: "2K (1440p)" },
  { value: "1080", label: "Full HD (1080p)" },
  { value: "720", label: "HD (720p)" },
  { value: "480", label: "480p" },
  { value: "360", label: "360p" },
  { value: "240", label: "240p" },
  { value: "144", label: "144p" },
];
const VIDEO_FORMATS = ["mp4", "mkv", "webm"] as const;
const AUDIO_FORMATS = ["mp3", "m4a", "wav", "flac", "opus"] as const;
export const BROWSERS = [
  { value: "", label: "ไม่ใช้คุกกี้" },
  { value: "chrome", label: "Google Chrome" },
  { value: "edge", label: "Microsoft Edge" },
  { value: "firefox", label: "Firefox" },
  { value: "brave", label: "Brave" },
  { value: "opera", label: "Opera" },
];

export const defaultDl: Omit<DownloadOptions, "urls"> = {
  mode: "video",
  quality: "best",
  format: "mp4",
  subtitles: false,
  subLangs: "th,en",
  thumbnail: false,
  metadata: true,
  playlist: false,
  liveFromStart: false,
  startAt: null,
  outputDir: "",
  template: "",
  extraArgs: [],
};

export default function Downloader() {
  const settings = useApp((s) => s.settings)!;
  const saveSettings = useApp((s) => s.saveSettings);
  const toast = useApp((s) => s.toast);
  const [text, setText] = useState("");
  const [saved, setSaved] = useKv("downloader.preset", defaultDl);
  const [opt, setOpt] = useState<Omit<DownloadOptions, "urls">>(defaultDl);
  const [loadedPreset, setLoadedPreset] = useState(false);
  const [info, setInfo] = useState<any>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [schedule, setSchedule] = useState("");
  const [busy, setBusy] = useState(false);
  const urls = useMemo(() => parseUrls(text), [text]);

  // โหลดค่าที่บันทึกไว้ครั้งแรก
  if (!loadedPreset && saved !== defaultDl) {
    setOpt({ ...defaultDl, ...saved, startAt: null });
    setLoadedPreset(true);
  }

  const set = <K extends keyof typeof opt>(k: K, v: (typeof opt)[K]) => setOpt((o) => ({ ...o, [k]: v }));

  const paste = async () => {
    try {
      const t = await navigator.clipboard.readText();
      setText((prev) => (prev ? prev + "\n" : "") + t);
    } catch {
      toast("อ่านคลิปบอร์ดไม่ได้ — กด Ctrl+V ในช่องแทน", "error");
    }
  };

  const preview = async () => {
    if (!urls[0]) return;
    setLoadingInfo(true);
    setInfo(null);
    const r = await attempt(() => api.fetchInfo(urls[0]));
    setLoadingInfo(false);
    if (r) setInfo(r);
  };

  const start = async () => {
    if (!urls.length) return toast("กรุณาวางลิงก์ก่อน", "error");
    setBusy(true);
    const startAt = schedule ? new Date(schedule).toISOString() : null;
    const jobs = await attempt(() => api.startDownload({ ...opt, urls, startAt }));
    setBusy(false);
    if (jobs) {
      toast(`เพิ่ม ${jobs.length} งานเข้าคิวแล้ว${startAt ? " (ตั้งเวลาไว้)" : ""}`, "success");
      setText("");
      setInfo(null);
    }
  };

  const formats = opt.mode === "audio" ? AUDIO_FORMATS : VIDEO_FORMATS;

  return (
    <div>
      <PageHeader title="โหลดคลิป" subtitle="YouTube · Facebook (รวมกลุ่ม) · Instagram · TikTok · X และอีกกว่า 1,000 เว็บ" icon={<Download />} />
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <Card>
            <div className="relative">
              <Link2 className="absolute left-3 top-3 text-muted" size={18} />
              <textarea
                className="input min-h-[110px] pl-10 font-mono text-[13px]"
                placeholder={"วางลิงก์ที่นี่ (บรรทัดละ 1 ลิงก์ วางได้หลายลิงก์)\nhttps://www.youtube.com/watch?v=...\nhttps://www.facebook.com/groups/.../posts/..."}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && e.ctrlKey && start()}
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {urls.map((u) => {
                const p = detectPlatform(u);
                return (
                  <span key={u} className={`chip ${p.color}`} title={u}>
                    {p.icon} {p.name}
                  </span>
                );
              })}
              {!urls.length && <span className="text-xs text-muted">ระบบจะตรวจจับแพลตฟอร์มให้อัตโนมัติ</span>}
              <div className="ml-auto flex gap-2">
                <button className="btn btn-sm" onClick={paste}>
                  <Clipboard size={13} /> วางจากคลิปบอร์ด
                </button>
                <button className="btn btn-sm" onClick={preview} disabled={!urls.length || loadingInfo}>
                  <Search size={13} /> {loadingInfo ? "กำลังดึงข้อมูล..." : "ดูข้อมูลคลิป"}
                </button>
              </div>
            </div>
            {info && (
              <div className="mt-3 flex gap-3 rounded-xl bg-fg/5 p-3">
                {info.thumbnail && <img src={info.thumbnail} className="h-24 w-40 shrink-0 rounded-lg object-cover" alt="" referrerPolicy="no-referrer" />}
                <div className="min-w-0 text-sm">
                  <div className="font-medium selectable">{info.title}</div>
                  <div className="text-xs text-muted">
                    {info.platform} · {info.uploader ?? "-"} {info.duration ? `· ${formatDuration(info.duration)}` : ""} {info.entries ? `· เพลย์ลิสต์ ${info.entries} คลิป` : ""} {info.isLive ? "· 🔴 ไลฟ์" : ""}
                  </div>
                  {info.heights?.length > 0 && <div className="mt-1 text-xs">ความละเอียดที่มี: {info.heights.slice(-6).join("p, ")}p</div>}
                  {info.subtitles?.length > 0 && <div className="text-xs">ซับที่มี: {info.subtitles.slice(0, 12).join(", ")}</div>}
                  {info.entries > 0 && !opt.playlist && (
                    <button className="btn btn-sm mt-2" onClick={() => set("playlist", true)}>
                      โหลดทั้งเพลย์ลิสต์
                    </button>
                  )}
                </div>
              </div>
            )}
          </Card>

          <Card title="คิวการโหลด">
            <JobList kinds={["download"]} empty="ยังไม่มีงานโหลด — วางลิงก์ด้านบนแล้วกด 'เริ่มโหลด'" />
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="ตัวเลือก">
            <div className="mb-3 grid grid-cols-4 gap-1 rounded-xl bg-fg/5 p-1">
              {(
                [
                  ["video", "วิดีโอ+เสียง"],
                  ["audio", "เสียง"],
                  ["subs", "ซับ"],
                  ["thumbnail", "ภาพปก"],
                ] as const
              ).map(([k, l]) => (
                <button
                  key={k}
                  className={opt.mode === k ? "tab-active text-xs" : "tab text-xs"}
                  onClick={() => setOpt((o) => ({ ...o, mode: k, format: k === "audio" ? "mp3" : k === "video" ? "mp4" : o.format }))}
                >
                  {l}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {opt.mode === "video" && (
                <Field label="คุณภาพ">
                  <Select value={opt.quality} onChange={(v) => set("quality", v)} options={QUALITIES} />
                </Field>
              )}
              {(opt.mode === "video" || opt.mode === "audio") && (
                <Field label="รูปแบบไฟล์">
                  <Select value={opt.format} onChange={(v) => set("format", v)} options={formats} />
                </Field>
              )}
              {(opt.mode === "subs" || opt.subtitles) && (
                <Field label="ภาษาซับ" hint="เช่น th,en หรือ all">
                  <input className="input" value={opt.subLangs} onChange={(e) => set("subLangs", e.target.value)} />
                </Field>
              )}
            </div>
            <div className="mt-2 divide-y divide-fg/5">
              {opt.mode === "video" && <Toggle label="ฝังซับไตเติ้ล" checked={opt.subtitles} onChange={(v) => set("subtitles", v)} />}
              {(opt.mode === "video" || opt.mode === "audio") && <Toggle label="ฝังรูปปก" checked={opt.thumbnail} onChange={(v) => set("thumbnail", v)} />}
              <Toggle label="บันทึกข้อมูลคลิป (metadata)" checked={opt.metadata} onChange={(v) => set("metadata", v)} />
              <Toggle label="โหลดทั้งเพลย์ลิสต์ / ช่อง / โปรไฟล์" checked={opt.playlist} onChange={(v) => set("playlist", v)} />
              <Toggle label="ไลฟ์: โหลดตั้งแต่ต้น" checked={opt.liveFromStart} onChange={(v) => set("liveFromStart", v)} />
            </div>
            <Field label="โฟลเดอร์ปลายทาง" className="mt-2">
              <div className="flex gap-2">
                <input className="input" placeholder={settings.downloadDir} value={opt.outputDir} onChange={(e) => set("outputDir", e.target.value)} />
                <button className="btn" onClick={async () => { const d = await pickFolder(); if (d) set("outputDir", d); }} title="เลือกโฟลเดอร์">
                  <FolderOpen size={14} />
                </button>
              </div>
            </Field>
            <Field label="ตั้งชื่อไฟล์ (template ของ yt-dlp)" hint="ว่าง = ชื่อคลิป [id] · เช่น %(uploader)s - %(title)s.%(ext)s" className="mt-2">
              <input className="input font-mono text-xs" value={opt.template} onChange={(e) => set("template", e.target.value)} />
            </Field>
            <Field label="ตั้งเวลาเริ่มโหลด (ว่าง = เริ่มทันที)" className="mt-2">
              <div className="flex items-center gap-2">
                <Clock size={16} className="text-muted" />
                <input type="datetime-local" className="input" value={schedule} onChange={(e) => setSchedule(e.target.value)} />
              </div>
            </Field>
            <div className="mt-4 flex gap-2">
              <button className="btn-primary flex-1 py-2.5" onClick={start} disabled={busy || !urls.length}>
                <Download size={16} /> เริ่มโหลด {urls.length > 1 ? `(${urls.length})` : ""}
              </button>
              <button className="btn" title="บันทึกค่าที่ตั้งไว้ใช้ครั้งหน้า" onClick={() => { setSaved(opt); toast("บันทึกค่าตั้งแล้ว", "success"); }}>
                <Save size={15} />
              </button>
            </div>
          </Card>

          <Card title="การเชื่อมต่อ">
            <Field label="คุกกี้ (สำหรับ FB กลุ่ม / IG / คลิปส่วนตัว)" hint="ต้องล็อกอินเว็บนั้นในเบราว์เซอร์ที่เลือกไว้ก่อน · Chrome/Edge อาจต้องปิดเบราว์เซอร์ก่อนโหลด">
              <div className="flex gap-2">
                <Cookie size={16} className="mt-2.5 text-muted" />
                <Select value={settings.cookiesBrowser} onChange={(v) => saveSettings({ cookiesBrowser: v, cookiesFile: "" })} options={BROWSERS} />
              </div>
            </Field>
            <div className="mt-2 flex items-center gap-2">
              <input className="input text-xs" placeholder="หรือเลือกไฟล์ cookies.txt" value={settings.cookiesFile} readOnly />
              <button className="btn btn-sm" onClick={async () => { const f = await pickFiles({ multiple: false, filters: [{ name: "cookies", extensions: ["txt"] }] }); if (f[0]) saveSettings({ cookiesFile: f[0] }); }}>
                เลือก
              </button>
              {settings.cookiesFile && (
                <button className="btn btn-sm" onClick={() => saveSettings({ cookiesFile: "" })}>
                  ล้าง
                </button>
              )}
            </div>
            <Field label="Proxy" className="mt-3">
              <div className="flex gap-2">
                <Globe size={16} className="mt-2.5 text-muted" />
                <input className="input" placeholder="http://127.0.0.1:8080 หรือ socks5://..." defaultValue={settings.proxy} onBlur={(e) => saveSettings({ proxy: e.target.value })} />
              </div>
            </Field>
            <Field label="จำกัดความเร็ว" hint="เช่น 500K, 2M — ว่าง = ไม่จำกัด" className="mt-3">
              <div className="flex gap-2">
                <Gauge size={16} className="mt-2.5 text-muted" />
                <input className="input" placeholder="ไม่จำกัด" defaultValue={settings.rateLimit} onBlur={(e) => saveSettings({ rateLimit: e.target.value })} />
              </div>
            </Field>
          </Card>
        </div>
      </div>
    </div>
  );
}
