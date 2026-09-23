// หน้า 13: ความปลอดภัย
import { useEffect, useState } from "react";
import { Shield, Lock, Unlock, Flame, EyeOff, Stamp, KeyRound, AlertTriangle, ScrollText } from "lucide-react";
import { Card, DropZone, Field, PageHeader, Select, Slider, Tabs, Toggle } from "@/components/ui";
import { api, call, confirmDialog, revealPath, type LogItem } from "@/lib/api";
import { attempt, useApp } from "@/store/app";
import { basename, extname, formatDate, IMAGE_EXT, outputPath } from "@/lib/format";
import { buildConvertArgs, buildStripMeta, defaultConvert } from "@/lib/ffmpeg";
import { strength } from "./tools/TextTools";

type Tab = "encrypt" | "shred" | "meta" | "watermark" | "access";

export default function Security() {
  const [tab, setTab] = useState<Tab>("encrypt");
  return (
    <div>
      <PageHeader
        title="ความปลอดภัย"
        subtitle="เข้ารหัส AES-256 · ลบถาวร · ลบ EXIF/GPS · ลายน้ำ · PIN"
        icon={<Shield />}
        actions={<button className="btn-danger" onClick={() => call("panic_hide")}><EyeOff size={15} /> ซ่อนทันที (Ctrl+Shift+H)</button>}
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "encrypt", label: "🔐 เข้ารหัส" },
          { id: "shred", label: "🔥 ลบถาวร" },
          { id: "meta", label: "🧹 ลบข้อมูลเมตา" },
          { id: "watermark", label: "💧 ลายน้ำ" },
          { id: "access", label: "🔑 PIN และการเข้าใช้" },
        ]}
      />
      {tab === "encrypt" && <Encrypt />}
      {tab === "shred" && <Shred />}
      {tab === "meta" && <StripMeta />}
      {tab === "watermark" && <Watermark />}
      {tab === "access" && <Access />}
    </div>
  );
}

function Encrypt() {
  const [files, setFiles] = useState<string[]>([]);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string[]>([]);
  const decrypt = files.length > 0 && files.every((f) => f.toLowerCase().endsWith(".mtbx"));
  const st = strength(pw);
  const run = async () => {
    if (!decrypt && pw !== pw2) return useApp.getState().toast("รหัสผ่านทั้งสองช่องไม่ตรงกัน", "error");
    setBusy(true);
    const out: string[] = [];
    for (const f of files) {
      const r = await attempt(() => call<string>("encrypt_file", { src: f, password: pw, decrypt }));
      if (r) out.push(r);
    }
    setBusy(false);
    setDone(out);
    if (out.length) {
      useApp.getState().toast(`${decrypt ? "ถอดรหัส" : "เข้ารหัส"}สำเร็จ ${out.length} ไฟล์`, "success");
      if (!decrypt) useApp.getState().unlock("secure");
    }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={decrypt ? "ถอดรหัสไฟล์ (.mtbx)" : "เข้ารหัสไฟล์ด้วย AES-256-GCM"}>
        <DropZone onFiles={(p) => { setFiles(p); setDone([]); }} compact label={files.length ? `${files.length} ไฟล์: ${files.map(basename).join(", ")}` : "ลากไฟล์มาวาง (ไฟล์ .mtbx = ถอดรหัส)"} />
        <div className="mt-3 space-y-2">
          <Field label="รหัสผ่าน">
            <input type={show ? "text" : "password"} className="input" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
          </Field>
          {!decrypt && (
            <>
              <Field label="ยืนยันรหัสผ่าน"><input type={show ? "text" : "password"} className="input" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" /></Field>
              {pw && <div className="text-xs text-muted">ความแข็งแรง: {st.label}</div>}
            </>
          )}
          <Toggle label="แสดงรหัสผ่าน" checked={show} onChange={setShow} />
          <button className="btn-primary w-full" disabled={!files.length || pw.length < 4 || busy} onClick={run}>
            {decrypt ? <Unlock size={15} /> : <Lock size={15} />} {busy ? "กำลังทำงาน…" : decrypt ? "ถอดรหัส" : "เข้ารหัส"}
          </button>
        </div>
      </Card>
      <Card title="ข้อควรรู้">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted">
          <li>ใช้ AES-256-GCM + สร้างกุญแจจากรหัสผ่านด้วย PBKDF2 ไฟล์ที่ได้จะลงท้ายด้วย <b>.mtbx</b></li>
          <li className="text-amber-300">⚠️ ถ้าลืมรหัสผ่าน จะไม่มีทางกู้ไฟล์คืนได้เลย</li>
          <li>ไฟล์ต้นฉบับจะไม่ถูกลบ — ถ้าต้องการลบให้ใช้แท็บ "ลบถาวร"</li>
          <li>ส่งไฟล์ .mtbx ให้คนอื่นได้ เขาต้องใช้มีเดียทูลบ็อกซ์และรหัสผ่านเดียวกันถอดรหัส</li>
        </ul>
        {done.length > 0 && (
          <div className="mt-3 space-y-1">
            {done.map((d) => <button key={d} className="block truncate text-left text-sm text-accent2 hover:underline" onClick={() => revealPath(d)}>📁 {basename(d)}</button>)}
          </div>
        )}
      </Card>
    </div>
  );
}

