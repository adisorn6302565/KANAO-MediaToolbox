// หน้า 19: ปรับแต่ง (widget / โปรไฟล์ / เสียง / คีย์ลัด / ภาษา / ธีมเอง)
import { useEffect, useState } from "react";
import { Palette, GripVertical, Download, Upload, RotateCcw, Volume2 } from "lucide-react";
import { Card, Field, PageHeader, Select, Toggle, Kbd, useReorder, moveItem } from "@/components/ui";
import { fileUrl, call, pickFiles } from "@/lib/api";
import { useApp } from "@/store/app";
import { DEFAULT_SHORTCUTS, comboOf, type Lang } from "@/lib/nav";
import { SOUNDS, playSound } from "@/lib/sound";
import { CUSTOM_KEYS, applyTheme } from "@/lib/theme";
import { downloadText } from "@/lib/format";
import { SHORTCUT_LABELS } from "@/components/Layout";

export const WIDGETS: Record<string, string> = {
  stats: "📊 การ์ดสถิติ",
  quick: "⚡ ปุ่มทางลัด",
  activity: "📰 กิจกรรมล่าสุด",
  system: "💻 กราฟระบบ",
  recent: "🗂️ ไฟล์ล่าสุด",
  storage: "💾 พื้นที่จัดเก็บ",
};
const ALL_WIDGETS = Object.keys(WIDGETS);
const AVATARS = ["😎", "🦊", "🐱", "🐼", "🦄", "🐙", "🤖", "👾", "🧑‍💻", "🎧"];

export default function Personalize() {
  return (
    <div>
      <PageHeader title="ปรับแต่ง" subtitle="ทำให้โปรแกรมเป็นของคุณ" icon={<Palette />} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Profile />
        <Widgets />
        <ThemeBuilder />
        <div className="space-y-4">
          <LanguageSound />
          <Shortcuts />
        </div>
      </div>
    </div>
  );
}

/** ย่อรูปเป็น data URL ขนาดเล็กสำหรับรูปโปรไฟล์ */
async function toAvatar(src: string): Promise<string> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = src;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const s = Math.min(img.width, img.height);
  c.getContext("2d")!.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 128, 128);
  return c.toDataURL("image/webp", 0.85);
}
function emojiAvatar(e: string) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 128, 128);
  g.addColorStop(0, "#7c3aed");
  g.addColorStop(1, "#06b6d4");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  ctx.font = '80px "Segoe UI Emoji"';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(e, 64, 70);
  return c.toDataURL("image/png");
}

function Profile() {
  const settings = useApp((s) => s.settings)!;
  const save = useApp((s) => s.saveSettings);
  const [name, setName] = useState(settings.displayName);
  const pick = async () => {
    const [f] = await pickFiles({ multiple: false, filters: [{ name: "รูปภาพ", extensions: ["jpg", "jpeg", "png", "webp", "gif", "bmp"] }] });
    if (f) save({ avatar: await toAvatar(fileUrl(f)).catch(() => "") });
  };
  return (
    <Card title="โปรไฟล์">
      <div className="flex items-center gap-4">
        <button onClick={pick} className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-accent to-accent2 text-4xl" title="เปลี่ยนรูป">
          {settings.avatar ? <img src={settings.avatar} className="h-full w-full object-cover" alt="" /> : "😎"}
        </button>
        <div className="flex-1 space-y-2">
          <Field label="ชื่อที่แสดง">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== settings.displayName && save({ displayName: name })} />
          </Field>
          <div className="flex flex-wrap gap-1">
            {AVATARS.map((a) => <button key={a} className="rounded-lg p-1 text-xl hover:bg-fg/10" onClick={() => save({ avatar: emojiAvatar(a) })}>{a}</button>)}
            {settings.avatar && <button className="btn btn-sm" onClick={() => save({ avatar: "" })}>ลบรูป</button>}
          </div>
        </div>
      </div>
    </Card>
  );
}

