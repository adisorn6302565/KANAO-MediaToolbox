// เครื่องมือกลุ่มรูปภาพ (ทำงานบน canvas ทั้งหมด)
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import JsBarcode from "jsbarcode";
import { Download, Pipette, Upload } from "lucide-react";
import { DropZone, Field, Select, Slider, Toggle } from "@/components/ui";
import { api, call, fileUrl, pickSave } from "@/lib/api";
import { attempt, useApp } from "@/store/app";
import { IMAGE_EXT, basename, joinPath } from "@/lib/format";

/** บันทึก canvas เป็นไฟล์ผ่านหน้าต่าง Save */
async function saveCanvas(c: HTMLCanvasElement, name: string, type = "png") {
  const out = await pickSave(name, [{ name: type.toUpperCase(), extensions: [type] }]);
  if (!out) return;
  const mime = type === "jpg" ? "image/jpeg" : `image/${type}`;
  await attempt(() => call("write_base64_file", { path: out, data: c.toDataURL(mime, 0.95).split(",")[1] }), `บันทึก ${basename(out)} แล้ว`);
}

function loadImg(src: string) {
  return new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  // ภาษาไทยไม่มีช่องว่างระหว่างคำ → ใช้ Intl.Segmenter ตัดคำ
  const seg = typeof Intl !== "undefined" && "Segmenter" in Intl ? [...new (Intl as any).Segmenter("th", { granularity: "word" }).segment(text)].map((s: any) => s.segment) : text.split(/(\s+)/);
  const lines: string[] = [];
  let cur = "";
  for (const w of seg) {
    if (w === "\n") {
      lines.push(cur);
      cur = "";
      continue;
    }
    if (ctx.measureText(cur + w).width > maxW && cur) {
      lines.push(cur.trim());
      cur = w.trimStart();
    } else cur += w;
  }
  if (cur) lines.push(cur.trim());
  return lines;
}

// ---------- มีม ----------
export function MemeMaker() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState("");
  const [top, setTop] = useState("เมื่อโหลดคลิปเสร็จ");
  const [bottom, setBottom] = useState("แต่ลืมว่าเก็บไว้ไหน");
  const [size, setSize] = useState(64);
  const [font, setFont] = useState("Prompt");
  useEffect(() => {
    (async () => {
      const c = canvas.current!;
      const ctx = c.getContext("2d")!;
      let image: HTMLImageElement | null = null;
      if (img) image = await loadImg(fileUrl(img)).catch(() => null);
      c.width = image?.naturalWidth ?? 800;
      c.height = image?.naturalHeight ?? 800;
      if (image) ctx.drawImage(image, 0, 0);
      else {
        const g = ctx.createLinearGradient(0, 0, 800, 800);
        g.addColorStop(0, "#a855f7");
        g.addColorStop(1, "#22d3ee");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 800, 800);
      }
      const fs = (size / 800) * c.width;
      ctx.font = `900 ${fs}px "${font}"`;
      ctx.textAlign = "center";
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "#000";
      ctx.lineWidth = fs / 8;
      ctx.lineJoin = "round";
      const draw = (t: string, fromTop: boolean) => {
        const lines = wrapText(ctx, t, c.width * 0.92);
        lines.forEach((l, i) => {
          const y = fromTop ? fs * 1.1 * (i + 1) : c.height - fs * 0.35 - fs * 1.1 * (lines.length - 1 - i);
          ctx.strokeText(l, c.width / 2, y);
          ctx.fillText(l, c.width / 2, y);
        });
      };
      draw(top, true);
      draw(bottom, false);
    })();
  }, [img, top, bottom, size, font]);
  return (
    <div className="grid gap-4 md:grid-cols-[1fr_280px]">
      <canvas ref={canvas} className="max-h-[60vh] w-full rounded-xl object-contain" />
      <div className="space-y-3">
        <DropZone onFiles={(p) => setImg(p[0])} accept={IMAGE_EXT} multiple={false} compact label="ลากรูปพื้นหลัง" />
        <Field label="ข้อความบน"><textarea className="input h-16" value={top} onChange={(e) => setTop(e.target.value)} /></Field>
        <Field label="ข้อความล่าง"><textarea className="input h-16" value={bottom} onChange={(e) => setBottom(e.target.value)} /></Field>
        <Slider label="ขนาดตัวอักษร" value={size} min={24} max={140} onChange={setSize} />
        <Field label="ฟอนต์"><Select value={font} onChange={setFont} options={["Prompt", "Sarabun", "IBM Plex Sans Thai", "Impact", "Tahoma"]} /></Field>
        <button className="btn-primary w-full" onClick={() => saveCanvas(canvas.current!, "มีม.png")}><Download size={14} /> บันทึกมีม</button>
      </div>
    </div>
  );
}

