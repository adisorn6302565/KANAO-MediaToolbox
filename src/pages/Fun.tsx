// หน้า 16: สนุก (เพลง / เนื้อเพลง / visualizer / สั่งด้วยเสียง / วอลเปเปอร์ / ปุ่มมีม / แมว / Pomodoro / ความสำเร็จ)
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PartyPopper, Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1, Mic, Trash2, Download, Timer } from "lucide-react";
import { Card, DropZone, PageHeader, Slider, Tabs, Toggle } from "@/components/ui";
import { call, fileUrl, pickSave } from "@/lib/api";
import { ACHIEVEMENTS, attempt, lockIfPin, useApp } from "@/store/app";
import { useKv } from "@/hooks/useData";
import { AUDIO_EXT, basename, dirname, formatDate, formatDuration, joinPath, stem } from "@/lib/format";
import { cueAt, parseLrc, type Cue } from "@/lib/subtitle";
import { audioContext, playSound } from "@/lib/sound";
import { NAV } from "@/lib/nav";

type Tab = "music" | "pomodoro" | "wallpaper" | "sounds" | "voice" | "achievements";

export default function Fun() {
  const [tab, setTab] = useState<Tab>("music");
  return (
    <div>
      <PageHeader title="สนุก" subtitle="พักสมองบ้างก็ได้ 😺" icon={<PartyPopper />} />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "music", label: "🎵 เพลง" },
          { id: "pomodoro", label: "🍅 โฟกัส" },
          { id: "wallpaper", label: "🌌 วอลเปเปอร์" },
          { id: "sounds", label: "📢 ปุ่มมีม & แมว" },
          { id: "voice", label: "🎙️ สั่งด้วยเสียง" },
          { id: "achievements", label: "🏆 ความสำเร็จ" },
        ]}
      />
      {/* เครื่องเล่นเพลงคงอยู่แม้สลับแท็บ */}
      <div className={tab === "music" ? "" : "hidden"}><MusicPlayer /></div>
      {tab === "pomodoro" && <Pomodoro />}
      {tab === "wallpaper" && <Wallpaper />}
      {tab === "sounds" && <Sounds />}
      {tab === "voice" && <Voice />}
      {tab === "achievements" && <Achievements />}
    </div>
  );
}

