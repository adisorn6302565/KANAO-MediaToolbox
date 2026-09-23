// หน้า 8: ซิงก์คลาวด์ (rclone / แชร์ LAN + QR / FTP / P2P)
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Cloud, Upload, RefreshCw, Wifi, Server, Link2, Copy, Send, Download, Trash2 } from "lucide-react";
import { Card, DropZone, Empty, Field, PageHeader, Select, Tabs, Progress } from "@/components/ui";
import { call, pickFiles, pickFolder, type ServerStatus } from "@/lib/api";
import { attempt, useApp } from "@/store/app";
import { useKv } from "@/hooks/useData";
import { basename, formatBytes, formatDate, joinPath } from "@/lib/format";

type Tab = "rclone" | "lan" | "ftp" | "p2p";

export default function CloudSync() {
  const [tab, setTab] = useState<Tab>("rclone");
  return (
    <div>
      <PageHeader title="ซิงก์คลาวด์" subtitle="อัปโหลดผ่าน rclone · แชร์ผ่าน LAN ด้วย QR · FTP · ส่งไฟล์ P2P" icon={<Cloud />} />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "rclone", label: "คลาวด์ (rclone)" },
          { id: "lan", label: "แชร์ LAN + QR" },
          { id: "ftp", label: "FTP Server" },
          { id: "p2p", label: "ส่งไฟล์ P2P" },
        ]}
      />
      {tab === "rclone" && <Rclone />}
      {tab === "lan" && <LanShare />}
      {tab === "ftp" && <Ftp />}
      {tab === "p2p" && <P2P />}
    </div>
  );
}

export function QR({ text, size = 200 }: { text: string; size?: number }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    if (text) QRCode.toDataURL(text, { width: size, margin: 1, errorCorrectionLevel: "M" }).then(setSrc);
  }, [text, size]);
  return src ? <img src={src} width={size} height={size} className="rounded-xl bg-white p-2" alt="QR" /> : null;
}

// ---------- rclone ----------
const PROVIDERS = ["Google Drive", "Dropbox", "OneDrive", "Mega", "pCloud", "Amazon S3", "Cloudflare R2", "Backblaze B2", "FTP", "SFTP", "WebDAV"];

interface SyncLog {
  at: number;
  text: string;
  ok: boolean;
}