// ---------- QR ----------
export function buildQrText(type: string, v: Record<string, string>): string {
  const esc = (s = "") => s.replace(/([\\;,:"])/g, "\\$1");
  switch (type) {
    case "wifi":
      return `WIFI:T:${v.security || "WPA"};S:${esc(v.ssid)};P:${esc(v.password)};H:${v.hidden === "1" ? "true" : "false"};;`;
    case "vcard":
      return ["BEGIN:VCARD", "VERSION:3.0", `N:${v.last ?? ""};${v.first ?? ""}`, `FN:${v.first ?? ""} ${v.last ?? ""}`.trim(), v.org && `ORG:${v.org}`, v.phone && `TEL;TYPE=CELL:${v.phone}`, v.email && `EMAIL:${v.email}`, v.url && `URL:${v.url}`, "END:VCARD"].filter(Boolean).join("\n");
    case "promptpay":
      return v.text ?? "";
    default:
      return v.text ?? "";
  }
}

export function QrMaker() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [type, setType] = useState("url");
  const [v, setV] = useState<Record<string, string>>({ text: "https://github.com", security: "WPA" });
  const [fg, setFg] = useState("#1a1033");
  const [bg, setBg] = useState("#ffffff");
  const [logo, setLogo] = useState("");
  const [size, setSize] = useState(512);
  const set = (k: string, val: string) => setV({ ...v, [k]: val });
  const text = buildQrText(type, v);
  useEffect(() => {
    const c = canvas.current!;
    if (!text) return;
    QRCode.toCanvas(c, text, { width: size, margin: 2, errorCorrectionLevel: logo ? "H" : "M", color: { dark: fg, light: bg } }).then(async () => {
      if (!logo) return;
      const img = await loadImg(fileUrl(logo)).catch(() => null);
      if (!img) return;
      const ctx = c.getContext("2d")!;
      const s = c.width * 0.22;
      const x = (c.width - s) / 2;
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.roundRect(x - 8, x - 8, s + 16, s + 16, 12);
      ctx.fill();
      ctx.drawImage(img, x, x, s, s);
    }).catch(() => {});
  }, [text, fg, bg, logo, size]);
  const fields: Record<string, [string, string][]> = {
    url: [["text", "ลิงก์"]],
    text: [["text", "ข้อความ"]],
    wifi: [["ssid", "ชื่อ Wi-Fi"], ["password", "รหัสผ่าน"]],
    vcard: [["first", "ชื่อ"], ["last", "นามสกุล"], ["phone", "เบอร์โทร"], ["email", "อีเมล"], ["org", "บริษัท"], ["url", "เว็บไซต์"]],
  };
  return (
    <div className="grid gap-4 md:grid-cols-[1fr_300px]">
      <div className="space-y-3">
        <Field label="ประเภท">
          <Select value={type} onChange={setType} options={[{ value: "url", label: "🔗 ลิงก์" }, { value: "text", label: "📝 ข้อความ" }, { value: "wifi", label: "📶 Wi-Fi" }, { value: "vcard", label: "👤 นามบัตร" }]} />
        </Field>
        {fields[type].map(([k, label]) => (
          <Field key={k} label={label}>
            {k === "text" && type === "text" ? <textarea className="input h-24" value={v[k] ?? ""} onChange={(e) => set(k, e.target.value)} /> : <input className="input" value={v[k] ?? ""} onChange={(e) => set(k, e.target.value)} />}
          </Field>
        ))}
        {type === "wifi" && (
          <Field label="ความปลอดภัย"><Select value={v.security ?? "WPA"} onChange={(x) => set("security", x)} options={["WPA", "WEP", "nopass"]} /></Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="สีจุด"><input type="color" className="h-9 w-full" value={fg} onChange={(e) => setFg(e.target.value)} /></Field>
          <Field label="สีพื้น"><input type="color" className="h-9 w-full" value={bg} onChange={(e) => setBg(e.target.value)} /></Field>
        </div>
        <Slider label="ขนาด" value={size} min={128} max={1024} step={32} suffix=" px" onChange={setSize} />
        <Field label="โลโก้กลาง QR">
          <DropZone onFiles={(p) => setLogo(p[0])} accept={IMAGE_EXT} multiple={false} compact label={logo ? basename(logo) : "ลากโลโก้มาวาง"} />
        </Field>
      </div>
      <div className="space-y-2 text-center">
        <canvas ref={canvas} className="mx-auto w-full max-w-[300px] rounded-xl" />
        <button className="btn-primary w-full" onClick={() => saveCanvas(canvas.current!, "qrcode.png")}><Download size={14} /> บันทึก PNG</button>
      </div>
    </div>
  );
}

// ---------- บาร์โค้ด ----------
export function BarcodeMaker() {
  const svg = useRef<SVGSVGElement>(null);
  const [value, setValue] = useState("8850999000017");
  const [format, setFormat] = useState("EAN13");
  const [error, setError] = useState("");
  useEffect(() => {
    try {
      JsBarcode(svg.current, value, { format, lineColor: "#000", background: "#fff", width: 2, height: 90, displayValue: true, font: "JetBrains Mono" });
      setError("");
    } catch {
      setError("ข้อมูลไม่ตรงกับรูปแบบบาร์โค้ดนี้ (EAN-13 ต้องเป็นตัวเลข 12-13 หลัก)");
    }
  }, [value, format]);
  const save = async () => {
    const s = new XMLSerializer().serializeToString(svg.current!);
    const img = await loadImg(`data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(s)))}`);
    const c = document.createElement("canvas");
    c.width = img.width * 2;
    c.height = img.height * 2;
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    await saveCanvas(c, `barcode-${value}.png`);
  };
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="ข้อมูล"><input className="input font-mono" value={value} onChange={(e) => setValue(e.target.value)} /></Field>
        <Field label="รูปแบบ"><Select value={format} onChange={setFormat} options={["EAN13", "EAN8", "UPC", "CODE128", "CODE39", "ITF14", "codabar"]} /></Field>
      </div>
      {error && <p className="text-sm text-red-300">{error}</p>}
      <div className="rounded-xl bg-white p-4 text-center"><svg ref={svg} /></div>
      <button className="btn-primary w-full" disabled={!!error} onClick={save}><Download size={14} /> บันทึก PNG</button>
    </div>
  );
}

// ---------- สี ----------
const hex = (r: number, g: number, b: number) => "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
export function hexToHsl(h: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const hue = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [Math.round(hue * 60), Math.round(s * 100), Math.round(l * 100)];
}
const hsl = (h: number, s: number, l: number) => `hsl(${(h + 360) % 360} ${s}% ${l}%)`;
const CB: Record<string, string> = {
  protanopia: "0.567,0.433,0,0,0 0.558,0.442,0,0,0 0,0.242,0.758,0,0 0,0,0,1,0",
  deuteranopia: "0.625,0.375,0,0,0 0.7,0.3,0,0,0 0,0.3,0.7,0,0 0,0,0,1,0",
  tritanopia: "0.95,0.05,0,0,0 0,0.433,0.567,0,0 0,0.475,0.525,0,0 0,0,0,1,0",
  achromatopsia: "0.299,0.587,0.114,0,0 0.299,0.587,0.114,0,0 0.299,0.587,0.114,0,0 0,0,0,1,0",
};

export function ColorTools() {
  const toast = useApp((s) => s.toast);
  const [color, setColor] = useState("#a855f7");
  const [img, setImg] = useState("");
  const [palette, setPalette] = useState<string[]>([]);
  const [cb, setCb] = useState("none");
  const imgRef = useRef<HTMLImageElement>(null);
  const [h, s, l] = hexToHsl(color);
  const pick = async () => {
    if (!("EyeDropper" in window)) return toast("เครื่องนี้ไม่รองรับการดูดสีจากหน้าจอ", "error");
    const r = await new (window as any).EyeDropper().open().catch(() => null);
    if (r) setColor(r.sRGBHex);
  };
  const extract = () => {
    const el = imgRef.current;
    if (!el) return;
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(el, 0, 0, 64, 64);
    const d = ctx.getImageData(0, 0, 64, 64).data;
    const buckets = new Map<string, number>();
    for (let i = 0; i < d.length; i += 4) {
      const k = hex(Math.round(d[i] / 32) * 32 > 255 ? 255 : Math.round(d[i] / 32) * 32, Math.min(255, Math.round(d[i + 1] / 32) * 32), Math.min(255, Math.round(d[i + 2] / 32) * 32));
      buckets.set(k, (buckets.get(k) ?? 0) + 1);
    }
    setPalette([...buckets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k]) => k));
  };
  const harmonies = {
    "สีตรงข้าม": [hsl(h, s, l), hsl(h + 180, s, l)],
    "สามเหลี่ยม": [hsl(h, s, l), hsl(h + 120, s, l), hsl(h + 240, s, l)],
    "ใกล้เคียง": [hsl(h - 30, s, l), hsl(h, s, l), hsl(h + 30, s, l)],
    "ไล่เฉด": [15, 30, 45, 60, 75, 90].map((x) => hsl(h, s, x)),
  };
  const copy = (t: string) => { navigator.clipboard.writeText(t); toast(`คัดลอก ${t}`); };
  return (
    <div className="space-y-4">
      <svg width="0" height="0" className="absolute">
        {Object.entries(CB).map(([k, m]) => <filter key={k} id={`cb-${k}`}><feColorMatrix type="matrix" values={m} /></filter>)}
      </svg>
      <div className="flex flex-wrap items-center gap-3">
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-16 w-16" />
        <button className="btn" onClick={pick}><Pipette size={14} /> ดูดสีจากหน้าจอ</button>
        <div className="font-mono text-sm">
          {[color, `hsl(${h}, ${s}%, ${l}%)`, `rgb(${[1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)).join(", ")})`].map((t) => (
            <div key={t} className="cursor-pointer hover:text-accent2" onClick={() => copy(t)}>{t}</div>
          ))}
        </div>
      </div>
      {Object.entries(harmonies).map(([name, cols]) => (
        <div key={name}>
          <div className="label">{name}</div>
          <div className="flex gap-1">
            {cols.map((c, i) => <div key={i} onClick={() => copy(c)} title={c} className="h-10 flex-1 cursor-pointer rounded-lg" style={{ background: c }} />)}
          </div>
        </div>
      ))}
      <div className="divider pt-4">
        <div className="label">จานสีจากรูป + จำลองการมองเห็นของคนตาบอดสี</div>
        <DropZone onFiles={(p) => setImg(p[0])} accept={IMAGE_EXT} multiple={false} compact label="ลากรูปมาวาง" />
        {img && (
          <div className="mt-3 space-y-2">
            <Select value={cb} onChange={setCb} options={[{ value: "none", label: "การมองเห็นปกติ" }, { value: "protanopia", label: "ตาบอดสีแดง (Protanopia)" }, { value: "deuteranopia", label: "ตาบอดสีเขียว (Deuteranopia)" }, { value: "tritanopia", label: "ตาบอดสีน้ำเงิน (Tritanopia)" }, { value: "achromatopsia", label: "ไม่เห็นสี (Achromatopsia)" }]} />
            <img ref={imgRef} src={fileUrl(img)} crossOrigin="anonymous" onLoad={extract} className="max-h-72 rounded-xl" style={{ filter: cb === "none" ? undefined : `url(#cb-${cb})` }} alt="" />
            <div className="flex gap-1">
              {palette.map((c) => <div key={c} onClick={() => copy(c)} className="h-12 flex-1 cursor-pointer rounded-lg text-center font-mono text-[10px] leading-[3rem] text-white mix-blend-normal" style={{ background: c }}>{c}</div>)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- ฟอนต์ ----------
export function FontPreview() {
  const [text, setText] = useState("สวัสดีครับ มีเดียทูลบ็อกซ์ ๑๒๓ 123 ABC");
  const [size, setSize] = useState(32);
  const [fonts, setFonts] = useState<string[]>(["IBM Plex Sans Thai", "Prompt", "Sarabun", "JetBrains Mono", "Tahoma", "Leelawadee UI", "Segoe UI", "Angsana New", "Cordia New", "TH Sarabun New"]);
  const [custom, setCustom] = useState("");
  const loadLocal = async () => {
    // API นี้มีใน WebView2 รุ่นใหม่ (อาจขออนุญาต)
    const q = (window as any).queryLocalFonts;
    if (!q) return useApp.getState().toast("เครื่องนี้ไม่รองรับการอ่านรายชื่อฟอนต์ทั้งหมด พิมพ์ชื่อฟอนต์เองได้", "error");
    const list: { family: string }[] = await q().catch(() => []);
    setFonts([...new Set(list.map((f) => f.family))]);
  };
  const loadFile = async (p: string) => {
    const name = basename(p).replace(/\.[^.]+$/, "");
    const face = new FontFace(name, `url(${fileUrl(p)})`);
    await face.load();
    (document.fonts as any).add(face);
    setFonts((f) => [name, ...f]);
  };
  return (
    <div className="space-y-3">
      <Field label="ข้อความตัวอย่าง"><input className="input" value={text} onChange={(e) => setText(e.target.value)} /></Field>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1"><Slider label="ขนาด" value={size} min={12} max={96} suffix=" px" onChange={setSize} /></div>
        <button className="btn" onClick={loadLocal}>ฟอนต์ทั้งหมดในเครื่อง</button>
        <input className="input w-40" placeholder="ชื่อฟอนต์อื่น" value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => e.key === "Enter" && custom && setFonts([custom, ...fonts])} />
      </div>
      <DropZone onFiles={(p) => p.forEach(loadFile)} accept={["ttf", "otf", "woff", "woff2"]} compact label="ลากไฟล์ฟอนต์ (.ttf .otf) มาดูตัวอย่าง" />
      <div className="max-h-[55vh] space-y-2 overflow-auto">
        {fonts.map((f) => (
          <div key={f} className="rounded-xl bg-fg/[.03] p-3">
            <div className="text-xs text-muted">{f}</div>
            <div style={{ fontFamily: `"${f}"`, fontSize: size }} className="selectable leading-snug">{text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- favicon ----------
const ICON_SIZES = [16, 32, 48, 64, 128, 180, 192, 256, 512];
export function FaviconMaker() {
  const [src, setSrc] = useState("");
  const [emoji, setEmoji] = useState("🎬");
  const [bg, setBg] = useState("#7c3aed");
  const [round, setRound] = useState(22);
  const render = async (size: number) => {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d")!;
    ctx.beginPath();
    ctx.roundRect(0, 0, size, size, (round / 100) * size);
    ctx.clip();
    if (src) {
      const img = await loadImg(fileUrl(src));
      const s = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
    } else {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, size, size);
      ctx.font = `${size * 0.7}px "Segoe UI Emoji"`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(emoji, size / 2, size * 0.55);
    }
    return c;
  };
  const [preview, setPreview] = useState<string[]>([]);
  useEffect(() => {
    Promise.all([16, 32, 64, 128].map(render)).then((cs) => setPreview(cs.map((c) => c.toDataURL())));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, emoji, bg, round]);
  const exportAll = async () => {
    const dir = joinPath(useApp.getState().settings?.downloadDir ?? "", "ไอคอน", `icon-${Date.now()}`);
    for (const s of ICON_SIZES) {
      const c = await render(s);
      await call("write_base64_file", { path: joinPath(dir, `icon-${s}.png`), data: c.toDataURL("image/png").split(",")[1] });
    }
    // รวมเป็น .ico ด้วย ffmpeg
    await api.ffmpegExec(["-y", "-i", joinPath(dir, "icon-256.png"), "-vf", "scale=256:256", joinPath(dir, "favicon.ico")]).catch(() => {});
    await call("write_text_file", { path: joinPath(dir, "site.webmanifest"), content: JSON.stringify({ icons: [192, 512].map((s) => ({ src: `icon-${s}.png`, sizes: `${s}x${s}`, type: "image/png" })) }, null, 2) });
    useApp.getState().toast(`สร้างไอคอน ${ICON_SIZES.length} ขนาด + favicon.ico แล้ว`, "success");
    (await import("@/lib/api")).revealPath(joinPath(dir, "favicon.ico"));
  };
  return (
    <div className="space-y-3">
      <DropZone onFiles={(p) => setSrc(p[0])} accept={IMAGE_EXT} multiple={false} compact label={src ? basename(src) : "ลากรูปมาวาง หรือใช้อีโมจิด้านล่าง"} />
      {src && <button className="btn btn-sm" onClick={() => setSrc("")}>ใช้อีโมจิแทน</button>}
      {!src && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="อีโมจิ / ตัวอักษร"><input className="input text-2xl" value={emoji} onChange={(e) => setEmoji(e.target.value)} /></Field>
          <Field label="สีพื้น"><input type="color" className="h-11 w-full" value={bg} onChange={(e) => setBg(e.target.value)} /></Field>
        </div>
      )}
      <Slider label="มุมโค้ง" value={round} min={0} max={50} suffix="%" onChange={setRound} />
      <div className="flex items-end gap-4 rounded-xl bg-fg/5 p-4">
        {preview.map((p, i) => <img key={i} src={p} width={[16, 32, 64, 128][i]} alt="" />)}
      </div>
      <button className="btn-primary w-full" onClick={exportAll}><Download size={14} /> ส่งออกทุกขนาด + .ico</button>
    </div>
  );
}

// ---------- ตกแต่งภาพหน้าจอ ----------
const GRADIENTS = [["#a855f7", "#22d3ee"], ["#f97316", "#ec4899"], ["#10b981", "#3b82f6"], ["#1e1b4b", "#0f172a"], ["#fde68a", "#f472b6"], ["#ffffff", "#e5e7eb"]];
export function ScreenshotBeautifier() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [src, setSrc] = useState("");
  const [pad, setPad] = useState(64);
  const [radius, setRadius] = useState(16);
  const [shadow, setShadow] = useState(40);
  const [grad, setGrad] = useState(0);
  const [frame, setFrame] = useState(true);
  useEffect(() => {
    (async () => {
      const c = canvas.current!;
      const ctx = c.getContext("2d")!;
      const img = src ? await loadImg(fileUrl(src)).catch(() => null) : null;
      const w = img?.width ?? 800;
      const h = img?.height ?? 450;
      const bar = frame ? 32 : 0;
      c.width = w + pad * 2;
      c.height = h + bar + pad * 2;
      const g = ctx.createLinearGradient(0, 0, c.width, c.height);
      g.addColorStop(0, GRADIENTS[grad][0]);
      g.addColorStop(1, GRADIENTS[grad][1]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,.45)";
      ctx.shadowBlur = shadow;
      ctx.shadowOffsetY = shadow / 3;
      ctx.beginPath();
      ctx.roundRect(pad, pad, w, h + bar, radius);
      ctx.fillStyle = "#1f2937";
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(pad, pad, w, h + bar, radius);
      ctx.clip();
      if (frame) {
        ctx.fillStyle = "#2d2d3a";
        ctx.fillRect(pad, pad, w, bar);
        ["#ff5f57", "#febc2e", "#28c840"].forEach((col, i) => {
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.arc(pad + 18 + i * 20, pad + bar / 2, 6, 0, Math.PI * 2);
          ctx.fill();
        });
      }
      if (img) ctx.drawImage(img, pad, pad + bar);
      else {
        ctx.fillStyle = "#9ca3af";
        ctx.font = "24px Prompt";
        ctx.textAlign = "center";
        ctx.fillText("ลากภาพหน้าจอมาวาง", pad + w / 2, pad + bar + h / 2);
      }
      ctx.restore();
    })();
  }, [src, pad, radius, shadow, grad, frame]);
  return (
    <div className="grid gap-4 md:grid-cols-[1fr_260px]">
      <canvas ref={canvas} className="max-h-[60vh] w-full rounded-xl object-contain" />
      <div className="space-y-3">
        <DropZone onFiles={(p) => setSrc(p[0])} accept={IMAGE_EXT} multiple={false} compact label="ลากภาพหน้าจอ" />
        <div className="flex flex-wrap gap-1.5">
          {GRADIENTS.map((g, i) => <button key={i} onClick={() => setGrad(i)} className={`h-8 w-8 rounded-full ${grad === i ? "ring-2 ring-white" : ""}`} style={{ background: `linear-gradient(135deg, ${g[0]}, ${g[1]})` }} />)}
        </div>
        <Slider label="ขอบ" value={pad} min={0} max={200} onChange={setPad} />
        <Slider label="มุมโค้ง" value={radius} min={0} max={40} onChange={setRadius} />
        <Slider label="เงา" value={shadow} min={0} max={100} onChange={setShadow} />
        <Toggle label="กรอบหน้าต่าง" checked={frame} onChange={setFrame} />
        <button className="btn-primary w-full" onClick={() => saveCanvas(canvas.current!, "screenshot-สวย.png")}><Download size={14} /> บันทึก</button>
      </div>
    </div>
  );
}

// ---------- อัตราส่วน ----------
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
export function AspectCalc() {
  const [w, setW] = useState(1920);
  const [h, setH] = useState(1080);
  const [newW, setNewW] = useState(1280);
  const g = gcd(Math.round(w), Math.round(h)) || 1;
  const presets = [["16:9", 16, 9], ["9:16", 9, 16], ["4:3", 4, 3], ["1:1", 1, 1], ["4:5", 4, 5], ["21:9", 21, 9], ["2.39:1", 2.39, 1]] as const;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="กว้าง"><input type="number" className="input" value={w} onChange={(e) => setW(Number(e.target.value))} /></Field>
        <Field label="สูง"><input type="number" className="input" value={h} onChange={(e) => setH(Number(e.target.value))} /></Field>
      </div>
      <div className="text-center"><span className="font-mono text-4xl gradient-text">{w / g}:{h / g}</span> <span className="text-muted">({(w / h).toFixed(3)})</span></div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="ถ้ากว้างเป็น"><input type="number" className="input" value={newW} onChange={(e) => setNewW(Number(e.target.value))} /></Field>
        <Field label="สูงจะเป็น"><div className="input font-mono">{Math.round((newW * h) / w)} <span className="text-xs text-muted">(เลขคู่: {Math.round((newW * h) / w / 2) * 2})</span></div></Field>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {presets.map(([n, a, b]) => <button key={n} className="chip hover:bg-accent/40" onClick={() => setH(Math.round((w * b) / a))}>{n}</button>)}
      </div>
      <div className="grid place-items-center rounded-xl bg-fg/5 p-4">
        <div className="bg-gradient-to-br from-accent to-accent2" style={{ width: w >= h ? 240 : (240 * w) / h, height: w >= h ? (240 * h) / w : 240 }} />
      </div>
    </div>
  );
}

export { Upload };
