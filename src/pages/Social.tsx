// หน้า 14: โซเชียล
import { useMemo, useState } from "react";
import { Share2, Download, Image as ImageIcon, Hash, Copy, CalendarClock, Plus, Trash2, Check, Search } from "lucide-react";
import { Card, Empty, Field, PageHeader, Select, Tabs } from "@/components/ui";
import { JobList } from "@/components/JobList";
import { api, call, openUrl } from "@/lib/api";
import { attempt, useApp } from "@/store/app";
import { useKv } from "@/hooks/useData";
import { formatDate, joinPath, safeName } from "@/lib/format";
import { defaultDl, detectPlatform, parseUrls } from "./Downloader";

type Tab = "quick" | "images" | "caption" | "schedule";

export default function Social() {
  const [tab, setTab] = useState<Tab>("quick");
  return (
    <div>
      <PageHeader title="โซเชียล" subtitle="โหลด Reels/TikTok ไม่ติดลายน้ำ · รูปโปรไฟล์ · สตอรี่ · แคปชัน · แฮชแท็ก · ตารางโพสต์" icon={<Share2 />} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "quick", label: "⚡ โหลดด่วน" }, { id: "images", label: "🖼️ รูปโปรไฟล์ / ภาพปก" }, { id: "caption", label: "#️⃣ แคปชัน & แฮชแท็ก" }, { id: "schedule", label: "🗓️ ตารางโพสต์" }]} />
      {tab === "quick" && <Quick />}
      {tab === "images" && <Images />}
      {tab === "caption" && <Caption />}
      {tab === "schedule" && <Schedule />}
    </div>
  );
}

const QUICK_KINDS = [
  { id: "reel", label: "Reels / TikTok (ไม่ติดลายน้ำ)", icon: "🎬", mode: "video" as const },
  { id: "story", label: "สตอรี่ (IG / FB)", icon: "⭕", mode: "video" as const, playlist: true },
  { id: "audio", label: "เอาเฉพาะเสียง (MP3)", icon: "🎵", mode: "audio" as const },
  { id: "profile", label: "ทั้งโปรไฟล์ / ทั้งช่อง", icon: "👤", mode: "video" as const, playlist: true },
];

function Quick() {
  const settings = useApp((s) => s.settings);
  const [text, setText] = useState("");
  const [kind, setKind] = useState("reel");
  const urls = parseUrls(text);
  const k = QUICK_KINDS.find((x) => x.id === kind)!;
  const go = async () => {
    const extra: string[] = [];
    // TikTok: ไม่เลือกไฟล์ที่ติดลายน้ำ
    if (urls.some((u) => /tiktok\.com/.test(u)) && k.mode === "video") extra.push("-f", "b[format_note!*=watermark][format_id!=download]/bv*+ba/b");
    const r = await attempt(() =>
      api.startDownload({ ...defaultDl, urls, mode: k.mode, format: k.mode === "audio" ? "mp3" : "mp4", playlist: !!k.playlist, outputDir: joinPath(settings?.downloadDir ?? "", "โซเชียล"), extraArgs: extra }),
    );
    if (r) {
      useApp.getState().toast(`เพิ่ม ${r.length} งานเข้าคิวแล้ว`, "success");
      setText("");
    }
  };
  const needCookie = urls.some((u) => /instagram|facebook/.test(u)) && !settings?.cookiesBrowser && !settings?.cookiesFile;
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
      <Card title="วางลิงก์ (หลายลิงก์ได้)">
        <textarea className="input h-32" placeholder="https://www.tiktok.com/@user/video/...\nhttps://www.instagram.com/reel/..." value={text} onChange={(e) => setText(e.target.value)} />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {urls.map((u) => { const p = detectPlatform(u); return <span key={u} className="chip">{p.icon} {p.name}</span>; })}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {QUICK_KINDS.map((x) => (
            <button key={x.id} onClick={() => setKind(x.id)} className={`rounded-xl border p-3 text-left text-sm transition ${kind === x.id ? "border-accent bg-accent/20" : "border-fg/10 hover:bg-fg/5"}`}>
              <div className="text-xl">{x.icon}</div>{x.label}
            </button>
          ))}
        </div>
        {needCookie && <p className="mt-2 text-xs text-amber-300">⚠️ Instagram/Facebook (สตอรี่ กลุ่ม บัญชีส่วนตัว) ต้องตั้งค่าคุกกี้ในหน้า "ตั้งค่า" ก่อน</p>}
        <button className="btn-primary mt-3 w-full" disabled={!urls.length} onClick={go}><Download size={15} /> โหลด {urls.length || ""} ลิงก์</button>
      </Card>
      <Card title="งานโหลด"><JobList kinds={["download"]} /></Card>
    </div>
  );
}