// ---------- เพลง ----------
type RepeatMode = "off" | "all" | "one";
function MusicPlayer() {
  const [list, setList] = useKv<string[]>("fun.playlist", []);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>("all");
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const [vol, setVol] = useState(80);
  const [lyrics, setLyrics] = useState<Cue[]>([]);
  const [style, setStyle] = useState<"bars" | "wave" | "circle">("bars");
  const audio = useRef<HTMLAudioElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const cur = list[idx];

  // โหลดเนื้อเพลง .lrc ชื่อเดียวกัน
  useEffect(() => {
    setLyrics([]);
    if (!cur) return;
    call<string>("read_text_file", { path: joinPath(dirname(cur), `${stem(cur)}.lrc`) }).then((t) => setLyrics(parseLrc(t))).catch(() => {});
  }, [cur]);

  useEffect(() => {
    if (audio.current) audio.current.volume = vol / 100;
  }, [vol]);

  const ensureAnalyser = () => {
    if (analyser.current || !audio.current) return;
    try {
      const ctx = audioContext();
      const src = ctx.createMediaElementSource(audio.current);
      const an = ctx.createAnalyser();
      an.fftSize = 256;
      src.connect(an).connect(ctx.destination);
      analyser.current = an;
    } catch {
      /* เชื่อมต่อได้ครั้งเดียวต่อ element */
    }
  };

  // วาดภาพเคลื่อนไหวตามเสียง
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = canvas.current;
      const an = analyser.current;
      if (!c || !an) return;
      const ctx = c.getContext("2d")!;
      const w = (c.width = c.clientWidth);
      const h = (c.height = c.clientHeight);
      const data = new Uint8Array(an.frequencyBinCount);
      ctx.clearRect(0, 0, w, h);
      const g = ctx.createLinearGradient(0, h, w, 0);
      g.addColorStop(0, "#a855f7");
      g.addColorStop(1, "#22d3ee");
      ctx.fillStyle = g;
      ctx.strokeStyle = g;
      if (style === "wave") {
        an.getByteTimeDomainData(data);
        ctx.lineWidth = 3;
        ctx.beginPath();
        data.forEach((v, i) => {
          const x = (i / data.length) * w;
          const y = (v / 255) * h;
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        });
        ctx.stroke();
      } else if (style === "circle") {
        an.getByteFrequencyData(data);
        const r = Math.min(w, h) / 4;
        ctx.lineWidth = 3;
        data.forEach((v, i) => {
          const a = (i / data.length) * Math.PI * 2;
          const l = r + (v / 255) * r;
          ctx.beginPath();
          ctx.moveTo(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r);
          ctx.lineTo(w / 2 + Math.cos(a) * l, h / 2 + Math.sin(a) * l);
          ctx.stroke();
        });
      } else {
        an.getByteFrequencyData(data);
        const bw = w / data.length;
        data.forEach((v, i) => {
          const bh = (v / 255) * h;
          ctx.fillRect(i * bw, h - bh, bw - 1, bh);
        });
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [style]);

  const next = (dir = 1) => {
    if (!list.length) return;
    if (repeat === "one" && dir === 1 && audio.current) {
      audio.current.currentTime = 0;
      audio.current.play();
      return;
    }
    let n = shuffle ? Math.floor(Math.random() * list.length) : idx + dir;
    if (n >= list.length) {
      if (repeat === "off") return setPlaying(false);
      n = 0;
    }
    if (n < 0) n = list.length - 1;
    setIdx(n);
  };
  const toggle = () => {
    const a = audio.current;
    if (!a || !cur) return;
    ensureAnalyser();
    audioContext().resume();
    a.paused ? a.play() : a.pause();
  };
  const add = (paths: string[]) => setList([...list, ...paths.filter((p) => AUDIO_EXT.includes(p.split(".").pop()!.toLowerCase()) || /\.(mp4|webm|mkv)$/i.test(p))]);
  const line = cueAt(lyrics, time);
  const lineIdx = line ? lyrics.indexOf(line) : -1;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card>
        <audio
          ref={audio}
          crossOrigin="anonymous"
          src={cur ? fileUrl(cur) : undefined}
          autoPlay={playing}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
          onEnded={() => next(1)}
        />
        <div className="relative h-56 overflow-hidden rounded-xl bg-black/30">
          <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
          <div className="absolute inset-x-0 bottom-3 px-4 text-center">
            {lyrics.length > 0 ? (
              <>
                <div className="text-sm text-muted">{lyrics[lineIdx - 1]?.text ?? ""}</div>
                <div className="text-xl font-bold drop-shadow-lg">{line?.text ?? "♪"}</div>
                <div className="text-sm text-muted">{lyrics[lineIdx + 1]?.text ?? ""}</div>
              </>
            ) : (
              <div className="text-lg font-medium drop-shadow">{cur ? stem(cur) : "เพิ่มเพลงเพื่อเริ่มเล่น"}</div>
            )}
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs">
          <span className="font-mono">{formatDuration(time)}</span>
          <input type="range" className="flex-1" min={0} max={dur || 0} step={0.1} value={time} onChange={(e) => audio.current && (audio.current.currentTime = Number(e.target.value))} />
          <span className="font-mono">{formatDuration(dur)}</span>
        </div>
        <div className="mt-2 flex items-center justify-center gap-2">
          <button className={`btn ${shuffle ? "text-accent2" : ""}`} onClick={() => setShuffle(!shuffle)} title="สุ่ม"><Shuffle size={16} /></button>
          <button className="btn" onClick={() => next(-1)}><SkipBack size={16} /></button>
          <button className="btn-primary h-12 w-12 rounded-full" onClick={toggle}>{playing ? <Pause /> : <Play />}</button>
          <button className="btn" onClick={() => next(1)}><SkipForward size={16} /></button>
          <button className={`btn ${repeat !== "off" ? "text-accent2" : ""}`} onClick={() => setRepeat(repeat === "off" ? "all" : repeat === "all" ? "one" : "off")} title="วนซ้ำ">{repeat === "one" ? <Repeat1 size={16} /> : <Repeat size={16} />}</button>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Slider label="ระดับเสียง" value={vol} min={0} max={100} suffix="%" onChange={setVol} />
          <div>
            <div className="label">รูปแบบภาพ</div>
            <div className="flex gap-1">{(["bars", "wave", "circle"] as const).map((s) => <button key={s} className={`chip ${style === s ? "bg-accent/40" : ""}`} onClick={() => setStyle(s)}>{{ bars: "แท่ง", wave: "คลื่น", circle: "วงกลม" }[s]}</button>)}</div>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted">วางไฟล์ .lrc ชื่อเดียวกับเพลงไว้โฟลเดอร์เดียวกัน เนื้อเพลงจะแสดงอัตโนมัติ</p>
      </Card>
      <Card title={`เพลย์ลิสต์ (${list.length})`} actions={list.length > 0 && <button className="btn btn-sm" onClick={() => { setList([]); setIdx(0); }}><Trash2 size={12} /></button>}>
        <DropZone onFiles={add} compact label="ลากเพลงมาวาง" />
        <div className="mt-2 max-h-[50vh] overflow-auto">
          {list.map((p, i) => (
            <div key={p + i} className={`group flex items-center gap-2 rounded-lg px-2 py-1 text-sm ${i === idx ? "bg-accent/25" : "hover:bg-fg/5"}`}>
              <button className="flex-1 truncate text-left" onClick={() => { setIdx(i); setPlaying(true); ensureAnalyser(); }}>{i === idx && playing ? "▶ " : ""}{basename(p)}</button>
              <button className="opacity-0 group-hover:opacity-100" onClick={() => { setList(list.filter((_, j) => j !== i)); if (i < idx) setIdx(idx - 1); }}><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ---------- Pomodoro ----------
function Pomodoro() {
  const [work, setWork] = useKv("fun.pomoWork", 25);
  const [rest, setRest] = useKv("fun.pomoRest", 5);
  const [phase, setPhase] = useState<"work" | "rest">("work");
  const [left, setLeft] = useState(work * 60);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useKv("fun.pomoDone", 0);
  useEffect(() => {
    if (!running) setLeft((phase === "work" ? work : rest) * 60);
  }, [work, rest, phase]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setLeft((l) => l - 1), 1000);
    return () => clearInterval(t);
  }, [running]);
  useEffect(() => {
    if (left > 0 || !running) return;
    playSound("chime");
    if (phase === "work") {
      setDone(done + 1);
      useApp.getState().unlock("pomodoro");
      call("notify", { title: "🍅 ครบเวลาโฟกัสแล้ว", body: `พัก ${rest} นาที` }).catch(() => {});
      setPhase("rest");
      setLeft(rest * 60);
    } else {
      call("notify", { title: "☕ หมดเวลาพัก", body: "กลับมาโฟกัสกันต่อ" }).catch(() => {});
      setPhase("work");
      setLeft(work * 60);
    }
  }, [left]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = (phase === "work" ? work : rest) * 60;
  const pct = 1 - left / total;
  const r = 110;
  return (
    <Card>
      <div className="flex flex-col items-center gap-4 py-4">
        <div className="relative">
          <svg width={260} height={260}>
            <circle cx={130} cy={130} r={r} stroke="rgb(var(--fg) / .1)" strokeWidth={12} fill="none" />
            <circle cx={130} cy={130} r={r} stroke={phase === "work" ? "#f43f5e" : "#22d3ee"} strokeWidth={12} fill="none" strokeLinecap="round" strokeDasharray={2 * Math.PI * r} strokeDashoffset={2 * Math.PI * r * (1 - pct)} transform="rotate(-90 130 130)" style={{ transition: "stroke-dashoffset 1s linear" }} />
          </svg>
          <div className="absolute inset-0 grid place-items-center text-center">
            <div>
              <div className="text-sm text-muted">{phase === "work" ? "🍅 โฟกัส" : "☕ พัก"}</div>
              <div className="font-mono text-5xl">{formatDuration(Math.max(0, left))}</div>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <button className="btn-primary" onClick={() => setRunning(!running)}><Timer size={15} /> {running ? "หยุดชั่วคราว" : "เริ่ม"}</button>
          <button className="btn" onClick={() => { setRunning(false); setPhase("work"); setLeft(work * 60); }}>รีเซ็ต</button>
        </div>
        <div className="grid w-full max-w-md grid-cols-2 gap-4">
          <Slider label="โฟกัส" value={work} min={5} max={60} suffix=" นาที" onChange={setWork} />
          <Slider label="พัก" value={rest} min={1} max={30} suffix=" นาที" onChange={setRest} />
        </div>
        <div className="text-sm text-muted">ทำครบแล้ววันนี้และก่อนหน้า: {"🍅".repeat(Math.min(done, 12))} {done}</div>
      </div>
    </Card>
  );
}

// ---------- วอลเปเปอร์ ----------
function mulberry(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function Wallpaper() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [seed, setSeed] = useState(42);
  const [kind, setKind] = useState<"blobs" | "stars" | "waves" | "grid">("blobs");
  const [res, setRes] = useState("1920x1080");
  const [c1, setC1] = useState("#7c3aed");
  const [c2, setC2] = useState("#06b6d4");
  const [text, setText] = useState("");
  const [w, h] = res.split("x").map(Number);
  useEffect(() => {
    const c = canvas.current!;
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d")!;
    const rnd = mulberry(seed);
    ctx.fillStyle = "#05030f";
    ctx.fillRect(0, 0, w, h);
    if (kind === "blobs") {
      ctx.filter = `blur(${w / 12}px)`;
      for (let i = 0; i < 7; i++) {
        ctx.fillStyle = i % 2 ? c1 : c2;
        ctx.globalAlpha = 0.5 + rnd() * 0.4;
        ctx.beginPath();
        ctx.arc(rnd() * w, rnd() * h, (0.15 + rnd() * 0.25) * w, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.filter = "none";
      ctx.globalAlpha = 1;
    } else if (kind === "stars") {
      const g = ctx.createRadialGradient(w / 2, h, 0, w / 2, h, h * 1.2);
      g.addColorStop(0, c1);
      g.addColorStop(1, "#05030f");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 900; i++) {
        ctx.fillStyle = rnd() > 0.8 ? c2 : "#fff";
        ctx.globalAlpha = rnd();
        ctx.fillRect(rnd() * w, rnd() * h, rnd() * 2.5, rnd() * 2.5);
      }
      ctx.globalAlpha = 1;
    } else if (kind === "waves") {
      for (let k = 0; k < 14; k++) {
        const g = ctx.createLinearGradient(0, 0, w, 0);
        g.addColorStop(0, c1);
        g.addColorStop(1, c2);
        ctx.strokeStyle = g;
        ctx.globalAlpha = 0.15 + (k / 14) * 0.6;
        ctx.lineWidth = 2 + rnd() * 3;
        ctx.beginPath();
        const amp = h * (0.03 + rnd() * 0.08);
        const f = 1 + rnd() * 3;
        const ph = rnd() * 10;
        for (let x = 0; x <= w; x += 8) {
          const y = h * (0.3 + k * 0.035) + Math.sin((x / w) * Math.PI * f + ph) * amp;
          x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    } else {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, "#05030f");
      g.addColorStop(1, c1);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = c2;
      ctx.globalAlpha = 0.5;
      const hz = h * 0.55;
      for (let i = -20; i <= 20; i++) {
        ctx.beginPath();
        ctx.moveTo(w / 2 + i * 40, hz);
        ctx.lineTo(w / 2 + i * w * 0.15, h);
        ctx.stroke();
      }
      for (let j = 0; j < 14; j++) {
        const y = hz + (h - hz) * Math.pow(j / 14, 2);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      const sun = ctx.createLinearGradient(0, hz - h * 0.3, 0, hz);
      sun.addColorStop(0, "#fde047");
      sun.addColorStop(1, "#ec4899");
      ctx.fillStyle = sun;
      ctx.beginPath();
      ctx.arc(w / 2, hz, h * 0.22, Math.PI, 0);
      ctx.fill();
    }
    if (text) {
      ctx.font = `700 ${w / 20}px Prompt`;
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(255,255,255,.9)";
      ctx.shadowColor = "rgba(0,0,0,.5)";
      ctx.shadowBlur = 20;
      ctx.fillText(text, w / 2, h / 2);
      ctx.shadowBlur = 0;
    }
  }, [seed, kind, w, h, c1, c2, text]);
  const save = async () => {
    const out = await pickSave(`วอลเปเปอร์-${kind}-${seed}.png`, [{ name: "PNG", extensions: ["png"] }]);
    if (out) await attempt(() => call("write_base64_file", { path: out, data: canvas.current!.toDataURL("image/png").split(",")[1] }), "บันทึกวอลเปเปอร์แล้ว");
  };
  return (
    <Card>
      <canvas ref={canvas} className="w-full rounded-xl" />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {(["blobs", "stars", "waves", "grid"] as const).map((k) => <button key={k} className={`chip ${kind === k ? "bg-accent/40" : ""}`} onClick={() => setKind(k)}>{{ blobs: "ฟองสี", stars: "ดวงดาว", waves: "คลื่น", grid: "Synthwave" }[k]}</button>)}
        <select className="input w-auto" value={res} onChange={(e) => setRes(e.target.value)}>
          {["1920x1080", "2560x1440", "3840x2160", "1080x1920", "1170x2532"].map((r) => <option key={r}>{r}</option>)}
        </select>
        <input type="color" value={c1} onChange={(e) => setC1(e.target.value)} />
        <input type="color" value={c2} onChange={(e) => setC2(e.target.value)} />
        <input className="input w-40" placeholder="ข้อความ (ไม่บังคับ)" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn" onClick={() => setSeed(Math.floor(Math.random() * 1e9))}>🎲 สุ่มใหม่</button>
        <button className="btn-primary" onClick={save}><Download size={14} /> บันทึก</button>
      </div>
    </Card>
  );
}

// ---------- ปุ่มมีม & แมว ----------
const MEME_SOUNDS: [string, string][] = [["airhorn", "📯 แตร"], ["sad", "😢 เศร้า"], ["drum", "🥁 บ๊ะดุ่ม"], ["tada", "🎉 ทาด๊า"], ["boing", "🦘 ดึ๋ง"], ["coin", "🪙 เหรียญ"], ["error", "❌ ผิด"], ["chime", "🔔 ระฆัง"]];
function Sounds() {
  const [cat, setCat] = useState(() => localStorage.getItem("mtb-cat") === "1");
  const toggleCat = (v: boolean) => {
    try {
      localStorage.setItem("mtb-cat", v ? "1" : "0");
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event("mtb-cat"));
    setCat(v);
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card title="ปุ่มเสียงมีม">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {MEME_SOUNDS.map(([k, label]) => (
            <button key={k} onClick={() => playSound(k)} className="aspect-square rounded-2xl bg-gradient-to-br from-accent/40 to-accent2/30 text-lg font-bold shadow-lg transition active:scale-90 hover:brightness-125">{label}</button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">เสียงทั้งหมดสังเคราะห์ในเครื่อง ไม่มีไฟล์เสียงลิขสิทธิ์</p>
      </Card>
      <Card title="🐱 แมวน้อย">
        <Toggle label="ให้แมวเดินเล่นในโปรแกรม" checked={cat} onChange={toggleCat} />
        <p className="mt-2 text-sm text-muted">คลิกที่แมวเพื่อลูบ (มีความสำเร็จซ่อนอยู่นะ)</p>
        <p className="mt-4 text-xs text-muted">💡 ลองกด ↑ ↑ ↓ ↓ ← → ← → B A ดูสิ</p>
      </Card>
    </div>
  );
}

// ---------- สั่งด้วยเสียง ----------
function Voice() {
  const nav = useNavigate();
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState<string[]>([]);
  // คำสั่ง: ชื่อหน้าภาษาอังกฤษ + คำพิเศษ (ตัวรู้จำเสียงออฟไลน์ของ Windows มีแต่ภาษาอังกฤษ)
  const commands = useMemo(
    () => [
      ...NAV.map((n) => ({ words: [n.label.en.toLowerCase(), n.label.th], path: n.path, label: n.label.th })),
      { words: ["home", "go home"], path: "/", label: "หน้าแรก" },
      { words: ["download"], path: "/download", label: "โหลดคลิป" },
      { words: ["convert"], path: "/convert", label: "แปลงไฟล์" },
      { words: ["compress"], path: "/compress", label: "บีบอัด" },
      { words: ["clean", "clean up"], path: "/cleaner", label: "ล้างเครื่อง" },
      { words: ["record screen", "screen recorder"], path: "/utilities?tool=record", label: "อัดหน้าจอ" },
    ],
    [],
  );
  const handle = async (t: string) => {
    const s = t.toLowerCase().replace(/\s/g, "");
    if (/ล็อก|lock/.test(s)) {
      lockIfPin();
      return "🔒 ล็อกโปรแกรม";
    }
    if (/แมว|cat/.test(s)) {
      localStorage.setItem("mtb-cat", "1");
      window.dispatchEvent(new Event("mtb-cat"));
      return "🐱 เรียกแมว";
    }
    if (/stoprecording|หยุดอัด/.test(s)) {
      const p = await call<string>("rec_stop").catch((e) => `⚠️ ${e}`);
      return `⏹ ${p}`;
    }
    const hit = commands.find((c) => c.words.some((w) => s.includes(w.toLowerCase().replace(/\s/g, ""))));
    if (hit) {
      nav(hit.path);
      return `➡️ ไปหน้า ${hit.label}`;
    }
    return "🤔 ไม่รู้จักคำสั่ง";
  };
  const start = async () => {
    setListening(true);
    const words = [...new Set([...commands.flatMap((c) => c.words.filter((w) => /^[a-z ]+$/.test(w))), "lock", "cat", "stop recording"])];
    try {
      const r = await call<{ text: string; culture: string }>("voice_listen", { words, seconds: 6 });
      const msg = r.text ? `"${r.text}" → ${await handle(r.text)}` : "🔇 ไม่ได้ยินคำสั่ง ลองพูดใหม่ชัด ๆ";
      setHeard((h) => [msg, ...h].slice(0, 10));
    } catch (e) {
      setHeard((h) => [`⚠️ ${String(e)}`, ...h].slice(0, 10));
    } finally {
      setListening(false);
    }
  };
  return (
    <Card title="สั่งงานด้วยเสียง (ออฟไลน์)">
      <div className="flex flex-col items-center gap-4 py-4">
        <button onClick={start} disabled={listening} className={`grid h-24 w-24 place-items-center rounded-full bg-gradient-to-br from-accent to-accent2 shadow-xl ${listening ? "animate-pulse" : ""}`}><Mic size={36} /></button>
        <div className="text-sm text-muted">{listening ? "กำลังฟัง… (6 วินาที)" : 'กดแล้วพูดภาษาอังกฤษ เช่น "download", "player", "settings", "clean", "record screen", "stop recording", "lock", "cat"'}</div>
        <div className="w-full max-w-md space-y-1 text-sm">{heard.map((h, i) => <div key={i} className="rounded bg-fg/5 px-2 py-1">{h}</div>)}</div>
        <p className="max-w-md text-center text-xs text-muted">ใช้ตัวรู้จำเสียงในตัว Windows ทำงานออฟไลน์ 100% · Windows ยังไม่มีตัวรู้จำเสียงภาษาไทยแบบออฟไลน์ จึงสั่งด้วยคำภาษาอังกฤษสั้น ๆ (ชื่อหน้าในเมนูภาษาอังกฤษ)</p>
      </div>
    </Card>
  );
}

// ---------- ความสำเร็จ ----------
function Achievements() {
  const got = useApp((s) => s.achievements);
  const n = Object.keys(got).length;
  const total = Object.keys(ACHIEVEMENTS).length;
  return (
    <Card title={`ความสำเร็จ ${n}/${total}`}>
      <div className="mb-4 h-2 overflow-hidden rounded bg-fg/10"><div className="h-full bg-gradient-to-r from-accent to-accent2" style={{ width: `${(n / total) * 100}%` }} /></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Object.entries(ACHIEVEMENTS).map(([k, a]) => (
          <div key={k} className={`flex items-center gap-3 rounded-xl p-3 ${got[k] ? "bg-accent/15" : "bg-fg/5 opacity-50 grayscale"}`}>
            <div className="text-3xl">{got[k] ? a.icon : "🔒"}</div>
            <div>
              <div className="font-medium">{a.title}</div>
              <div className="text-xs text-muted">{a.desc}</div>
              {got[k] && <div className="text-[10px] text-muted">{formatDate(got[k])}</div>}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
