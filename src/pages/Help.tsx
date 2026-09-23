// หน้า 17: ช่วยเหลือ
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { HelpCircle, Compass, Keyboard, BookOpen, MessageSquare, History as HistoryIcon, ChevronDown, Search } from "lucide-react";
import { Card, Field, PageHeader, Select, Tabs } from "@/components/ui";
import { call, revealPath } from "@/lib/api";
import { attempt, useApp } from "@/store/app";
import { joinPath } from "@/lib/format";
import { NAV } from "@/lib/nav";

type Tab = "guide" | "faq" | "lessons" | "changelog" | "feedback";

export default function Help() {
  const [tab, setTab] = useState<Tab>("guide");
  return (
    <div>
      <PageHeader
        title="ช่วยเหลือ"
        subtitle="คู่มือภาษาไทย คำถามที่พบบ่อย และบทเรียน"
        icon={<HelpCircle />}
        actions={
          <>
            <button className="btn" onClick={() => useApp.getState().setShortcuts(true)}><Keyboard size={15} /> คีย์ลัด (?)</button>
            <button className="btn-primary" onClick={() => useApp.getState().saveSettings({ onboarded: false })}><Compass size={15} /> เริ่มทัวร์แนะนำ</button>
          </>
        }
      />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "guide", label: "📖 คู่มือทุกหน้า" }, { id: "faq", label: "❓ คำถามที่พบบ่อย" }, { id: "lessons", label: "🎓 บทเรียน" }, { id: "changelog", label: "📝 มีอะไรใหม่" }, { id: "feedback", label: "💬 ความคิดเห็น" }]} />
      {tab === "guide" && <Guide />}
      {tab === "faq" && <Faq />}
      {tab === "lessons" && <Lessons />}
      {tab === "changelog" && <Changelog />}
      {tab === "feedback" && <Feedback />}
    </div>
  );
}

