// หน้า 12: สตรีมมิ่ง (Media Server / RSS / อัดไลฟ์ / อัดวิทยุ)
import { useEffect, useState } from "react";
import { Radio, Tv, Rss, Mic, Play, Square, Copy, Plus, Trash2 } from "lucide-react";
import { Card, Empty, Field, PageHeader, Select, Tabs } from "@/components/ui";
import { JobList } from "@/components/JobList";
import { api, call, openUrl, pickFolder } from "@/lib/api";
import { attempt, useApp } from "@/store/app";
import { useKv } from "@/hooks/useData";
import { joinPath, localStamp, safeName } from "@/lib/format";
import { QR, useServer } from "./CloudSync";
import { defaultDl } from "./Downloader";

type Tab = "server" | "live" | "radio";
type Renderer = { name: string; location: string; avTransport: string; rendering: string };

export default function Streaming() {
  const [tab, setTab] = useState<Tab>("server");
  return (
    <div>
      <PageHeader title="สตรีมมิ่ง" subtitle="Media Server ในบ้าน · ฟีดพอดแคสต์ · อัดไลฟ์สด · อัดวิทยุออนไลน์" icon={<Radio />} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "server", label: "📺 Media Server" }, { id: "live", label: "🔴 อัดไลฟ์สด" }, { id: "radio", label: "📻 วิทยุออนไลน์" }]} />
      {tab === "server" && <MediaServer />}
      {tab === "live" && <LiveRecord />}
      {tab === "radio" && <RadioRecord />}
      <div className="mt-4">
        <Card title="งานอัด/โหลด"><JobList kinds={["record", "download"]} /></Card>
      </div>
    </div>
  );
}

