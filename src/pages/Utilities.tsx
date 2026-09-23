// หน้า 11: เครื่องมือ 30+ อย่าง (เลือกจากรายการด้านซ้าย)
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Wrench, Search } from "lucide-react";
import { PageHeader, Card } from "@/components/ui";
import { useKv } from "@/hooks/useData";

const Media = () => import("./tools/MediaTools");
const Img = () => import("./tools/ImageTools");
const Txt = () => import("./tools/TextTools");

type Loader = () => Promise<Record<string, any>>;

interface ToolDef {
  id: string;
  icon: string;
  name: string;
  group: string;
  from: Loader;
  exp: string;
}

export const TOOLS: ToolDef[] = [
  { id: "record", icon: "🔴", name: "อัดหน้าจอ / กล้อง", group: "มีเดีย", from: Media, exp: "ScreenRecorder" },
  { id: "shot", icon: "📸", name: "จับภาพหน้าจอ", group: "มีเดีย", from: Media, exp: "ScreenCapture" },
  { id: "gif", icon: "🎞️", name: "สร้าง GIF", group: "มีเดีย", from: Media, exp: "GifMaker" },
  { id: "frames", icon: "🖼️", name: "ดึงเฟรมจากวิดีโอ", group: "มีเดีย", from: Media, exp: "FrameExtractor" },
  { id: "storyboard", icon: "🧩", name: "สร้างสตอรีบอร์ด", group: "มีเดีย", from: Media, exp: "Storyboard" },
  { id: "boost", icon: "🔊", name: "เพิ่มความดังเสียง", group: "มีเดีย", from: Media, exp: "AudioBoost" },
  { id: "level", icon: "🎚️", name: "ปรับระดับเสียงให้เท่ากัน", group: "มีเดีย", from: Media, exp: "AudioLevel" },
  { id: "bpm", icon: "🥁", name: "ตรวจจับจังหวะเพลง (BPM)", group: "มีเดีย", from: Media, exp: "BpmDetector" },
  { id: "metronome", icon: "⏱️", name: "เมโทรนอม", group: "มีเดีย", from: Media, exp: "Metronome" },
  { id: "meta", icon: "🏷️", name: "ดู/แก้ไขข้อมูลเมตา", group: "มีเดีย", from: Media, exp: "MetadataEditor" },
  { id: "subs", icon: "💬", name: "เครื่องมือซับไตเติ้ล", group: "มีเดีย", from: Media, exp: "SubtitleTools" },
  { id: "timecode", icon: "🕐", name: "คำนวณ timecode", group: "มีเดีย", from: Media, exp: "TimecodeCalc" },
  { id: "meme", icon: "😂", name: "สร้างมีม", group: "รูปภาพ", from: Img, exp: "MemeMaker" },
  { id: "qr", icon: "🔳", name: "สร้าง QR Code", group: "รูปภาพ", from: Img, exp: "QrMaker" },
  { id: "barcode", icon: "📊", name: "สร้างบาร์โค้ด", group: "รูปภาพ", from: Img, exp: "BarcodeMaker" },
  { id: "color", icon: "🎨", name: "ดูดสี / จานสี / ตาบอดสี", group: "รูปภาพ", from: Img, exp: "ColorTools" },
  { id: "font", icon: "🔤", name: "ดูตัวอย่างฟอนต์", group: "รูปภาพ", from: Img, exp: "FontPreview" },
  { id: "favicon", icon: "⭐", name: "สร้าง favicon / ไอคอน", group: "รูปภาพ", from: Img, exp: "FaviconMaker" },
  { id: "beautify", icon: "✨", name: "ตกแต่งภาพหน้าจอ", group: "รูปภาพ", from: Img, exp: "ScreenshotBeautifier" },
  { id: "aspect", icon: "📐", name: "คำนวณอัตราส่วนภาพ", group: "รูปภาพ", from: Img, exp: "AspectCalc" },
  { id: "hash", icon: "#️⃣", name: "ตรวจ hash ไฟล์", group: "ไฟล์", from: Txt, exp: "HashTool" },
  { id: "password", icon: "🔑", name: "สร้างรหัสผ่าน", group: "ไฟล์", from: Txt, exp: "PasswordGen" },
  { id: "split", icon: "✂️", name: "แบ่งไฟล์ / รวมไฟล์", group: "ไฟล์", from: Txt, exp: "SplitJoin" },
  { id: "archive", icon: "📦", name: "บีบอัด / แตกไฟล์ (ZIP 7z RAR TAR)", group: "ไฟล์", from: Txt, exp: "ArchiveTool" },
  { id: "text", icon: "📝", name: "เครื่องมือข้อความ", group: "ข้อความ", from: Txt, exp: "TextTools" },
  { id: "markdown", icon: "📄", name: "Markdown พรีวิว", group: "ข้อความ", from: Txt, exp: "MarkdownTool" },
  { id: "json", icon: "🧾", name: "JSON / XML / YAML", group: "ข้อความ", from: Txt, exp: "DataFormatter" },
  { id: "base64", icon: "🔁", name: "Base64 / URL เข้า-ถอดรหัส", group: "ข้อความ", from: Txt, exp: "EncodeTool" },
  { id: "regex", icon: "🧪", name: "ทดสอบ Regex", group: "ข้อความ", from: Txt, exp: "RegexTester" },
  { id: "units", icon: "📏", name: "แปลงหน่วย", group: "ข้อความ", from: Txt, exp: "UnitConverter" },
];