function Widgets() {
  const settings = useApp((s) => s.settings)!;
  const save = useApp((s) => s.saveSettings);
  const active = settings.widgets.length ? settings.widgets : ALL_WIDGETS;
  const order = [...active, ...ALL_WIDGETS.filter((w) => !active.includes(w))];
  const [list, setList] = useState(order);
  useEffect(() => setList(order), [settings.widgets.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = (l: string[], on: string[]) => save({ widgets: l.filter((w) => on.includes(w)) });
  const reorder = useReorder((from, to) => setList((l) => moveItem(l, from, to)));
  return (
    <Card title="Widget ในหน้าแรก" actions={<button className="btn btn-sm" onClick={() => save({ widgets: [] })}><RotateCcw size={12} /> ค่าเริ่มต้น</button>}>
      <p className="mb-2 text-xs text-muted">ลากเพื่อจัดลำดับ · เปิด/ปิดเพื่อเลือกที่จะแสดง</p>
      <div className="space-y-1.5" onPointerUp={() => commit(list, active)}>
        {list.map((w, i) => (
          <div key={w} {...reorder(i)} className="flex items-center gap-2 rounded-lg bg-fg/5 px-3 py-2">
            <GripVertical size={14} className="text-muted" />
            <span className="flex-1">{WIDGETS[w]}</span>
            <Toggle label="" checked={active.includes(w)} onChange={(v) => commit(list, v ? [...active, w] : active.filter((x) => x !== w))} />
          </div>
        ))}
      </div>
    </Card>
  );
}

const THEME_PRESETS: Record<string, Record<string, string>> = {
  "มิดไนท์": { bg: "#0b0b1a", bg2: "#131334", fg: "#e8e8ff", muted: "#8e8eb8", accent: "#8b5cf6", accent2: "#06b6d4" },
  "มัทฉะ": { bg: "#0f1a14", bg2: "#1a2e22", fg: "#e7f5ea", muted: "#8fb39a", accent: "#84cc16", accent2: "#10b981" },
  "ซากุระ": { bg: "#1a0f16", bg2: "#2e1a28", fg: "#ffeef8", muted: "#c79bb5", accent: "#f472b6", accent2: "#fb7185" },
  "ทองคำ": { bg: "#14110a", bg2: "#2a2210", fg: "#fff8e6", muted: "#bfae84", accent: "#f59e0b", accent2: "#eab308" },
};
function ThemeBuilder() {
  const settings = useApp((s) => s.settings)!;
  const save = useApp((s) => s.saveSettings);
  const base = { ...THEME_PRESETS["มิดไนท์"], ...(settings.customTheme ?? {}) };
  const [t, setT] = useState<Record<string, string>>(base);
  // แสดงตัวอย่างทันที
  useEffect(() => {
    applyTheme({ theme: "custom", accent: settings.accent, customTheme: t, fullEffects: settings.fullEffects });
    return () => applyTheme(useApp.getState().settings!);
  }, [t]); // eslint-disable-line react-hooks/exhaustive-deps
  const importTheme = async () => {
    const [f] = await pickFiles({ multiple: false, filters: [{ name: "ธีม", extensions: ["json"] }] });
    if (!f) return;
    try {
      const j = JSON.parse(await call<string>("read_text_file", { path: f }));
      const next = Object.fromEntries(CUSTOM_KEYS.map((k) => [k.key, String(j[k.key] ?? t[k.key])]));
      setT(next);
    } catch {
      useApp.getState().toast("ไฟล์ธีมไม่ถูกต้อง", "error");
    }
  };
  return (
    <Card title="สร้างธีมเอง">
      <div className="mb-3 flex flex-wrap gap-1.5">
        {Object.entries(THEME_PRESETS).map(([n, p]) => (
          <button key={n} className="chip gap-1" onClick={() => setT(p)}><span className="h-3 w-3 rounded-full" style={{ background: `linear-gradient(135deg, ${p.accent}, ${p.accent2})` }} />{n}</button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {CUSTOM_KEYS.map((k) => (
          <label key={k.key} className="flex items-center gap-2 rounded-lg bg-fg/5 p-2 text-sm">
            <input type="color" value={t[k.key]} onChange={(e) => setT({ ...t, [k.key]: e.target.value })} />
            {k.label}
          </label>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="btn-primary" onClick={() => save({ theme: "custom", customTheme: t })}>ใช้ธีมนี้</button>
        <button className="btn" onClick={() => downloadText("ธีม-มีเดียทูลบ็อกซ์.json", JSON.stringify(t, null, 2), "application/json")}><Download size={14} /> ส่งออก</button>
        <button className="btn" onClick={importTheme}><Upload size={14} /> นำเข้า</button>
      </div>
      <p className="mt-2 text-xs text-muted">กำลังแสดงตัวอย่าง — ออกจากหน้านี้โดยไม่กด "ใช้ธีมนี้" จะกลับเป็นธีมเดิม</p>
    </Card>
  );
}

function LanguageSound() {
  const settings = useApp((s) => s.settings)!;
  const save = useApp((s) => s.saveSettings);
  return (
    <Card title="ภาษา & เสียง">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="ภาษาเมนู" hint="เนื้อหาภายในหน้ายังเป็นภาษาไทย">
          <Select value={settings.language as Lang} onChange={(v) => save({ language: v })} options={[{ value: "th", label: "🇹🇭 ไทย" }, { value: "en", label: "🇬🇧 English" }, { value: "zh", label: "🇨🇳 中文" }, { value: "ja", label: "🇯🇵 日本語" }]} />
        </Field>
        <Field label="เสียงแจ้งเตือน">
          <div className="flex gap-2">
            <Select value={settings.notifySound} onChange={(v) => { save({ notifySound: v }); playSound(v); }} options={Object.entries(SOUNDS).map(([value, label]) => ({ value, label }))} />
            <button className="btn" onClick={() => playSound(settings.notifySound)}><Volume2 size={14} /></button>
          </div>
        </Field>
      </div>
      <div className="mt-2"><Toggle label="เปิดเสียงเมื่องานเสร็จ" checked={settings.sound} onChange={(v) => save({ sound: v })} /></div>
    </Card>
  );
}

function Shortcuts() {
  const settings = useApp((s) => s.settings)!;
  const save = useApp((s) => s.saveSettings);
  const [rec, setRec] = useState<string | null>(null);
  const map = { ...DEFAULT_SHORTCUTS, ...(settings.shortcuts ?? {}) };
  useEffect(() => {
    if (!rec) return;
    const h = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return setRec(null);
      if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return;
      const combo = comboOf(e);
      const clash = Object.entries(map).find(([k, v]) => v === combo && k !== rec);
      if (clash) useApp.getState().toast(`${combo} ถูกใช้กับ "${SHORTCUT_LABELS[clash[0]] ?? clash[0]}" แล้ว`, "error");
      else save({ shortcuts: { ...settings.shortcuts, [rec]: combo } });
      setRec(null);
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [rec]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Card title="คีย์ลัด" actions={<button className="btn btn-sm" onClick={() => save({ shortcuts: {} })}><RotateCcw size={12} /> ค่าเริ่มต้น</button>}>
      <div className="max-h-80 overflow-auto">
        {Object.entries(map).map(([k, v]) => (
          <div key={k} className="flex items-center justify-between border-b border-fg/5 py-1.5 text-sm">
            <span>{SHORTCUT_LABELS[k] ?? k}</span>
            <button onClick={() => setRec(k)} className={rec === k ? "animate-pulse" : ""}>{rec === k ? <span className="chip bg-accent/40">กดปุ่มที่ต้องการ… (Esc ยกเลิก)</span> : <Kbd>{v}</Kbd>}</button>
          </div>
        ))}
      </div>
    </Card>
  );
}