function Guide() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const list = NAV.filter((n) => !q || `${n.label.th} ${n.help}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div className="relative mb-3">
        <Search size={15} className="absolute left-3 top-3 text-muted" />
        <input className="input pl-9" placeholder="ค้นหาในคู่มือ เช่น ซับ, คุกกี้, ลายน้ำ" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {list.map((n) => (
          <Card key={n.path}>
            <div className="flex items-start gap-3">
              <n.icon className="mt-0.5 shrink-0 text-accent2" size={22} />
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <b>{n.label.th}</b>
                  <button className="btn btn-sm" onClick={() => nav(n.path)}>ไปที่หน้านี้</button>
                </div>
                <p className="mt-1 text-sm text-muted">{n.help}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

export const FAQ: [string, string][] = [
  ["โหลดคลิปไม่ได้ ขึ้นว่า 'ต้องเข้าสู่ระบบ' ทำอย่างไร?", "ไปที่ ตั้งค่า → คุกกี้ เลือกเบราว์เซอร์ที่ล็อกอิน Facebook/Instagram ไว้ (Chrome, Edge, Firefox, Brave) แล้วปิดเบราว์เซอร์นั้นก่อนโหลด หรือส่งออกคุกกี้เป็นไฟล์ cookies.txt แล้วเลือกไฟล์แทน"],
  ["โหลดจากกลุ่ม Facebook ได้ไหม?", "ได้ ถ้าบัญชีที่ล็อกอินในเบราว์เซอร์เป็นสมาชิกของกลุ่มนั้น ต้องตั้งค่าคุกกี้ก่อน แล้วคัดลอกลิงก์โพสต์วิดีโอในกลุ่มมาวาง"],
  ["โหลดแล้วช้ามาก / ขึ้น HTTP 403", "กดปุ่ม 'อัปเดต yt-dlp' ในหน้า ระบบ เพราะเว็บเปลี่ยนบ่อย ถ้ายังไม่ได้ ลองตั้ง proxy หรือลดจำนวนงานพร้อมกัน"],
  ["ไฟล์ MKV/AVI เปิดในหน้าดูคลิปแล้วไม่มีภาพ", "โปรแกรมจะแปลงชั่วคราวให้อัตโนมัติ (รอสักครู่ตามความยาวคลิป) ถ้ายังไม่ได้ ให้แปลงเป็น MP4 ในหน้าแปลงไฟล์"],
  ["ใช้การ์ดจอช่วยแปลงไฟล์ได้อย่างไร?", "ในหน้าแปลงไฟล์ → แท็บขั้นสูง → เลือก NVENC (NVIDIA), QSV (Intel) หรือ AMF (AMD) ถ้าการ์ดจอไม่รองรับ งานจะแจ้งข้อผิดพลาดให้เปลี่ยนกลับเป็น CPU"],
  ["บีบอัด PDF ต้องลงโปรแกรมอะไรเพิ่มไหม?", "การรวม/แยก/หมุน/ลบหน้า ทำได้ในตัว ส่วนการลดขนาดแบบละเอียดจะใช้ Ghostscript ถ้าติดตั้งไว้ (ถ้าไม่มี จะใช้วิธีบีบอัดแบบไม่เสียคุณภาพในตัวแทน ซึ่งลดได้น้อยกว่า)"],
  ["ลืมรหัสผ่านไฟล์ที่เข้ารหัสไว้", "กู้คืนไม่ได้ครับ เพราะใช้ AES-256 ที่ไม่มีทางถอดโดยไม่มีรหัส แนะนำให้จดรหัสผ่านไว้ในที่ปลอดภัย"],
  ["ลืม PIN เข้าโปรแกรม", "ปิดโปรแกรม แล้วเปิดไฟล์ settings.json ในโฟลเดอร์ข้อมูล (ดูได้ที่หน้า ระบบ) ลบค่าในช่อง pinHash ให้เป็น \"\" แล้วเปิดโปรแกรมใหม่"],
  ["ซับไทยเป็นภาษาต่างดาว", "ไฟล์ซับน่าจะเป็นรหัส TIS-620 โปรแกรมพยายามแปลงให้อัตโนมัติ ถ้ายังเพี้ยน ให้เปิดไฟล์ด้วย Notepad แล้วบันทึกเป็น UTF-8"],
  ["แชร์ไฟล์ผ่าน LAN แล้วมือถือเปิดไม่ได้", "ตรวจว่ามือถือกับคอมต่อ Wi-Fi เดียวกัน และอนุญาตโปรแกรมใน Windows Firewall (เครือข่ายส่วนตัว) บางเราเตอร์เปิด 'AP isolation' ไว้จะทำให้เครื่องมองไม่เห็นกัน"],
  ["ปิดหน้าต่างแล้วงานยังทำต่อไหม?", "ถ้าเปิด 'ย่อลงถาดระบบ' ในตั้งค่าไว้ โปรแกรมจะทำงานต่อที่ไอคอนมุมขวาล่าง คลิกไอคอนเพื่อเปิดกลับมา"],
  ["โปรแกรมส่งข้อมูลออกไปไหนบ้าง?", "ไม่ส่ง ทุกอย่างทำงานในเครื่อง ยกเว้นตอนโหลดคลิป (เชื่อมต่อเว็บต้นทาง), อัปโหลด rclone และ webhook ที่คุณตั้งเอง"],
];

function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <Card>
      {FAQ.map(([q, a], i) => (
        <div key={i} className="border-b border-fg/10 last:border-0">
          <button className="flex w-full items-center gap-2 py-3 text-left font-medium" onClick={() => setOpen(open === i ? null : i)}>
            <span className="flex-1">{q}</span>
            <ChevronDown size={16} className={`transition ${open === i ? "rotate-180" : ""}`} />
          </button>
          {open === i && <p className="selectable pb-3 text-sm text-muted">{a}</p>}
        </div>
      ))}
    </Card>
  );
}

const LESSONS: { title: string; icon: string; steps: [string, string?][] }[] = [
  { title: "โหลดคลิปแรกของคุณ", icon: "📥", steps: [["คัดลอกลิงก์คลิปจาก YouTube/TikTok/Facebook"], ["ไปหน้าโหลดคลิป", "/download"], ["วางลิงก์ในช่องด้านบน (Ctrl+V)"], ["เลือกคุณภาพ เช่น 1080p และรูปแบบ MP4"], ["กด 'เริ่มโหลด' แล้วดูความคืบหน้าในคิว"], ["เมื่อเสร็จ กดไอคอนโฟลเดอร์เพื่อเปิดไฟล์"]] },
  { title: "แปลงคลิปให้ลง TikTok", icon: "🎬", steps: [["ไปหน้าแปลงไฟล์", "/convert"], ["ลากคลิปมาวาง"], ["เลือกค่าสำเร็จรูป 'TikTok / Reels (9:16)'"], ["ถ้าต้องการ ตัดช่วงในแท็บ ตัด/ครอป"], ["กด 'เริ่มแปลง'"]] },
  { title: "ลดขนาดรูปทั้งโฟลเดอร์", icon: "🖼️", steps: [["ไปหน้าบีบอัด แท็บรูป", "/compress"], ["ลากรูปทั้งหมดมาวาง"], ["เลือกโหมด 'จำกัดความละเอียด' เช่น 1920px"], ["เลือกส่งออกเป็น WEBP และเปิด 'ลบ EXIF/GPS'"], ["กดเริ่ม แล้วดูขนาดที่ลดได้"]] },
  { title: "ตั้งให้แปลง .mov อัตโนมัติ", icon: "🤖", steps: [["ไปหน้าอัตโนมัติ แท็บเฝ้าโฟลเดอร์", "/automation"], ["กด 'เพิ่มกฎ' แล้วเลือกโฟลเดอร์ที่ต้องการเฝ้า"], ["ตั้งนามสกุล mov และการกระทำ 'แปลงเป็น mp4'"], ["เปิดสวิตช์กฎ — ไฟล์ใหม่จะถูกแปลงเองขณะโปรแกรมเปิดอยู่"]] },
  { title: "ส่งไฟล์เข้ามือถือด้วย QR", icon: "📱", steps: [["ไปหน้าซิงก์คลาวด์ แท็บแชร์ LAN", "/cloud"], ["เลือกโฟลเดอร์แล้วกด 'เริ่มแชร์'"], ["เปิดกล้องมือถือสแกน QR"], ["แตะไฟล์ที่ต้องการเพื่อโหลด"]] },
];

function Lessons() {
  const nav = useNavigate();
  const [sel, setSel] = useState(0);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const l = LESSONS[sel];
  return (
    <div className="grid gap-4 md:grid-cols-[260px_1fr]">
      <Card>
        {LESSONS.map((x, i) => (
          <button key={x.title} onClick={() => setSel(i)} className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm ${sel === i ? "bg-accent/25" : "hover:bg-fg/5"}`}>
            <span className="text-xl">{x.icon}</span> {x.title}
          </button>
        ))}
      </Card>
      <Card title={`${l.icon} ${l.title}`}>
        <ol className="space-y-2">
          {l.steps.map(([s, path], i) => {
            const key = `${sel}-${i}`;
            return (
              <li key={key} className="flex items-center gap-3">
                <button onClick={() => setDone({ ...done, [key]: !done[key] })} className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm ${done[key] ? "bg-lime-500/40" : "bg-fg/10"}`}>{done[key] ? "✓" : i + 1}</button>
                <span className={`flex-1 ${done[key] ? "text-muted line-through" : ""}`}>{s}</span>
                {path && <button className="btn btn-sm" onClick={() => nav(path)}>เปิดหน้า →</button>}
              </li>
            );
          })}
        </ol>
        {l.steps.every((_, i) => done[`${sel}-${i}`]) && <p className="mt-4 text-center text-lg">🎉 เยี่ยมมาก! จบบทเรียนนี้แล้ว</p>}
      </Card>
    </div>
  );
}

export const CHANGELOG: { version: string; date: string; items: string[] }[] = [
  {
    version: "1.1.1",
    date: "2026-09-18",
    items: ["แก้โปรแกรมค้างเมื่อกดสลับหน้าเร็ว ๆ (งานหนักย้ายออกจากเธรดหน้าจอทั้งหมด)", "จำกัดการสร้างภาพย่อพร้อมกัน ไม่กินเครื่อง"],
  },
  {
    version: "1.1.0",
    date: "2026-09-18",
    items: [
      "อัดหน้าจอใหม่หมด: ใช้การ์ดจอจับภาพ ลื่น 30–60 fps อัดเสียงในเครื่อง + ไมค์ได้ เลือกจอ/ลากเลือกพื้นที่ หยุดได้จากถาดระบบ",
      "หน้าใหม่ \"ล้างเครื่อง\": ลบไฟล์ขยะ แคชเบราว์เซอร์/แอป ถังขยะ Windows Update และจัดการโปรแกรมเปิดพร้อม Windows",
      "เครื่องเล่นเปิด HEVC/MKV/AVI/WMV ได้ทันทีด้วยการแปลงสด ไม่ต้องรอ และไม่จำกัดความยาว",
      "ส่งคลิปขึ้น Smart TV (DLNA) จากหน้าสตรีมมิ่ง",
      "จับภาพหน้าจอแบบลากเลือกพื้นที่ / เลือกหน้าต่าง / คัดลอกภาพ",
      "บีบอัด PDF ได้จริง (ย่อรูปในไฟล์) และใส่รหัส PDF ได้โดยไม่ต้องลงโปรแกรมเพิ่ม",
      "สร้าง/แตกไฟล์ 7z (มีรหัสผ่านได้) ในตัว",
      "สั่งงานด้วยเสียงแบบออฟไลน์, ติดตั้ง rclone ได้จากในโปรแกรม",
      "โหมดประหยัดเครื่องเป็นค่าเริ่มต้น (ปิดกระจกฝ้า/อนุภาค) เปิดเอฟเฟกต์เต็มได้ในตั้งค่า",
    ],
  },
  {
    version: "1.0.0",
    date: "2026-09-17",
    items: [
      "เปิดตัวมีเดียทูลบ็อกซ์ครบ 21 หน้า ภาษาไทยทั้งโปรแกรม",
      "โหลดคลิปจาก 1,000+ เว็บ (yt-dlp) พร้อมคิว หยุด/ต่อ/ตั้งเวลา",
      "แปลง/บีบอัด/ตัดต่อ วิดีโอ เสียง รูป PDF ด้วย FFmpeg",
      "เครื่องเล่นในตัว รองรับซับ SRT/VTT/ASS, A-B loop, bookmark, PiP",
      "ระบบอัตโนมัติ เฝ้าโฟลเดอร์ แชร์ LAN + QR, FTP, P2P",
      "เข้ารหัส AES-256, ลบถาวร, PIN, ปุ่มฉุกเฉิน",
      "เครื่องมือเล็ก ๆ 30 อย่าง, ธีม 5 แบบ + สร้างเอง",
    ],
  },
];

function Changelog() {
  return (
    <Card>
      {CHANGELOG.map((c) => (
        <div key={c.version} className="mb-4">
          <div className="flex items-center gap-2"><HistoryIcon size={16} className="text-accent2" /><b className="text-lg">v{c.version}</b><span className="text-sm text-muted">{c.date}</span></div>
          <ul className="mt-2 list-disc space-y-1 pl-8 text-sm">{c.items.map((i) => <li key={i}>{i}</li>)}</ul>
        </div>
      ))}
    </Card>
  );
}

function Feedback() {
  const settings = useApp((s) => s.settings);
  const [type, setType] = useState("ข้อเสนอแนะ");
  const [text, setText] = useState("");
  const [rating, setRating] = useState(5);
  const save = async () => {
    const info = await call<{ version: string }>("app_info").catch(() => ({ version: "?" }));
    const path = joinPath(settings?.downloadDir ?? "", "ความคิดเห็น", `feedback-${Date.now()}.txt`);
    const content = `ประเภท: ${type}\nคะแนน: ${"★".repeat(rating)}\nเวอร์ชัน: ${info.version}\nระบบ: ${navigator.userAgent}\nวันที่: ${new Date().toISOString()}\n\n${text}\n`;
    const ok = await attempt(() => call("write_text_file", { path, content }).then(() => true), "บันทึกความคิดเห็นแล้ว ขอบคุณครับ 🙏");
    if (ok) {
      setText("");
      revealPath(path);
    }
  };
  return (
    <Card title={<span className="flex items-center gap-2"><MessageSquare size={16} /> ส่งความคิดเห็น</span>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="ประเภท"><Select value={type} onChange={setType} options={["ข้อเสนอแนะ", "แจ้งปัญหา", "ขอฟีเจอร์", "ชม 😊"]} /></Field>
        <Field label="ความพึงพอใจ">
          <div className="flex gap-1 text-2xl">{[1, 2, 3, 4, 5].map((n) => <button key={n} onClick={() => setRating(n)} className={n <= rating ? "text-amber-300" : "text-fg/20"}>★</button>)}</div>
        </Field>
      </div>
      <textarea className="input mt-3 h-40" placeholder="เล่าให้ฟังหน่อย…" value={text} onChange={(e) => setText(e.target.value)} />
      <button className="btn-primary mt-3" disabled={!text.trim()} onClick={save}><BookOpen size={15} /> บันทึก</button>
      <p className="mt-2 text-xs text-muted">โปรแกรมทำงานออฟไลน์ ความคิดเห็นจะถูกบันทึกเป็นไฟล์ในเครื่อง (พร้อมข้อมูลเวอร์ชัน) ให้คุณส่งต่อให้ผู้พัฒนาทางอีเมลหรือช่องทางที่สะดวก</p>
    </Card>
  );
}