const cache = new Map<string, React.LazyExoticComponent<React.ComponentType>>();
function toolComponent(t: ToolDef) {
  if (!cache.has(t.id)) cache.set(t.id, lazy(() => t.from().then((m) => ({ default: m[t.exp] }))));
  return cache.get(t.id)!;
}

export default function Utilities() {
  const [active, setActive] = useKv<string>("utilities.active", "qr");
  const [q, setQ] = useState("");
  // เปิดเครื่องมือตรง ๆ ด้วย ?tool=record (จากคำสั่งเสียง / ทางลัด)
  const [params] = useSearchParams();
  useEffect(() => {
    const t = params.get("tool");
    if (t && TOOLS.some((x) => x.id === t)) setActive(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);
  const tool = TOOLS.find((t) => t.id === active) ?? TOOLS[0];
  const Comp = toolComponent(tool);
  const groups = useMemo(() => {
    const list = TOOLS.filter((t) => t.name.toLowerCase().includes(q.toLowerCase()));
    return [...new Set(list.map((t) => t.group))].map((g) => ({ g, items: list.filter((t) => t.group === g) }));
  }, [q]);
  return (
    <div>
      <PageHeader title="เครื่องมือ" subtitle={`เครื่องมือเล็ก ๆ ${TOOLS.length} อย่าง ใช้งานออฟไลน์ทั้งหมด`} icon={<Wrench />} />
      <div className="grid gap-4 lg:grid-cols-[250px_1fr]">
        <Card className="h-fit lg:sticky lg:top-0">
          <div className="relative mb-2">
            <Search size={14} className="absolute left-2.5 top-2.5 text-muted" />
            <input className="input pl-8" placeholder="ค้นหาเครื่องมือ" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="max-h-[70vh] overflow-auto">
            {groups.map(({ g, items }) => (
              <div key={g} className="mb-2">
                <div className="label">{g}</div>
                {items.map((t) => (
                  <button key={t.id} onClick={() => setActive(t.id)} className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition ${t.id === tool.id ? "bg-accent/25 text-fg" : "text-muted hover:bg-fg/5 hover:text-fg"}`}>
                    <span>{t.icon}</span> {t.name}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </Card>
        <Card title={<span className="text-lg">{tool.icon} {tool.name}</span>}>
          <Suspense fallback={<div className="py-10 text-center text-muted">กำลังโหลด…</div>}>
            <Comp />
          </Suspense>
        </Card>
      </div>
    </div>
  );
}
