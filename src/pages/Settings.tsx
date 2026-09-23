// หน้า 21: ตั้งค่า
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Settings as SettingsIcon, FolderOpen, RotateCcw, Check } from "lucide-react";
import { Card, Field, PageHeader, Select, Slider, Toggle, Kbd } from "@/components/ui";
import { call, confirmDialog, pickFiles, pickFolder, type Settings } from "@/lib/api";
import { attempt, useApp } from "@/store/app";
import { ACCENTS, THEMES } from "@/lib/theme";
import { DEFAULT_SHORTCUTS } from "@/lib/nav";
import { formatDate } from "@/lib/format";
import { BROWSERS } from "./Downloader";

interface ToolInfo {
  name: string;
  version?: string;
  path?: string;
}

export default function SettingsPage() {
  const nav = useNavigate();
  const settings = useApp((s) => s.settings)!;
  const set = useApp((s) => s.saveSettings);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  useEffect(() => {
    call<ToolInfo[]>("tool_status").then(setTools).catch(() => {});
  }, [settings.ffmpegPath, settings.ytdlpPath]);
  const pickExe = async (key: "ffmpegPath" | "ytdlpPath") => {
    const [f] = await pickFiles({ multiple: false, filters: [{ name: "โปรแกรม", extensions: ["exe"] }] });
    if (f) set({ [key]: f });
  };
  const reset = async () => {
    if (!(await confirmDialog("รีเซ็ตการตั้งค่าทั้งหมดเป็นค่าเริ่มต้น? (PIN จะถูกยกเลิกด้วย)"))) return;
    const s = await attempt(() => call<Settings>("reset_settings"), "รีเซ็ตการตั้งค่าแล้ว");
    if (s) useApp.setState({ settings: s });
  };
  const tool = (n: string) => tools.find((t) => t.name === n);
  const shortcutCount = Object.keys({ ...DEFAULT_SHORTCUTS, ...settings.shortcuts }).length;
  return (
    <div>
      <PageHeader title="ตั้งค่า" subtitle="ค่าต่าง ๆ บันทึกอัตโนมัติทันทีที่เปลี่ยน" icon={<SettingsIcon />} actions={<button className="btn-danger" onClick={reset}><RotateCcw size={15} /> รีเซ็ตทั้งหมด</button>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="📁 ไฟล์และการโหลด">
          <div className="space-y-3">
            <Field label="โฟลเดอร์ปลายทาง">
              <div className="flex gap-2">
                <input className="input text-xs" readOnly value={settings.downloadDir} />
                <button className="btn" onClick={async () => { const d = await pickFolder(); if (d) set({ downloadDir: d }); }}><FolderOpen size={14} /> เลือก</button>
              </div>
            </Field>
            <Slider label="จำนวนงานพร้อมกัน" value={settings.concurrentJobs} min={1} max={8} suffix=" งาน" onChange={(v) => set({ concurrentJobs: v })} />
            <Field label="จำกัดความเร็วโหลด" hint="เช่น 500K หรือ 2M · เว้นว่าง = ไม่จำกัด">
              <input className="input" defaultValue={settings.rateLimit} onBlur={(e) => e.target.value.trim() !== settings.rateLimit && set({ rateLimit: e.target.value.trim() })} />
            </Field>
            <Field label="Proxy" hint="http://host:port หรือ socks5://host:port · เว้นว่าง = ไม่ใช้">
              <input className="input" defaultValue={settings.proxy} onBlur={(e) => e.target.value.trim() !== settings.proxy && set({ proxy: e.target.value.trim() })} />
            </Field>
          </div>
        </Card>

        <Card title="🍪 คุกกี้ (Facebook / Instagram / คลิปที่ต้องล็อกอิน)">
          <div className="space-y-3">
            <Field label="ดึงคุกกี้จากเบราว์เซอร์" hint="ต้องล็อกอินเว็บนั้นในเบราว์เซอร์ไว้ก่อน และควรปิดเบราว์เซอร์ก่อนโหลด (Chrome/Edge ล็อกไฟล์คุกกี้ขณะเปิด)">
              <Select value={settings.cookiesBrowser} onChange={(v) => set({ cookiesBrowser: v, cookiesFile: "" })} options={BROWSERS} />
            </Field>
            <Field label="หรือใช้ไฟล์ cookies.txt (รูปแบบ Netscape)">
              <div className="flex gap-2">
                <input className="input text-xs" readOnly value={settings.cookiesFile} placeholder="ยังไม่ได้เลือก" />
                <button className="btn" onClick={async () => { const [f] = await pickFiles({ multiple: false, filters: [{ name: "cookies", extensions: ["txt"] }] }); if (f) set({ cookiesFile: f, cookiesBrowser: "" }); }}>เลือก</button>
                {settings.cookiesFile && <button className="btn" onClick={() => set({ cookiesFile: "" })}>ล้าง</button>}
              </div>
            </Field>
          </div>
        </Card>

        <Card title="🧰 FFmpeg / yt-dlp">
          <div className="space-y-3">
            {(["ffmpeg", "yt-dlp"] as const).map((n) => {
              const key = n === "ffmpeg" ? "ffmpegPath" : "ytdlpPath";
              const t = tool(n);
              return (
                <Field key={n} label={`พาธ ${n}`} hint={t?.version ? `✅ ${t.version} — ${t.path}` : "❌ ไม่พบ — ใช้ตัวที่มากับโปรแกรม หรือเลือกไฟล์ .exe เอง"}>
                  <div className="flex gap-2">
                    <input className="input text-xs" readOnly value={settings[key]} placeholder="อัตโนมัติ (ตัวที่มากับโปรแกรม)" />
                    <button className="btn" onClick={() => pickExe(key)}>เลือก</button>
                    {settings[key] && <button className="btn" onClick={() => set({ [key]: "" })}>อัตโนมัติ</button>}
                  </div>
                </Field>
              );
            })}
          </div>
        </Card>

        <Card title="🎨 หน้าตา">
          <div className="space-y-3">
            <Field label="ธีม">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {THEMES.map((t) => (
                  <button key={t.id} onClick={() => (t.id === "custom" && !Object.keys(settings.customTheme ?? {}).length ? nav("/personalize") : set({ theme: t.id }))} className={`rounded-xl border p-2 text-sm ${settings.theme === t.id ? "border-accent bg-accent/20" : "border-fg/10 hover:bg-fg/5"}`}>
                    {settings.theme === t.id && <Check size={12} className="mr-1 inline" />}
                    {t.label}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="สีเน้น">
              <div className="flex flex-wrap items-center gap-2">
                {ACCENTS.map((c) => (
                  <button key={c} onClick={() => set({ accent: c })} className={`h-8 w-8 rounded-full ${settings.accent === c ? "ring-2 ring-fg" : ""}`} style={{ background: c }} aria-label={c} />
                ))}
                <input type="color" value={settings.accent} onChange={(e) => set({ accent: e.target.value })} />
              </div>
            </Field>
            <Field label="ภาษาเมนู">
              <Select value={settings.language} onChange={(v) => set({ language: v })} options={[{ value: "th", label: "🇹🇭 ไทย" }, { value: "en", label: "🇬🇧 English" }, { value: "zh", label: "🇨🇳 中文" }, { value: "ja", label: "🇯🇵 日本語" }]} />
            </Field>
            <Toggle label="เอฟเฟกต์เต็ม (กระจกฝ้า + อนุภาคเคลื่อนไหว)" hint="ปิดไว้ = โหมดประหยัดเครื่อง ใช้ CPU/การ์ดจอน้อยลงมาก เหมาะกับโน้ตบุ๊ก/เครื่องสเปกต่ำ" checked={settings.fullEffects} onChange={(v) => set({ fullEffects: v })} />
            <Toggle label="แสดงปีเป็น พ.ศ." hint={`ตัวอย่าง: ${formatDate(Date.now())}`} checked={settings.buddhistEra} onChange={(v) => set({ buddhistEra: v })} />
          </div>
        </Card>

        <Card title="🔔 การทำงาน">
          <div className="space-y-3">
            <Toggle label="เปิดเสียง" checked={settings.sound} onChange={(v) => set({ sound: v })} />
            <Toggle label="แจ้งเตือนของ Windows เมื่องานเสร็จ" checked={settings.notify} onChange={(v) => set({ notify: v })} />
            <Toggle label="อัปเดต yt-dlp อัตโนมัติ" hint="ตรวจสัปดาห์ละครั้งเมื่อเปิดโปรแกรม (ต้องต่อเน็ต)" checked={settings.autoUpdate} onChange={(v) => set({ autoUpdate: v })} />
            <Toggle label="เปิดพร้อม Windows" checked={settings.autostart} onChange={(v) => set({ autostart: v })} />
            <Toggle label="ปิดหน้าต่างแล้วย่อลงถาดระบบ" hint="งานโหลด/แปลงจะทำต่อเบื้องหลัง" checked={settings.minimizeToTray} onChange={(v) => set({ minimizeToTray: v })} />
          </div>
        </Card>

        <Card title="⌨️ คีย์ลัด">
          <p className="text-sm text-muted">
            มีคีย์ลัด {shortcutCount} รายการ กด <Kbd>?</Kbd> เพื่อดูทั้งหมดได้ทุกหน้า
          </p>
          <div className="mt-3 flex gap-2">
            <button className="btn" onClick={() => useApp.getState().setShortcuts(true)}>ดูคีย์ลัด</button>
            <button className="btn" onClick={() => nav("/personalize")}>เปลี่ยนคีย์ลัด</button>
          </div>
        </Card>
      </div>
    </div>
  );
}