function Rclone() {
  const toast = useApp((s) => s.toast);
  const [remotes, setRemotes] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [remote, setRemote] = useState("");
  const [folder, setFolder] = useState("MediaToolbox");
  const [queue, setQueue] = useState<{ path: string; status: "wait" | "up" | "done" | "fail" }[]>([]);
  const [logs, setLogs] = useKv<SyncLog[]>("cloud.logs", []);
  const [syncDir, setSyncDir] = useState("");
  const [shareLink, setShareLink] = useState("");
  const [running, setRunning] = useState(false);
  const [missing, setMissing] = useState(false);
  const [installing, setInstalling] = useState(false);

  const install = async () => {
    setInstalling(true);
    const v = await attempt(() => call<string>("install_rclone"));
    setInstalling(false);
    if (v) {
      toast(`ติดตั้ง ${v} แล้ว`, "success");
      load();
    }
  };

  const load = async () => {
    try {
      const out = await call<string>("run_rclone", { args: ["listremotes"] });
      const list = out.split(/\r?\n/).map((s) => s.trim().replace(/:$/, "")).filter(Boolean);
      setRemotes(list);
      setRemote((r) => r || list[0] || "");
      setMissing(false);
      setError(list.length ? "" : "ยังไม่ได้เชื่อมบัญชีคลาวด์ — กด \"เชื่อมบัญชีคลาวด์\" แล้วทำตามขั้นตอนในหน้าต่างที่เปิดขึ้น (ตั้งเสร็จกด รีเฟรช)");
    } catch (e) {
      setMissing(String(e).includes("ติดตั้ง rclone"));
      setError(String(e));
    }
  };
  useEffect(() => {
    load();
  }, []);
  const log = (text: string, ok: boolean) => setLogs((l) => [{ at: Date.now(), text, ok }, ...l].slice(0, 200));

  const upload = async () => {
    setRunning(true);
    for (let i = 0; i < queue.length; i++) {
      if (queue[i].status === "done") continue;
      setQueue((q) => q.map((x, k) => (k === i ? { ...x, status: "up" } : x)));
      try {
        await call("run_rclone", { args: ["copy", queue[i].path, `${remote}:${folder}`] });
        setQueue((q) => q.map((x, k) => (k === i ? { ...x, status: "done" } : x)));
        log(`อัปโหลด ${basename(queue[i].path)} → ${remote}:${folder}`, true);
      } catch (e) {
        setQueue((q) => q.map((x, k) => (k === i ? { ...x, status: "fail" } : x)));
        log(`${basename(queue[i].path)}: ${String(e)}`, false);
      }
    }
    setRunning(false);
    toast("อัปโหลดเสร็จแล้ว", "success");
  };
  const sync = async () => {
    setRunning(true);
    const r = await attempt(() => call("run_rclone", { args: ["copy", syncDir, `${remote}:${folder}/${basename(syncDir)}`] }), "ซิงก์โฟลเดอร์เสร็จแล้ว");
    log(`ซิงก์ ${syncDir} → ${remote}:${folder}`, r !== undefined);
    setRunning(false);
  };
  const makeLink = async (name: string) => {
    const l = await attempt(() => call<string>("run_rclone", { args: ["link", `${remote}:${folder}/${name}`] }));
    if (l) setShareLink(l.trim());
  };

  const done = queue.filter((q) => q.status === "done").length;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <Card title="ผู้ให้บริการ" actions={<button className="btn btn-sm" onClick={load}><RefreshCw size={13} /> โหลดใหม่</button>}>
          {error && <div className="mb-2 rounded-lg bg-amber-500/15 p-2 text-sm text-amber-200">{error}</div>}
          <div className="mb-2 flex flex-wrap gap-2">
            {missing ? (
              <button className="btn-primary" disabled={installing} onClick={install}>{installing ? "กำลังดาวน์โหลด rclone (~25 MB)…" : "⬇️ ติดตั้ง rclone (ฟรี จาก rclone.org)"}</button>
            ) : (
              <>
                <button className="btn btn-sm" onClick={() => attempt(() => call("rclone_config"))}>🔗 เชื่อมบัญชีคลาวด์</button>
                <button className="btn btn-sm" onClick={load}>🔄 รีเฟรช</button>
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {remotes.map((r) => (
              <button key={r} className={remote === r ? "tab-active" : "tab"} onClick={() => setRemote(r)}>☁️ {r}</button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">รองรับ: {PROVIDERS.join(" · ")}</p>
        </Card>
        <Card title={`คิวอัปโหลด (${done}/${queue.length})`} actions={queue.length > 0 && <button className="btn btn-sm" onClick={() => setQueue([])}>ล้าง</button>}>
          <DropZone onFiles={(p) => setQueue((q) => [...q, ...p.map((path) => ({ path, status: "wait" as const }))])} compact={queue.length > 0} label="ลากไฟล์ที่จะอัปโหลดมาวาง" />
          {queue.length > 0 && <div className="mt-2"><Progress value={(done / queue.length) * 100} /></div>}
          <div className="mt-2 max-h-72 space-y-1 overflow-auto">
            {queue.map((q) => (
              <div key={q.path} className="flex items-center gap-2 text-sm">
                <span>{{ wait: "⏳", up: "⬆️", done: "✅", fail: "⚠️" }[q.status]}</span>
                <span className="flex-1 truncate">{basename(q.path)}</span>
                {q.status === "done" && <button className="btn btn-sm" onClick={() => makeLink(basename(q.path))}><Link2 size={12} /> ลิงก์แชร์</button>}
              </div>
            ))}
          </div>
          {shareLink && (
            <div className="mt-3 flex items-center gap-3 rounded-xl bg-fg/5 p-3">
              <QR text={shareLink} size={96} />
              <input className="input text-xs" readOnly value={shareLink} />
              <button className="btn btn-sm" onClick={() => navigator.clipboard.writeText(shareLink)}><Copy size={12} /></button>
            </div>
          )}
        </Card>
      </div>
      <div className="space-y-4">
        <Card title="ปลายทาง">
          <div className="space-y-3">
            <Field label="โฟลเดอร์บนคลาวด์">
              <input className="input" value={folder} onChange={(e) => setFolder(e.target.value)} />
            </Field>
            <button className="btn-primary w-full" disabled={!remote || !queue.length || running} onClick={upload}><Upload size={15} /> อัปโหลดไป {remote || "…"}</button>
            <div className="divider pt-3">
              <Field label="ซิงก์ทั้งโฟลเดอร์ (คัดลอกเฉพาะไฟล์ใหม่/เปลี่ยน)">
                <button className="input truncate text-left text-xs" onClick={async () => { const d = await pickFolder(); if (d) setSyncDir(d); }}>{syncDir || "เลือกโฟลเดอร์…"}</button>
              </Field>
              <button className="btn mt-2 w-full" disabled={!remote || !syncDir || running} onClick={sync}><RefreshCw size={14} /> ซิงก์เลย</button>
            </div>
          </div>
        </Card>
        <Card title="บันทึกการซิงก์" actions={<button className="btn btn-sm" onClick={() => setLogs([])}><Trash2 size={12} /></button>}>
          <div className="max-h-64 space-y-1 overflow-auto text-xs">
            {logs.length === 0 && <p className="text-muted">ยังไม่มีบันทึก</p>}
            {logs.map((l, i) => (
              <div key={i} className={l.ok ? "" : "text-red-300"}>
                <span className="font-mono text-muted">{formatDate(l.at)}</span> {l.text}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ---------- แชร์ผ่าน LAN ----------
export function useServer() {
  const [status, setStatus] = useState<ServerStatus>({ running: false, url: "", root: "", port: 0 });
  useEffect(() => {
    call<ServerStatus>("server_status").then(setStatus).catch(() => {});
  }, []);
  const start = async (dir: string, port: number) => {
    const s = await attempt(() => call<ServerStatus>("start_server", { dir, port }), "เปิดเซิร์ฟเวอร์แล้ว");
    if (s) setStatus(s);
  };
  const stop = async () => setStatus(await call<ServerStatus>("stop_server"));
  return { status, start, stop };
}

function LanShare() {
  const settings = useApp((s) => s.settings);
  const { status, start, stop } = useServer();
  const [dir, setDir] = useState(settings?.downloadDir ?? "");
  const [files, setFiles] = useState<{ name: string; size: number }[]>([]);
  const [sel, setSel] = useState("");

  useEffect(() => {
    if (status.running) fetch(`${status.url}api/list`).then((r) => r.json()).then((l: [string, number][]) => setFiles(l.map(([name, size]) => ({ name, size })))).catch(() => setFiles([]));
  }, [status]);
  const link = sel ? `${status.url}files/${sel.split("/").map(encodeURIComponent).join("/")}` : status.url;

  // แชร์ไฟล์ชั่วคราว: คัดลอกเข้าโฟลเดอร์แชร์
  const shareFiles = async () => {
    const f = await pickFiles();
    if (!f.length) return;
    const target = joinPath(settings?.downloadDir ?? "", "แชร์");
    await attempt(() => call("move_files", { paths: f, dest: target, copy: true }));
    await start(target, 8787);
    setDir(target);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card title="แชร์ไฟล์ให้มือถือ (Wi-Fi เดียวกัน)">
        <div className="flex flex-wrap gap-2">
          <button className="input flex-1 truncate text-left text-xs" onClick={async () => { const d = await pickFolder(); if (d) setDir(d); }}>{dir || "เลือกโฟลเดอร์…"}</button>
          {status.running ? (
            <button className="btn-danger" onClick={stop}>ปิดการแชร์</button>
          ) : (
            <button className="btn-primary" disabled={!dir} onClick={() => start(dir, 8787)}><Wifi size={15} /> เริ่มแชร์</button>
          )}
          <button className="btn" onClick={shareFiles}><Upload size={14} /> แชร์ไฟล์ที่เลือก</button>
        </div>
        {status.running && (
          <div className="mt-3 max-h-96 overflow-auto">
            {files.map((f) => (
              <div key={f.name} onClick={() => setSel(f.name === sel ? "" : f.name)} className={`flex cursor-pointer justify-between rounded-lg px-2 py-1 text-sm ${sel === f.name ? "bg-accent/25" : "hover:bg-fg/5"}`}>
                <span className="truncate">{f.name}</span>
                <span className="font-mono text-xs text-muted">{formatBytes(f.size)}</span>
              </div>
            ))}
            {!files.length && <Empty text="ไม่พบไฟล์มีเดียในโฟลเดอร์นี้" />}
          </div>
        )}
      </Card>
      <Card>
        {status.running ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <QR text={link} size={220} />
            <div className="text-sm">{sel ? `สแกนเพื่อโหลด ${sel}` : "สแกนเพื่อเปิดรายการไฟล์"}</div>
            <div className="flex w-full gap-1">
              <input className="input text-xs" readOnly value={link} />
              <button className="btn btn-sm" onClick={() => navigator.clipboard.writeText(link)}><Copy size={12} /></button>
            </div>
            <p className="text-xs text-muted">ถ้ามือถือเปิดไม่ได้ ให้อนุญาตโปรแกรมใน Windows Firewall (เครือข่ายส่วนตัว)</p>
          </div>
        ) : (
          <Empty icon={<Wifi size={32} />} text="ยังไม่ได้เปิดการแชร์" />
        )}
      </Card>
    </div>
  );
}

// ---------- FTP ----------
function Ftp() {
  const settings = useApp((s) => s.settings);
  const [dir, setDir] = useState(settings?.downloadDir ?? "");
  const [port, setPort] = useState(2121);
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const toggle = async (start: boolean) => {
    const s = await attempt(() => call<ServerStatus>("ftp_control", { start, dir, port }), start ? "เปิด FTP แล้ว" : "ปิด FTP แล้ว");
    if (s) setStatus(s);
  };
  return (
    <Card>
      <div className="grid gap-4 md:grid-cols-[1fr_260px]">
        <div className="space-y-3">
          <Field label="โฟลเดอร์ที่แชร์">
            <button className="input truncate text-left text-xs" onClick={async () => { const d = await pickFolder(); if (d) setDir(d); }}>{dir || "เลือก…"}</button>
          </Field>
          <Field label="พอร์ต">
            <input type="number" className="input w-32" value={port} onChange={(e) => setPort(Number(e.target.value))} />
          </Field>
          {status?.running ? (
            <button className="btn-danger" onClick={() => toggle(false)}>ปิด FTP Server</button>
          ) : (
            <button className="btn-primary" disabled={!dir} onClick={() => toggle(true)}><Server size={15} /> เปิด FTP Server</button>
          )}
          <p className="text-xs text-muted">โหมดอ่านอย่างเดียว ไม่ต้องใช้รหัสผ่าน (ผู้ใช้ anonymous) — เหมาะกับแอปไฟล์บนมือถือ, VLC, Kodi, Smart TV · ปิดทันทีเมื่อไม่ใช้</p>
        </div>
        {status?.running && (
          <div className="flex flex-col items-center gap-2">
            <QR text={status.url} />
            <code className="selectable text-sm">{status.url}</code>
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------- P2P (WebRTC ไม่ต้องมีเซิร์ฟเวอร์: แลกรหัสเชื่อมต่อด้วยการคัดลอก/วาง) ----------
const CHUNK = 64 * 1024;

async function gatherComplete(pc: RTCPeerConnection) {
  if (pc.iceGatheringState === "complete") return;
  await new Promise<void>((res) => {
    const t = setTimeout(res, 3000);
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState === "complete") {
        clearTimeout(t);
        res();
      }
    });
  });
}
const enc = (d: RTCSessionDescriptionInit) => btoa(unescape(encodeURIComponent(JSON.stringify(d))));
const dec = (s: string) => JSON.parse(decodeURIComponent(escape(atob(s.trim())))) as RTCSessionDescriptionInit;

function P2P() {
  const toast = useApp((s) => s.toast);
  const settings = useApp((s) => s.settings);
  const pc = useRef<RTCPeerConnection | null>(null);
  const ch = useRef<RTCDataChannel | null>(null);
  const [role, setRole] = useState<"send" | "receive">("send");
  const [myCode, setMyCode] = useState("");
  const [peerCode, setPeerCode] = useState("");
  const [state, setState] = useState("ยังไม่เชื่อมต่อ");
  const [progress, setProgress] = useState(0);
  const [received, setReceived] = useState<string[]>([]);
  const incoming = useRef<{ name: string; size: number; parts: ArrayBuffer[]; got: number } | null>(null);

  const setup = () => {
    pc.current?.close();
    const p = new RTCPeerConnection({ iceServers: [] }); // ใช้ได้ในวง LAN เดียวกัน ไม่ต้องออกเน็ต
    p.onconnectionstatechange = () => setState({ connected: "เชื่อมต่อแล้ว ✅", connecting: "กำลังเชื่อมต่อ…", failed: "เชื่อมต่อไม่สำเร็จ", disconnected: "หลุดการเชื่อมต่อ" }[p.connectionState as string] ?? p.connectionState);
    p.ondatachannel = (e) => bind(e.channel);
    pc.current = p;
    return p;
  };
  const bind = (c: RTCDataChannel) => {
    c.binaryType = "arraybuffer";
    ch.current = c;
    c.onmessage = async (e) => {
      if (typeof e.data === "string") {
        const m = JSON.parse(e.data);
        if (m.type === "meta") incoming.current = { name: m.name, size: m.size, parts: [], got: 0 };
        if (m.type === "end" && incoming.current) {
          const blob = new Blob(incoming.current.parts);
          const buf = new Uint8Array(await blob.arrayBuffer());
          let bin = "";
          for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
          const path = joinPath(settings?.downloadDir ?? "", "รับไฟล์", incoming.current.name);
          await attempt(() => call("write_base64_file", { path, data: btoa(bin) }), `รับไฟล์แล้ว: ${incoming.current.name}`);
          setReceived((r) => [path, ...r]);
          incoming.current = null;
        }
      } else if (incoming.current) {
        incoming.current.parts.push(e.data);
        incoming.current.got += e.data.byteLength;
        setProgress((incoming.current.got / incoming.current.size) * 100);
      }
    };
  };

  const createOffer = async () => {
    const p = setup();
    bind(p.createDataChannel("files"));
    await p.setLocalDescription(await p.createOffer());
    await gatherComplete(p);
    setMyCode(enc(p.localDescription!.toJSON()));
  };
  const acceptOffer = async () => {
    try {
      const p = setup();
      await p.setRemoteDescription(dec(peerCode));
      await p.setLocalDescription(await p.createAnswer());
      await gatherComplete(p);
      setMyCode(enc(p.localDescription!.toJSON()));
    } catch {
      toast("รหัสเชื่อมต่อไม่ถูกต้อง", "error");
    }
  };
  const acceptAnswer = async () => {
    try {
      await pc.current?.setRemoteDescription(dec(peerCode));
    } catch {
      toast("รหัสตอบกลับไม่ถูกต้อง", "error");
    }
  };
  const sendFile = async (file: File) => {
    const c = ch.current;
    if (!c || c.readyState !== "open") return toast("ยังไม่ได้เชื่อมต่อ", "error");
    c.send(JSON.stringify({ type: "meta", name: file.name, size: file.size }));
    let off = 0;
    while (off < file.size) {
      if (c.bufferedAmount > 8 * CHUNK) {
        await new Promise((r) => setTimeout(r, 20));
        continue;
      }
      c.send(await file.slice(off, off + CHUNK).arrayBuffer());
      off += CHUNK;
      setProgress(Math.min(100, (off / file.size) * 100));
    }
    c.send(JSON.stringify({ type: "end" }));
    toast(`ส่ง ${file.name} แล้ว`, "success");
  };
  useEffect(() => () => pc.current?.close(), []);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="1. จับคู่เครื่อง">
        <p className="mb-3 text-xs text-muted">ส่งไฟล์ตรงระหว่างคอม 2 เครื่องที่ใช้ มีเดียทูลบ็อกซ์ ในเครือข่ายเดียวกัน โดยไม่ผ่านเซิร์ฟเวอร์ — แลก "รหัสเชื่อมต่อ" กันผ่าน LINE หรือช่องทางใดก็ได้</p>
        <Select value={role} onChange={(v) => { setRole(v); setMyCode(""); setPeerCode(""); }} options={[{ value: "send", label: "ฉันเป็นฝ่ายเริ่ม" }, { value: "receive", label: "ฉันได้รับรหัสจากอีกฝ่าย" }]} />
        <div className="mt-3 space-y-2">
          {role === "send" ? (
            <>
              <button className="btn w-full" onClick={createOffer}>สร้างรหัสเชื่อมต่อ</button>
              {myCode && <CodeBox code={myCode} label="ส่งรหัสนี้ให้อีกฝ่าย" />}
              <Field label="วางรหัสตอบกลับจากอีกฝ่าย">
                <textarea className="input h-20 font-mono text-[10px]" value={peerCode} onChange={(e) => setPeerCode(e.target.value)} />
              </Field>
              <button className="btn-primary w-full" disabled={!peerCode} onClick={acceptAnswer}>เชื่อมต่อ</button>
            </>
          ) : (
            <>
              <Field label="วางรหัสเชื่อมต่อจากอีกฝ่าย">
                <textarea className="input h-20 font-mono text-[10px]" value={peerCode} onChange={(e) => setPeerCode(e.target.value)} />
              </Field>
              <button className="btn-primary w-full" disabled={!peerCode} onClick={acceptOffer}>สร้างรหัสตอบกลับ</button>
              {myCode && <CodeBox code={myCode} label="ส่งรหัสตอบกลับนี้ให้อีกฝ่าย" />}
            </>
          )}
          <div className="text-center text-sm">สถานะ: <b>{state}</b></div>
        </div>
      </Card>
      <Card title="2. ส่ง / รับไฟล์">
        <label className="btn-primary w-full cursor-pointer">
          <Send size={15} /> เลือกไฟล์เพื่อส่ง
          <input type="file" multiple className="hidden" onChange={async (e) => { for (const f of Array.from(e.target.files ?? [])) await sendFile(f); }} />
        </label>
        <div className="mt-3"><Progress value={progress} /></div>
        <div className="mt-3 text-sm">
          <div className="label flex items-center gap-1"><Download size={12} /> ไฟล์ที่ได้รับ (เก็บใน โฟลเดอร์ดาวน์โหลด/รับไฟล์)</div>
          {received.map((r) => <div key={r} className="truncate">{basename(r)}</div>)}
          {!received.length && <p className="text-xs text-muted">ยังไม่มี</p>}
        </div>
      </Card>
    </div>
  );
}

function CodeBox({ code, label }: { code: string; label: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="flex gap-1">
        <textarea className="input h-20 font-mono text-[10px]" readOnly value={code} />
        <button className="btn btn-sm" onClick={() => navigator.clipboard.writeText(code)}><Copy size={12} /></button>
      </div>
    </div>
  );
}