function Shred() {
  const [files, setFiles] = useState<string[]>([]);
  const [passes, setPasses] = useState(3);
  const run = async () => {
    if (!(await confirmDialog(`ลบถาวร ${files.length} ไฟล์ (เขียนทับ ${passes} รอบ)\nกู้คืนไม่ได้อีก ยืนยันหรือไม่?`, "ลบถาวร"))) return;
    const n = await attempt(() => call<number>("shred_files", { paths: files, passes }));
    if (n !== undefined) {
      useApp.getState().toast(`ลบถาวรแล้ว ${n} ไฟล์`, "success");
      setFiles([]);
    }
  };
  return (
    <Card title="ลบไฟล์ถาวร (เขียนทับข้อมูลก่อนลบ)">
      <DropZone onFiles={setFiles} compact label={files.length ? `${files.length} ไฟล์` : "ลากไฟล์ที่ต้องการลบถาวร"} />
      <div className="mt-2 max-h-40 overflow-auto text-sm">{files.map((f) => <div key={f} className="truncate text-muted">🗑️ {f}</div>)}</div>
      <Slider label="จำนวนรอบการเขียนทับ" value={passes} min={1} max={7} onChange={setPasses} suffix=" รอบ" />
      <p className="my-2 flex items-center gap-1 text-xs text-amber-300"><AlertTriangle size={13} /> บน SSD การเขียนทับอาจไม่ได้ลบข้อมูลทุกบล็อก (เพราะ wear-leveling) ควรใช้ร่วมกับ BitLocker</p>
      <button className="btn-danger w-full" disabled={!files.length} onClick={run}><Flame size={15} /> ลบถาวร</button>
    </Card>
  );
}

