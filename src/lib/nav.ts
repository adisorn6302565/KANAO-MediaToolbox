// รายการหน้าทั้งหมด 22 หน้า + ชื่อเมนูหลายภาษา + คำอธิบายช่วยเหลือภาษาไทย
import {
  LayoutDashboard, Download, Repeat, Minimize2, Scissors, PlayCircle, Workflow, Cloud, BarChart3, Images,
  Wrench, Radio, Shield, Share2, Code2, PartyPopper, HelpCircle, Cpu, Palette, History, Settings, Sparkles, type LucideIcon,
} from "lucide-react";

export type Lang = "th" | "en" | "zh" | "ja";

export interface NavItem {
  path: string;
  icon: LucideIcon;
  label: Record<Lang, string>;
  group: "main" | "tools" | "system";
  help: string;
}

export const NAV: NavItem[] = [
  { path: "/", icon: LayoutDashboard, group: "main", label: { th: "หน้าแรก", en: "Dashboard", zh: "仪表板", ja: "ダッシュボード" }, help: "ภาพรวมการใช้งาน สถิติวันนี้ งานที่กำลังทำ และทางลัดไปยังเครื่องมือหลัก กดการ์ดไฟล์ล่าสุดเพื่อเปิดดูได้ทันที" },
  { path: "/download", icon: Download, group: "main", label: { th: "โหลดคลิป", en: "Downloader", zh: "下载", ja: "ダウンロード" }, help: "วางลิงก์ (ได้หลายลิงก์ บรรทัดละลิงก์) จาก YouTube, Facebook (รวมกลุ่ม), Instagram, TikTok, X และอีกกว่า 1,000 เว็บ เลือกคุณภาพ/รูปแบบ แล้วกด 'เริ่มโหลด' ถ้าคลิปต้องล็อกอิน ให้เลือกเบราว์เซอร์ในช่อง 'คุกกี้' (ต้องล็อกอินเว็บนั้นไว้ในเบราว์เซอร์ก่อน)" },
  { path: "/convert", icon: Repeat, group: "main", label: { th: "แปลงไฟล์", en: "Converter", zh: "转换", ja: "変換" }, help: "ลากไฟล์มาวางหรือกด 'เพิ่มไฟล์' เลือกรูปแบบปลายทางหรือค่าสำเร็จรูป ปรับตัด/ครอป/หมุน/ลายน้ำได้ แล้วกด 'เริ่มแปลง' ทุกไฟล์จะเข้าคิวและแสดงความคืบหน้า" },
  { path: "/compress", icon: Minimize2, group: "main", label: { th: "บีบอัด", en: "Compressor", zh: "压缩", ja: "圧縮" }, help: "ลดขนาด PDF / รูป / วิดีโอ เลื่อนแถบเพื่อเลือกระดับ ดูขนาดก่อน-หลังและ % ที่ลดได้ แท็บ PDF ยังมีรวม/แยก/หมุน/ลบหน้า" },
  { path: "/editor", icon: Scissors, group: "main", label: { th: "ตัดต่อ", en: "Editor", zh: "编辑", ja: "編集" }, help: "ตัดต่อวิดีโอบนไทม์ไลน์ (ลากคลิปเพื่อจัดลำดับ), แต่งเสียง (EQ, เอคโค่, ลดเสียงรบกวน) หรือแต่งรูป (เลเยอร์ แปรง ข้อความไทย ฟิลเตอร์)" },
  { path: "/player", icon: PlayCircle, group: "main", label: { th: "ดูคลิป", en: "Player", zh: "播放器", ja: "プレーヤー" }, help: "ลากไฟล์วิดีโอ/เสียงมาวางเพื่อเล่น คีย์ลัด: Space เล่น/หยุด, ←/→ กรอ 5 วิ, ↑/↓ เสียง, F เต็มจอ, S จับภาพ, B บุ๊กมาร์ก, [ ] ตั้งจุด A-B, P ภาพซ้อน" },
  { path: "/automation", icon: Workflow, group: "tools", label: { th: "อัตโนมัติ", en: "Automation", zh: "自动化", ja: "自動化" }, help: "สร้างกฎเฝ้าโฟลเดอร์ (เช่น ไฟล์ .mov ใหม่ → แปลงเป็น .mp4), สายงานหลายขั้นตอน, เปลี่ยนชื่อเป็นกลุ่ม และจัดเรียงไฟล์อัตโนมัติ กฎจะทำงานเมื่อโปรแกรมเปิดอยู่ (รวมถึงตอนย่อลงถาดระบบ)" },
  { path: "/cloud", icon: Cloud, group: "tools", label: { th: "ซิงก์คลาวด์", en: "Cloud Sync", zh: "云同步", ja: "クラウド" }, help: "อัปโหลดผ่าน rclone (กดติดตั้งและเชื่อมบัญชีได้ในหน้านี้) หรือแชร์ไฟล์ผ่าน LAN ด้วย QR Code ให้มือถือที่ต่อ Wi-Fi เดียวกันโหลดได้ทันที" },
  { path: "/analytics", icon: BarChart3, group: "tools", label: { th: "วิเคราะห์", en: "Analytics", zh: "分析", ja: "分析" }, help: "สถิติการใช้งาน แผนที่ความร้อนรายวัน วิเคราะห์พื้นที่ (treemap) หาไฟล์ซ้ำ/ไฟล์ใหญ่/โฟลเดอร์ว่าง และส่งออก CSV/JSON" },
  { path: "/cleaner", icon: Sparkles, group: "tools", label: { th: "ล้างเครื่อง", en: "PC Cleaner", zh: "清理", ja: "クリーナー" }, help: "สแกนและลบไฟล์ขยะ: ไฟล์ชั่วคราว ถังขยะ แคชเบราว์เซอร์/แอป แคชภาพย่อ รายงานแครช ไฟล์ Windows Update และปิดโปรแกรมที่เปิดพร้อม Windows ให้เครื่องเร็วขึ้น ไม่แตะเอกสาร/รหัสผ่าน/ประวัติเว็บ" },
  { path: "/library", icon: Images, group: "tools", label: { th: "คลังไฟล์", en: "Library", zh: "媒体库", ja: "ライブラリ" }, help: "ดูไฟล์มีเดียแบบแกลเลอรี กรอง/เรียง/ค้นหา ติดแท็ก รายการโปรด สไลด์โชว์ และเลือกหลายไฟล์เพื่อย้าย/ลบ/ติดแท็กพร้อมกัน" },
  { path: "/utilities", icon: Wrench, group: "tools", label: { th: "เครื่องมือ", en: "Utilities", zh: "工具", ja: "ツール" }, help: "เครื่องมือเล็ก ๆ กว่า 30 อย่าง เลือกจากรายการด้านซ้าย" },
  { path: "/streaming", icon: Radio, group: "tools", label: { th: "สตรีมมิ่ง", en: "Streaming", zh: "流媒体", ja: "ストリーミング" }, help: "เปิด Media Server ให้ Smart TV/มือถือเปิดดูผ่านเบราว์เซอร์, ฟีดพอดแคสต์ RSS, อัดไลฟ์สดและวิทยุออนไลน์" },
  { path: "/security", icon: Shield, group: "tools", label: { th: "ความปลอดภัย", en: "Security", zh: "安全", ja: "セキュリティ" }, help: "เข้ารหัสไฟล์ AES-256 (จำรหัสผ่านไว้ให้ดี ลืมแล้วกู้ไม่ได้), ลบถาวร, ลบ EXIF/GPS, ใส่ลายน้ำ, ตั้ง PIN และปุ่มฉุกเฉิน (Ctrl+Shift+H)" },
  { path: "/social", icon: Share2, group: "tools", label: { th: "โซเชียล", en: "Social", zh: "社交", ja: "ソーシャル" }, help: "โหลด Reels/TikTok ไม่ติดลายน้ำ ภาพปก สตอรี่ ดึงแคปชัน นับแฮชแท็ก และจดตารางโพสต์ (โปรแกรมไม่โพสต์ให้อัตโนมัติ)" },
  { path: "/developer", icon: Code2, group: "system", label: { th: "นักพัฒนา", en: "Developer", zh: "开发者", ja: "開発者" }, help: "ทดสอบ API, สร้าง API key, ตั้ง webhook แจ้งเตือนเมื่องานเสร็จ, ปลั๊กอิน JavaScript, ดู log และคำสั่ง CLI" },
  { path: "/fun", icon: PartyPopper, group: "system", label: { th: "สนุก", en: "Fun", zh: "娱乐", ja: "お楽しみ" }, help: "เครื่องเล่นเพลง + เนื้อเพลง .lrc + ภาพเคลื่อนไหวตามเสียง, Pomodoro, สร้างวอลเปเปอร์, ปุ่มเสียงมีม, แมวน้อย และความสำเร็จ" },
  { path: "/help", icon: HelpCircle, group: "system", label: { th: "ช่วยเหลือ", en: "Help", zh: "帮助", ja: "ヘルプ" }, help: "คู่มือ คำถามที่พบบ่อย คีย์ลัด (กด ? ได้ทุกหน้า) และบันทึกการเปลี่ยนแปลง" },
  { path: "/system", icon: Cpu, group: "system", label: { th: "ระบบ", en: "System", zh: "系统", ja: "システム" }, help: "ดูการใช้ CPU/RAM/ดิสก์/เครือข่ายแบบ real-time จัดการคิวงาน ดู log สำรอง/กู้คืนการตั้งค่า และอัปเดต yt-dlp" },
  { path: "/personalize", icon: Palette, group: "system", label: { th: "ปรับแต่ง", en: "Personalize", zh: "个性化", ja: "カスタマイズ" }, help: "เลือกและจัดลำดับ widget ในหน้าแรก ตั้งชื่อ/รูปโปรไฟล์ เสียงแจ้งเตือน คีย์ลัด ภาษา และสร้างธีมเอง" },
  { path: "/history", icon: History, group: "system", label: { th: "ประวัติ", en: "History", zh: "历史", ja: "履歴" }, help: "ประวัติงานโหลด/แปลง/บีบอัดทั้งหมด ค้นหา กรอง เปิดไฟล์/โฟลเดอร์ และส่งออก" },
  { path: "/settings", icon: Settings, group: "system", label: { th: "ตั้งค่า", en: "Settings", zh: "设置", ja: "設定" }, help: "ตั้งโฟลเดอร์ปลายทาง คุกกี้ จำนวนงานพร้อมกัน พาธ FFmpeg/yt-dlp proxy ธีม และอื่น ๆ" },
];

export const GROUP_LABEL: Record<NavItem["group"], Record<Lang, string>> = {
  main: { th: "งานหลัก", en: "Main", zh: "主要", ja: "メイン" },
  tools: { th: "เครื่องมือ", en: "Tools", zh: "工具", ja: "ツール" },
  system: { th: "ระบบ", en: "System", zh: "系统", ja: "システム" },
};

export const DEFAULT_SHORTCUTS: Record<string, string> = {
  "/": "Ctrl+1",
  "/download": "Ctrl+2",
  "/convert": "Ctrl+3",
  "/compress": "Ctrl+4",
  "/editor": "Ctrl+5",
  "/player": "Ctrl+6",
  "/library": "Ctrl+7",
  "/history": "Ctrl+8",
  "/settings": "Ctrl+,",
  panic: "Ctrl+Shift+H",
  lock: "Ctrl+L",
  help: "?",
};

export function comboOf(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey && e.key.length > 1) parts.push("Shift");
  if (e.shiftKey && e.key.length === 1 && /[a-z]/i.test(e.key)) parts.push("Shift");
  const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  if (!["Control", "Alt", "Shift", "Meta"].includes(e.key)) parts.push(k);
  return parts.join("+");
}