function MediaServer() {
  const settings = useApp((s) => s.settings);
  const { status, start, stop } = useServer();
  const [dir, setDir] = useKv("stream.dir", settings?.downloadDir ?? "");
  const [port, setPort] = useKv("stream.port", 8787);
  const [files, setFiles] = useState<[string, number][]>([]);
  const [playing, setPlaying] = useState("");
  const [tvs, setTvs] = useState<Renderer[]>([]);
  const [tvLoc, setTvLoc] = useKv("stream.tv", "");
  const [searching, setSearching] = useState(false);
  const [onTv, setOnTv] = useState("");
  const tv = tvs.find((t) => t.location === tvLoc) ?? tvs[0];
  const findTvs = async () => {
    setSearching(true);
    const r = await attempt(() => call<Renderer[]>("dlna_discover"));
    setSearching(false);
    if (r) {
      setTvs(r);
      if (!r.length) useApp.getState().toast("ไม่พบทีวี — เปิดทีวีและต่อ Wi-Fi เดียวกัน แล้วลองอีกครั้ง", "error");
    }
  };
  const castTo = async (n: string) => {
    if (!tv) return useApp.getState().toast("ค้นหาทีวีก่อน", "error");
    const ok = await attempt(() => call("dlna_cast", { control: tv.avTransport, url: fileLink(n), title: n.split("/").pop() }), `📺 ส่งขึ้น ${tv.name} แล้ว`);
    if (ok !== undefined) setOnTv(n);
  };
  const tvCmd = (action: string, volume?: number) => attempt(() => call("dlna_control", { control: tv!.avTransport, action, rendering: tv!.rendering || null, volume: volume ?? null }));
  useEffect(() => {
    if (status.running) fetch(`${status.url}api/list`).then((r) => r.json()).then(setFiles).catch(() => setFiles([]));
    else setFiles([]);
  }, [status]);
  // ทีวีเล่นได้เกือบทุกไฟล์ (mkv/avi ด้วย) ส่วนเครื่องเล่นเว็บเล่นได้เฉพาะบางแบบ
  const media = files.filter(([n]) => /\.(mp4|webm|m4v|mov|mkv|avi|wmv|flv|mp3|m4a|aac|ogg|opus|wav|flac|jpg|jpeg|png)$/i.test(n));
  const webOk = (n: string) => /\.(mp4|webm|m4v|mov|mp3|m4a|aac|ogg|opus|wav|flac)$/i.test(n);
  const fileLink = (n: string) => `${status.url}files/${n.split("/").map(encodeURIComponent).join("/")}`;
  const copy = (t: string) => { navigator.clipboard.writeText(t); useApp.getState().toast("คัดลอกลิงก์แล้ว"); };
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card title="เซิร์ฟเวอร์สื่อในบ้าน (HTTP)">
        <div className="grid gap-3 sm:grid-cols-[1fr_120px_auto]">
          <button className="input truncate text-left text-xs" onClick={async () => { const d = await pickFolder(); if (d) setDir(d); }}>{dir || "เลือกโฟลเดอร์สื่อ…"}</button>
          <input type="number" className="input" value={port} onChange={(e) => setPort(Number(e.target.value))} />
          {status.running ? (
            <button className="btn-danger" onClick={stop}><Square size={14} /> ปิด</button>
          ) : (
            <button className="btn-primary" disabled={!dir} onClick={() => start(dir, port)}><Play size={14} /> เปิดเซิร์ฟเวอร์</button>
          )}
        </div>
        {status.running ? (
          <>
            <p className="mt-3 text-sm">เปิดบน Smart TV / มือถือ / คอมเครื่องอื่นที่ต่อ Wi-Fi เดียวกัน: <b className="selectable font-mono text-accent2">{status.url}</b></p>
            <div className="mt-3 max-h-[45vh] space-y-1 overflow-auto">
              {media.length === 0 && <Empty text="ไม่พบไฟล์วิดีโอ/เสียง/รูปในโฟลเดอร์นี้" />}
              {media.map(([n, size]) => (
                <div key={n} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-fg/5">
                  <button className="btn btn-sm" disabled={!webOk(n)} title={webOk(n) ? "เล่นในเครื่องเล่นเว็บ" : "เบราว์เซอร์เล่นไฟล์นี้ไม่ได้ — ส่งขึ้นทีวีได้"} onClick={() => setPlaying(n)}><Play size={12} /></button>
                  {tv && <button className={`btn btn-sm ${onTv === n ? "btn-primary" : ""}`} title={`ส่งขึ้น ${tv.name}`} onClick={() => castTo(n)}><Tv size={12} /></button>}
                  <span className="flex-1 truncate text-sm">{n}</span>
                  <span className="text-xs text-muted">{(size / 1048576).toFixed(1)} MB</span>
                  <button className="btn btn-sm" onClick={() => copy(fileLink(n))}><Copy size={12} /></button>
                </div>
              ))}
            </div>
            {playing && (
              <div className="mt-3">
                <div className="label">เครื่องเล่นเว็บ: {playing}</div>
                {/\.(mp3|m4a|aac|ogg|opus|wav|flac)$/i.test(playing) ? <audio src={fileLink(playing)} controls autoPlay className="w-full" /> : <video src={fileLink(playing)} controls autoPlay className="max-h-[50vh] w-full rounded-xl bg-black" />}
              </div>
            )}
          </>
        ) : (
          <p className="mt-3 text-sm text-muted">เลือกโฟลเดอร์แล้วกด "เปิดเซิร์ฟเวอร์" อุปกรณ์ในบ้านจะเปิดดูผ่านเบราว์เซอร์ได้ทันที ถ้า Windows ถามเรื่อง Firewall ให้กด "อนุญาต" (เครือข่ายส่วนตัว)</p>
        )}
      </Card>
      <div className="space-y-4">
        {status.running && (
          <Card title="สแกนเพื่อเปิดบนมือถือ">
            <div className="grid place-items-center"><QR text={status.url} size={220} /></div>
          </Card>
        )}
        <Card title={<span className="flex items-center gap-2"><Rss size={16} /> ฟีดพอดแคสต์ RSS</span>}>
          <p className="text-sm text-muted">ไฟล์เสียง/วิดีโอในโฟลเดอร์จะกลายเป็นตอนของพอดแคสต์ นำลิงก์ไปเพิ่มในแอปพอดแคสต์ (เช่น AntennaPod, Pocket Casts) ในวง LAN</p>
          {status.running && (
            <div className="mt-2 flex gap-2">
              <input readOnly className="input font-mono text-xs" value={`${status.url}feed.xml`} />
              <button className="btn" onClick={() => copy(`${status.url}feed.xml`)}><Copy size={14} /></button>
              <button className="btn" onClick={() => openUrl(`${status.url}feed.xml`)}>เปิด</button>
            </div>
          )}
        </Card>
        <Card title={<span className="flex items-center gap-2"><Tv size={16} /> ส่งขึ้นทีวี (DLNA)</span>}>
          <div className="space-y-2">
            <button className="btn w-full" disabled={searching} onClick={findTvs}>{searching ? "กำลังค้นหาทีวีในบ้าน…" : "🔍 ค้นหาทีวี"}</button>
            {tvs.length > 0 && <Select value={tv?.location ?? ""} onChange={setTvLoc} options={tvs.map((t) => ({ value: t.location, label: t.name }))} />}
            {tv && onTv && (
              <div className="space-y-2 rounded-lg bg-fg/5 p-2 text-sm">
                <div className="truncate">📺 {onTv.split("/").pop()}</div>
                <div className="flex gap-1">
                  <button className="btn btn-sm flex-1" onClick={() => tvCmd("play")}>▶</button>
                  <button className="btn btn-sm flex-1" onClick={() => tvCmd("pause")}>⏸</button>
                  <button className="btn btn-sm flex-1" onClick={() => { tvCmd("stop"); setOnTv(""); }}>⏹</button>
                </div>
                {tv.rendering && (
                  <label className="flex items-center gap-2 text-xs">🔊<input type="range" min={0} max={100} defaultValue={30} className="flex-1" onChange={(e) => tvCmd("volume", Number(e.target.value))} /></label>
                )}
              </div>
            )}
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
              <li>ใช้กับ Smart TV Samsung / LG / Sony / Android TV / กล่องทีวี / Kodi / VLC ที่ต่อ Wi-Fi เดียวกัน</li>
              <li>เปิดเซิร์ฟเวอร์ก่อน แล้วกดปุ่ม 📺 ข้างไฟล์ — ทีวีเล่น MKV/AVI ได้เองโดยไม่ต้องแปลง</li>
              <li><b>Chromecast</b>: เปิดลิงก์ไฟล์ใน Chrome แล้วเลือก ⋮ → แคสต์</li>
            </ul>
          </div>
        </Card>
      </div>
    </div>
  );
}