function Images() {
  const settings = useApp((s) => s.settings);
  const [url, setUrl] = useState("");
  const [info, setInfo] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    setInfo(await attempt(() => api.fetchInfo(url.trim())) ?? null);
    setBusy(false);
  };
  const thumbs: { id: string; url: string; width?: number }[] = useMemo(() => {
    const list = (info?.thumbnails ?? []) as { id: string; url: string; width?: number }[];
    const seen = new Set<string>();
    return [...list].reverse().filter((t) => t.url && !seen.has(t.url) && seen.add(t.url)).slice(0, 12);
  }, [info]);
  const avatar = thumbs.find((t) => /avatar/i.test(String(t.id)));
  const save = async (u: string, label: string) => {
    const ext = u.match(/\.(jpe?g|png|webp)(\?|$)/i)?.[1] ?? "jpg";
    const out = joinPath(settings?.downloadDir ?? "", "โซเชียล", "รูป", `${safeName(info?.uploader || info?.title || "ภาพ")}-${label}.${ext}`);
    // ใช้ ffmpeg โหลดรูปจาก URL (รองรับ https) แล้วบันทึกเป็นไฟล์
    await attempt(() => api.ffmpegExec(["-y", "-i", u, "-frames:v", "1", "-update", "1", out]), `บันทึก ${label} แล้ว`);
  };
  return (
    <Card title="โหลดรูปโปรไฟล์ (HD) / ภาพปกคลิป">
      <div className="flex gap-2">
        <input className="input flex-1" placeholder="ลิงก์คลิป หรือ ลิงก์ช่อง/โปรไฟล์" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} />
        <button className="btn-primary" disabled={!url.trim() || busy} onClick={load}><Search size={15} /> {busy ? "กำลังดึง…" : "ดึงข้อมูล"}</button>
      </div>
      {!info && <Empty icon={<ImageIcon />} text="รองรับ YouTube (ภาพปก + รูปช่อง), TikTok, Instagram, Facebook และเว็บอื่นที่ yt-dlp รู้จัก" />}
      {info && (
        <div className="mt-4">
          <div className="mb-3 font-medium">{info.title} <span className="text-muted">— {info.uploader}</span></div>
          {avatar && (
            <div className="mb-4 flex items-center gap-3">
              <img src={avatar.url} className="h-24 w-24 rounded-full object-cover" alt="" referrerPolicy="no-referrer" />
              <button className="btn-primary" onClick={() => save(avatar.url, "โปรไฟล์")}><Download size={14} /> บันทึกรูปโปรไฟล์</button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {(thumbs.length ? thumbs : info.thumbnail ? [{ id: "main", url: String(info.thumbnail), width: undefined as number | undefined }] : []).map((t, i) => (
              <div key={t.url} className="overflow-hidden rounded-xl bg-fg/5">
                <img src={t.url} className="aspect-video w-full object-cover" alt="" loading="lazy" referrerPolicy="no-referrer" />
                <div className="flex items-center justify-between p-2 text-xs">
                  <span className="text-muted">{t.width ? `${t.width}px` : t.id}</span>
                  <div className="flex gap-1">
                    <button className="btn btn-sm" onClick={() => openUrl(t.url)}>เปิด</button>
                    <button className="btn btn-sm" onClick={() => save(t.url, `ภาพ${i + 1}`)}><Download size={12} /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

export function extractHashtags(text: string): [string, number][] {
  const m = text.match(/#[\p{L}\p{M}\p{N}_]+/gu) ?? [];
  const c = new Map<string, number>();
  for (const t of m) c.set(t.toLowerCase(), (c.get(t.toLowerCase()) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1]);
}

function Caption() {
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const tags = extractHashtags(text);
  const mentions = [...new Set(text.match(/@[\w.]+/g) ?? [])];
  const copy = (t: string) => { navigator.clipboard.writeText(t); useApp.getState().toast("คัดลอกแล้ว"); };
  const fetchCaption = async () => {
    setBusy(true);
    const r = await attempt(() => api.fetchInfo(url.trim()));
    setBusy(false);
    if (r) setText([r.description ?? r.title ?? "", ...(r.tags ?? []).map((t: string) => `#${t.replace(/\s+/g, "")}`)].join("\n"));
  };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="ดึงแคปชันจากโพสต์">
        <div className="flex gap-2">
          <input className="input flex-1" placeholder="ลิงก์โพสต์/คลิป" value={url} onChange={(e) => setUrl(e.target.value)} />
          <button className="btn-primary" disabled={!url.trim() || busy} onClick={fetchCaption}>{busy ? "กำลังดึง…" : "ดึงแคปชัน"}</button>
        </div>
        <textarea className="input mt-3 h-64" placeholder="หรือวางแคปชันที่นี่" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="mt-2 flex items-center justify-between text-xs text-muted">
          <span>{[...text].length} ตัวอักษร · {tags.length} แฮชแท็ก · {mentions.length} การแท็ก</span>
          <button className="btn btn-sm" onClick={() => copy(text)}><Copy size={12} /> คัดลอก</button>
        </div>
      </Card>
      <Card title={<span className="flex items-center gap-2"><Hash size={16} /> นับแฮชแท็ก</span>}>
        {tags.length === 0 ? <Empty text="ยังไม่พบแฮชแท็ก" /> : (
          <>
            <div className="max-h-72 space-y-1 overflow-auto">
              {tags.map(([t, n]) => (
                <div key={t} className="flex items-center gap-2 text-sm">
                  <span className="flex-1 text-accent2">{t}</span>
                  <div className="h-2 rounded bg-accent/60" style={{ width: `${(n / tags[0][1]) * 120}px` }} />
                  <span className="w-6 text-right font-mono">{n}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <button className="btn btn-sm" onClick={() => copy(tags.map((t) => t[0]).join(" "))}>คัดลอกแฮชแท็กทั้งหมด</button>
              <button className="btn btn-sm" onClick={() => setText(text.replace(/#[\p{L}\p{M}\p{N}_]+/gu, "").replace(/[ \t]+\n/g, "\n").trim())}>ลบแฮชแท็กออก</button>
            </div>
            {tags.length > 30 && <p className="mt-2 text-xs text-amber-300">Instagram อนุญาตแฮชแท็กสูงสุด 30 อันต่อโพสต์</p>}
          </>
        )}
        {mentions.length > 0 && <div className="mt-4"><div className="label">การแท็ก</div><div className="flex flex-wrap gap-1">{mentions.map((m) => <span key={m} className="chip">{m}</span>)}</div></div>}
      </Card>
    </div>
  );
}

interface Post {
  id: string;
  platform: string;
  at: string;
  caption: string;
  file: string;
  done: boolean;
}

function Schedule() {
  const [posts, setPosts] = useKv<Post[]>("social.posts", []);
  const [draft, setDraft] = useState<Omit<Post, "id" | "done">>({ platform: "Facebook", at: "", caption: "", file: "" });
  const add = () => {
    setPosts([...posts, { ...draft, id: crypto.randomUUID(), done: false }].sort((a, b) => a.at.localeCompare(b.at)));
    setDraft({ ...draft, caption: "", file: "" });
  };
  const remindAll = () => {
    // แจ้งเตือนเมื่อถึงเวลา (ขณะโปรแกรมเปิดอยู่) — ไม่โพสต์ให้อัตโนมัติ
    posts.filter((p) => !p.done && new Date(p.at).getTime() > Date.now()).forEach((p) => {
      const ms = new Date(p.at).getTime() - Date.now();
      if (ms < 2 ** 31 - 1) setTimeout(() => call("notify", { title: `ถึงเวลาโพสต์ ${p.platform}`, body: p.caption.slice(0, 80) }).catch(() => {}), ms);
    });
    useApp.getState().toast("ตั้งการแจ้งเตือนแล้ว (โปรแกรมต้องเปิดอยู่)", "success");
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      <Card title="เพิ่มโพสต์ในตาราง">
        <div className="space-y-2">
          <Field label="แพลตฟอร์ม"><Select value={draft.platform} onChange={(v) => setDraft({ ...draft, platform: v })} options={["Facebook", "Instagram", "TikTok", "YouTube", "X (Twitter)", "LINE VOOM"]} /></Field>
          <Field label="วันเวลา"><input type="datetime-local" className="input" value={draft.at} onChange={(e) => setDraft({ ...draft, at: e.target.value })} /></Field>
          <Field label="แคปชัน"><textarea className="input h-24" value={draft.caption} onChange={(e) => setDraft({ ...draft, caption: e.target.value })} /></Field>
          <Field label="ไฟล์ที่จะโพสต์ (พาธ)"><input className="input text-xs" value={draft.file} onChange={(e) => setDraft({ ...draft, file: e.target.value })} /></Field>
          <button className="btn-primary w-full" disabled={!draft.at} onClick={add}><Plus size={14} /> เพิ่ม</button>
          <p className="text-xs text-muted">โปรแกรมจะไม่โพสต์ให้อัตโนมัติ — เป็นสมุดจดตารางและแจ้งเตือนเท่านั้น</p>
        </div>
      </Card>
      <Card title={<span className="flex items-center gap-2"><CalendarClock size={16} /> ตารางโพสต์</span>} actions={<button className="btn btn-sm" onClick={remindAll}>🔔 เปิดแจ้งเตือน</button>}>
        {posts.length === 0 && <Empty text="ยังไม่มีโพสต์ในตาราง" />}
        <div className="space-y-2">
          {posts.map((p) => (
            <div key={p.id} className={`flex items-start gap-3 rounded-xl bg-fg/5 p-3 ${p.done ? "opacity-50" : ""}`}>
              <button className={`mt-0.5 grid h-5 w-5 place-items-center rounded border ${p.done ? "border-lime-400 bg-lime-400/30" : "border-fg/30"}`} onClick={() => setPosts(posts.map((x) => (x.id === p.id ? { ...x, done: !x.done } : x)))}>{p.done && <Check size={12} />}</button>
              <div className="min-w-0 flex-1">
                <div className="text-sm"><b>{p.platform}</b> · {formatDate(p.at)}</div>
                <div className="selectable whitespace-pre-wrap text-sm text-muted">{p.caption}</div>
                {p.file && <div className="truncate text-xs text-accent2">📎 {p.file}</div>}
              </div>
              <button className="btn btn-sm" onClick={() => { navigator.clipboard.writeText(p.caption); useApp.getState().toast("คัดลอกแคปชันแล้ว"); }}><Copy size={12} /></button>
              <button className="btn btn-sm" onClick={() => setPosts(posts.filter((x) => x.id !== p.id))}><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