function StripMeta() {
  const [files, setFiles] = useState<string[]>([]);
  const [info, setInfo] = useState<Record<string, [string, string][]>>({});
  useEffect(() => {
    files.slice(0, 20).forEach(async (f) => {
      const p = await api.probe(f).catch(() => null);
      const tags: Record<string, string> = { ...(p?.format?.tags ?? {}), ...(p?.streams?.[0]?.tags ?? {}) };
      setInfo((i) => ({ ...i, [f]: Object.entries(tags) }));
    });
  }, [files]);
  const run = async () => {
    for (const f of files) {
      const out = outputPath(f, extname(f) === "heic" ? "jpg" : extname(f), "-clean");
      await api.ffmpegJob({ kind: "convert", title: `ลบเมตา ${basename(f)}`, input: f, output: out, passes: [buildStripMeta(f, out)] });
    }
    useApp.getState().toast(`เพิ่ม ${files.length} งานเข้าคิว — ไฟล์ใหม่จะลงท้ายด้วย -clean`, "success");
  };
  return (
    <Card title="ลบข้อมูลเมตา (EXIF / GPS / ชื่อกล้อง / ผู้สร้าง)">
      <DropZone onFiles={(p) => { setInfo({}); setFiles(p); }} compact label="ลากรูป/วิดีโอ/เสียงมาวาง" />
      <div className="mt-3 max-h-[45vh] space-y-2 overflow-auto">
        {files.map((f) => {
          const tags = info[f] ?? [];
          const gps = tags.some(([k]) => /gps|location/i.test(k));
          return (
            <div key={f} className="rounded-lg bg-fg/5 p-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="flex-1 truncate">{basename(f)}</span>
                {gps && <span className="chip bg-red-500/30">📍 มีพิกัด GPS</span>}
                <span className="chip">{tags.length} รายการ</span>
              </div>
              {tags.length > 0 && <div className="mt-1 truncate text-xs text-muted">{tags.slice(0, 6).map(([k, v]) => `${k}: ${v}`).join(" · ")}</div>}
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-muted">รูป JPG/PNG/WEBP จะถูกบันทึกใหม่ (คุณภาพ 95) · วิดีโอ/เสียงคัดลอกสตรีมโดยไม่เสียคุณภาพ</p>
      <button className="btn-primary mt-3 w-full" disabled={!files.length} onClick={run}>🧹 ลบข้อมูลเมตา {files.length} ไฟล์</button>
    </Card>
  );
}

function Watermark() {
  const [files, setFiles] = useState<string[]>([]);
  const [text, setText] = useState("© ของฉัน");
  const [image, setImage] = useState("");
  const [pos, setPos] = useState<typeof defaultConvert.watermarkPos>("br");
  const run = async () => {
    for (const f of files) {
      const ext = extname(f);
      const isImg = IMAGE_EXT.includes(ext);
      const fmt = isImg ? (ext === "heic" ? "jpg" : ext === "jpeg" ? "jpg" : ext) : "mp4";
      const out = outputPath(f, fmt, "-watermark");
      const args = buildConvertArgs(f, out, { ...defaultConvert, format: fmt, watermarkText: image ? "" : text, watermarkImage: image, watermarkPos: pos, imageQuality: 92 });
      await api.ffmpegJob({ kind: "convert", title: `ลายน้ำ ${basename(f)}`, input: f, output: out, passes: [args] });
    }
    useApp.getState().toast(`เพิ่ม ${files.length} งานเข้าคิวแล้ว`, "success");
  };
  return (
    <Card title="ใส่ลายน้ำรูป/วิดีโอ (แบบกลุ่ม)">
      <div className="grid gap-4 md:grid-cols-2">
        <DropZone onFiles={setFiles} compact label={files.length ? `${files.length} ไฟล์` : "ลากรูป/วิดีโอมาวาง"} />
        <div className="space-y-2">
          <Field label="ข้อความลายน้ำ"><input className="input" value={text} disabled={!!image} onChange={(e) => setText(e.target.value)} /></Field>
          <Field label="หรือใช้รูปโลโก้ (PNG โปร่งใส)">
            <DropZone onFiles={(p) => setImage(p[0])} accept={["png", "webp", "jpg"]} multiple={false} compact label={image ? basename(image) : "ลากโลโก้"} />
          </Field>
          {image && <button className="btn btn-sm" onClick={() => setImage("")}>ใช้ข้อความแทน</button>}
          <Field label="ตำแหน่ง">
            <Select value={pos} onChange={setPos} options={[{ value: "tl", label: "มุมซ้ายบน" }, { value: "tr", label: "มุมขวาบน" }, { value: "bl", label: "มุมซ้ายล่าง" }, { value: "br", label: "มุมขวาล่าง" }, { value: "center", label: "กลางภาพ" }]} />
          </Field>
        </div>
      </div>
      <button className="btn-primary mt-3 w-full" disabled={!files.length || (!text && !image)} onClick={run}><Stamp size={15} /> ใส่ลายน้ำ</button>
    </Card>
  );
}

function Access() {
  const settings = useApp((s) => s.settings)!;
  const saveSettings = useApp((s) => s.saveSettings);
  const [pin, setPin] = useState("");
  const [logs, setLogs] = useState<LogItem[]>([]);
  const hasPin = !!settings.pinHash;
  useEffect(() => {
    call<LogItem[]>("list_logs", { limit: 1000 }).then((l) => setLogs(l.filter((x) => x.source === "access"))).catch(() => {});
  }, [settings.pinHash]);
  const applyPin = async (value: string) => {
    const ok = await attempt(() => call("set_pin", { pin: value }).then(() => true), value ? "ตั้ง PIN แล้ว" : "ยกเลิก PIN แล้ว");
    if (ok) {
      useApp.setState({ settings: await api.getSettings() });
      setPin("");
    }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={<span className="flex items-center gap-2"><KeyRound size={16} /> PIN ก่อนเข้าโปรแกรม</span>}>
        <p className="mb-2 text-sm text-muted">สถานะ: {hasPin ? <b className="text-lime-300">เปิดใช้งาน</b> : <b>ยังไม่ได้ตั้ง</b>}</p>
        <div className="flex gap-2">
          <input type="password" inputMode="numeric" className="input font-mono tracking-widest" placeholder="ตัวเลข 4 หลักขึ้นไป" value={pin} maxLength={12} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
          <button className="btn-primary" disabled={pin.length < 4} onClick={() => applyPin(pin)}>{hasPin ? "เปลี่ยน PIN" : "ตั้ง PIN"}</button>
        </div>
        {hasPin && (
          <div className="mt-3 flex gap-2">
            <button className="btn" onClick={() => useApp.getState().setLocked(true)}><Lock size={14} /> ล็อกตอนนี้ (Ctrl+L)</button>
            <button className="btn text-red-300" onClick={() => applyPin("")}>ยกเลิก PIN</button>
          </div>
        )}
        <div className="mt-4">
          <Slider label="ล็อกอัตโนมัติเมื่อไม่ได้ใช้งาน" value={settings.autoLockMinutes} min={0} max={60} suffix=" นาที" format={(v) => (v === 0 ? "ปิด" : `${v} นาที`)} onChange={(v) => saveSettings({ autoLockMinutes: v })} />
          {!hasPin && settings.autoLockMinutes > 0 && <p className="text-xs text-amber-300">ต้องตั้ง PIN ก่อน การล็อกอัตโนมัติจึงจะทำงาน</p>}
        </div>
      </Card>
      <Card title={<span className="flex items-center gap-2"><ScrollText size={16} /> บันทึกการเข้าใช้</span>}>
        <div className="max-h-[50vh] space-y-1 overflow-auto text-sm">
          {logs.length === 0 && <p className="text-muted">ยังไม่มีบันทึก</p>}
          {logs.map((l) => (
            <div key={l.id} className="flex gap-2">
              <span className={l.level === "warn" ? "text-red-300" : "text-lime-300"}>{l.level === "warn" ? "✗" : "✓"}</span>
              <span className="flex-1">{l.message}</span>
              <span className="text-xs text-muted">{formatDate(l.createdAt)}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