function LiveRecord() {
  const settings = useApp((s) => s.settings);
  const [url, setUrl] = useState("");
  const [fromStart, setFromStart] = useState(false);
  const [quality, setQuality] = useState("best");
  const record = async () => {
    if (!url.trim()) return;
    await attempt(
      () => api.startDownload({ ...defaultDl, urls: [url.trim()], quality, format: "mp4", liveFromStart: fromStart, outputDir: joinPath(settings?.downloadDir ?? "", "ไลฟ์"), extraArgs: ["--hls-use-mpegts"] }),
      "เริ่มอัดไลฟ์แล้ว — กด 'ยกเลิก' ในรายการงานเมื่อต้องการหยุด ไฟล์ส่วนที่อัดแล้วจะยังอยู่",
    );
    setUrl("");
  };
  return (
    <Card title="อัดไลฟ์สด (YouTube / Facebook / TikTok / Twitch)">
      <div className="space-y-3">
        <Field label="ลิงก์ไลฟ์"><input className="input" placeholder="https://www.youtube.com/watch?v=... หรือ https://www.tiktok.com/@user/live" value={url} onChange={(e) => setUrl(e.target.value)} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="คุณภาพ"><Select value={quality} onChange={setQuality} options={[{ value: "best", label: "ดีที่สุด" }, { value: "1080", label: "1080p" }, { value: "720", label: "720p" }, { value: "480", label: "480p" }]} /></Field>
          <Field label="เริ่มอัดจาก"><Select value={fromStart ? "start" : "now"} onChange={(v) => setFromStart(v === "start")} options={[{ value: "now", label: "ตอนนี้" }, { value: "start", label: "ต้นไลฟ์ (YouTube)" }]} /></Field>
        </div>
        <button className="btn-primary" disabled={!url.trim()} onClick={record}><span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> เริ่มอัด</button>
        <p className="text-xs text-muted">ไลฟ์ที่ต้องล็อกอินหรือกลุ่มส่วนตัว ต้องตั้งค่าคุกกี้ในหน้า "ตั้งค่า" ก่อน</p>
      </div>
    </Card>
  );
}

interface Station {
  name: string;
  url: string;
}
const DEFAULT_STATIONS: Station[] = [
  { name: "ตัวอย่าง: สถานีของฉัน (วางลิงก์สตรีม .mp3/.aac/.m3u8)", url: "" },
];

function RadioRecord() {
  const settings = useApp((s) => s.settings);
  const [stations, setStations] = useKv<Station[]>("stream.stations", DEFAULT_STATIONS);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [listen, setListen] = useState("");
  const [minutes, setMinutes] = useState(60);
  const record = async (s: Station) => {
    const out = joinPath(settings?.downloadDir ?? "", "วิทยุ", `${safeName(s.name)}-${localStamp().slice(0, 16)}.mp3`);
    const args = ["-y", "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "10", "-i", s.url];
    if (minutes > 0) args.push("-t", String(minutes * 60));
    args.push("-vn", "-c:a", "libmp3lame", "-b:a", "128k", out);
    await attempt(() => api.ffmpegJob({ kind: "record", title: `📻 ${s.name}`, input: s.url, output: out, passes: [args], duration: minutes > 0 ? minutes * 60 : undefined, gracefulStop: true }), `เริ่มอัด ${s.name}`);
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card title="สถานีของฉัน">
        {stations.filter((s) => s.url).length === 0 && <Empty text="ยังไม่มีสถานี — เพิ่มลิงก์สตรีมวิทยุด้านขวา" />}
        <div className="space-y-1.5">
          {stations.filter((s) => s.url).map((s, i) => (
            <div key={i} className="flex items-center gap-2 rounded-lg bg-fg/5 px-3 py-2">
              <Mic size={14} className="text-accent2" />
              <div className="min-w-0 flex-1"><div className="truncate text-sm">{s.name}</div><div className="truncate text-xs text-muted">{s.url}</div></div>
              <button className="btn btn-sm" onClick={() => setListen(listen === s.url ? "" : s.url)}>{listen === s.url ? "หยุดฟัง" : "ฟัง"}</button>
              <button className="btn btn-sm text-red-300" onClick={() => record(s)}>● อัด</button>
              <button className="btn btn-sm" onClick={() => setStations(stations.filter((x) => x !== s))}><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
        {listen && <audio src={listen} autoPlay controls className="mt-3 w-full" />}
        <div className="mt-3 flex items-center gap-2 text-sm">
          ความยาวการอัด <input type="number" className="input w-24" value={minutes} min={0} onChange={(e) => setMinutes(Number(e.target.value))} /> นาที <span className="text-muted">(0 = จนกว่าจะกดหยุด)</span>
        </div>
      </Card>
      <Card title="เพิ่มสถานี">
        <div className="space-y-2">
          <input className="input" placeholder="ชื่อสถานี" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="input" placeholder="https://.../stream.mp3" value={url} onChange={(e) => setUrl(e.target.value)} />
          <button className="btn-primary w-full" disabled={!name || !/^https?:\/\//.test(url)} onClick={() => { setStations([...stations, { name, url }]); setName(""); setUrl(""); }}><Plus size={14} /> เพิ่ม</button>
        </div>
      </Card>
    </div>
  );
}
