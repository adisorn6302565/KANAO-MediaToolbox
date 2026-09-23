// หน้า 6: ดูคลิป (Media Player)
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  PlayCircle, Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Maximize, PictureInPicture2, Camera, Bookmark, Repeat, Repeat1, Shuffle,
  Plus, FolderOpen, Trash2, Subtitles, Info, ListVideo, Minimize,
} from "lucide-react";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { Card, Empty, Modal, PageHeader, Select, useFileDrop } from "@/components/ui";
import { api, call, fileUrl, isTauri, pickFiles, pickFolder } from "@/lib/api";
import { useApp } from "@/store/app";
import { useKv } from "@/hooks/useData";
import { AUDIO_EXT, SUB_EXT, VIDEO_EXT, basename, dirname, extname, formatBytes, formatDuration, joinPath, kindOf, parseTime, stem } from "@/lib/format";
import { cueAt, parseAny, type Cue } from "@/lib/subtitle";

interface Meta {
  duration: number;
  width?: number;
  height?: number;
  vcodec?: string;
  acodec?: string;
  bitrate?: number;
  size?: number;
  audioTracks: { index: number; lang: string; title: string; codec: string }[];
  subTracks: { index: number; lang: string; title: string; codec: string }[];
}

interface BookmarkItem {
  t: number;
  label: string;
}

/** WebView2 เล่นได้ตรง ๆ เฉพาะบางฟอร์แมต — ที่เหลือแปลงสดระหว่างเล่น (core::stream) */
const NATIVE = ["mp4", "m4v", "webm", "mov", "mp3", "wav", "ogg", "m4a", "aac", "flac", "opus"];
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];

export default function Player() {
  const toast = useApp((s) => s.toast);
  const settings = useApp((s) => s.settings);
  const [params] = useSearchParams();
  const [playlist, setPlaylist] = useKv<string[]>("player.playlist", []);
  const [resume, setResume] = useKv<Record<string, number>>("player.resume", {});
  const [bookmarks, setBookmarks] = useKv<Record<string, BookmarkItem[]>>("player.bookmarks", {});
  const [current, setCurrent] = useKv<string>("player.current", "");
  const [src, setSrc] = useState("");
  const [meta, setMeta] = useState<Meta | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [repeat, setRepeat] = useState<"off" | "all" | "one">("off");
  const [shuffle, setShuffle] = useState(false);
  const [ab, setAb] = useState<{ a?: number; b?: number }>({});
  const [cues, setCues] = useState<Cue[]>([]);
  const [subSize, setSubSize] = useState(28);
  const [subOffset, setSubOffset] = useState(0);
  const [preparing, setPreparing] = useState("");
  const [showInfo, setShowInfo] = useState(false);
  const [showPanel, setShowPanel] = useState(true);
  const [idle, setIdle] = useState(false);
  const [seekText, setSeekText] = useState("");
  const [audioTrack, setAudioTrack] = useState("0");
  const video = useRef<HTMLVideoElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const lastSave = useRef(0);
  /** เล่นแบบแปลงสด: วิดีโอเริ่มนับเวลาจาก 0 ใหม่ทุกครั้งที่กรอ จึงต้องจำจุดเริ่ม (offset) ไว้บวกเอง */
  const live = useRef<{ path: string; track: string; mode: string; offset: number; duration: number } | null>(null);
  const seekTimer = useRef<number>();
  const pendingSeek = useRef(false);

  const isAudio = current ? AUDIO_EXT.includes(extname(current)) : false;
  const useKvResume = useRef(resume);
  useKvResume.current = resume;

  // ---------- เปิดไฟล์ ----------
  const openFile = useCallback(
    async (path: string, track = "0") => {
      setCurrent(path);
      setMeta(null);
      setCues([]);
      setAb({});
      setAudioTrack(track);
      const ext = extname(path);
      let m: Meta = { duration: 0, audioTracks: [], subTracks: [] };
      try {
        const p = await api.probe(path);
        const v = p.streams?.find((s: any) => s.codec_type === "video" && s.disposition?.attached_pic !== 1);
        const a = p.streams?.find((s: any) => s.codec_type === "audio");
        const tag = (s: any) => ({ index: s.index, lang: s.tags?.language ?? "", title: s.tags?.title ?? "", codec: s.codec_name });
        m = {
          duration: Number(p.format?.duration ?? 0),
          width: v?.width,
          height: v?.height,
          vcodec: v?.codec_name,
          acodec: a?.codec_name,
          bitrate: Number(p.format?.bit_rate ?? 0),
          size: Number(p.format?.size ?? 0),
          audioTracks: p.streams.filter((s: any) => s.codec_type === "audio").map(tag),
          subTracks: p.streams.filter((s: any) => s.codec_type === "subtitle").map(tag),
        };
        setMeta(m);
      } catch {
        /* ไม่มี ffprobe ก็ยังเล่นได้ */
      }
      // ไฟล์ที่ WebView เล่นไม่ได้ (HEVC, MPEG-2, AVI, WMV…) หรือเลือกแทร็กเสียงอื่น → แปลงสดระหว่างเล่น ไม่ต้องรอ
      const needsCodec = m.vcodec && !["h264", "vp8", "vp9", "av1"].includes(m.vcodec);
      const needsTranscode = (!NATIVE.includes(ext) && kindOf(path) !== "other") || needsCodec || track !== "0";
      live.current = null;
      if (needsTranscode && isTauri) {
        const mode = isAudio || AUDIO_EXT.includes(ext) || !m.vcodec ? "none" : m.vcodec === "h264" ? "copy" : "enc";
        const r = useKvResume.current[path];
        const start = r && r > 10 && (!m.duration || r < m.duration - 10) ? r : 0;
        live.current = { path, track, mode, offset: start, duration: m.duration };
        if (start) toast(`▶ เล่นต่อจาก ${formatDuration(start)}`);
        setPreparing(mode === "copy" ? "กำลังเปิดไฟล์…" : "กำลังแปลงสดเพื่อเล่น (ไฟล์นี้ WebView เล่นเองไม่ได้)…");
        try {
          setSrc(await call<string>("play_stream_url", { path, start, track, video: mode }));
        } catch (e) {
          toast(`เปิดไฟล์ไม่สำเร็จ: ${String(e)}`, "error");
          live.current = null;
          setSrc(fileUrl(path));
        }
      } else {
        setSrc(fileUrl(path));
      }
      // ซับไตเติ้ลแยกไฟล์ชื่อเดียวกัน (.srt/.th.srt/.vtt/.ass)
      for (const suf of ["th.srt", "tha.srt", "srt", "th.vtt", "vtt", "ass", "ssa"]) {
        const sp = joinPath(dirname(path), `${stem(path)}.${suf}`);
        const txt = await call<string>("read_text_file", { path: sp }).catch(() => "");
        if (txt) {
          setCues(parseAny(txt));
          break;
        }
      }
      // ซับที่ฝังในไฟล์ → ดึงออกมาเป็น SRT
      if (m.subTracks.length && isTauri) {
        const tmp = await api.tempDir().catch(() => "");
        const sp = joinPath(tmp, `sub-${stem(path).slice(0, 40)}.srt`);
        const thIdx = Math.max(0, m.subTracks.findIndex((s) => /^th/i.test(s.lang)));
        const bitmap = ["hdmv_pgs_subtitle", "dvd_subtitle"].includes(m.subTracks[thIdx].codec);
        if (!bitmap) {
          await api.ffmpegExec(["-y", "-i", path, "-map", `0:s:${thIdx}`, sp]).catch(() => {});
          const txt = await call<string>("read_text_file", { path: sp }).catch(() => "");
          if (txt) setCues((c) => (c.length ? c : parseAny(txt)));
        }
      }
    },
    [setCurrent, toast, isAudio],
  );

  const addToPlaylist = useCallback(
    (paths: string[], play = true) => {
      const media = paths.filter((p) => [...VIDEO_EXT, ...AUDIO_EXT].includes(extname(p)));
      const subs = paths.filter((p) => SUB_EXT.includes(extname(p)));
      if (subs[0]) {
        call<string>("read_text_file", { path: subs[0] }).then((t) => {
          setCues(parseAny(t));
          toast(`โหลดซับ ${basename(subs[0])} แล้ว`, "success");
        });
      }
      if (!media.length) return;
      setPlaylist((pl) => [...pl, ...media.filter((m) => !pl.includes(m))]);
      if (play) openFile(media[0]);
    },
    [openFile, setPlaylist, toast],
  );

  useFileDrop((paths) => addToPlaylist(paths));

  // เปิดจาก ?file= (เช่น จากหน้าแรก / คลังไฟล์ / เปิดด้วยโปรแกรม)
  useEffect(() => {
    const f = params.get("file");
    if (f) addToPlaylist([f]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  // เปิดไฟล์ล่าสุดเมื่อเข้าหน้า
  const restored = useRef(false);
  useEffect(() => {
    if (!restored.current && current && !src && !params.get("file")) {
      restored.current = true;
      openFile(current);
    }
  }, [current, src, openFile, params]);

  // ---------- การควบคุม ----------
  const v = () => video.current;
  const toggle = () => {
    const el = v();
    if (!el) return;
    if (el.paused) el.play().catch(() => {});
    else el.pause();
  };
  /** เวลาจริงในไฟล์ (รวม offset ของโหมดแปลงสด) */
  const now = () => (live.current?.offset ?? 0) + (v()?.currentTime ?? 0);
  const total = () => (live.current ? live.current.duration : v()?.duration || 0);
  const seek = (t: number) => {
    const el = v();
    if (!el) return;
    const L = live.current;
    if (!L) {
      el.currentTime = Math.max(0, Math.min(t, el.duration || t));
      return;
    }
    // แปลงสด: เริ่ม ffmpeg ใหม่ที่ตำแหน่งนั้น (หน่วงนิดหน่อยตอนลากแถบ จะได้ไม่เริ่มซ้ำรัว ๆ)
    const to = Math.max(0, Math.min(t, (L.duration || t + 1) - 0.5));
    setTime(to);
    pendingSeek.current = true;
    clearTimeout(seekTimer.current);
    seekTimer.current = window.setTimeout(async () => {
      L.offset = to;
      const url = await call<string>("play_stream_url", { path: L.path, start: to, track: L.track, video: L.mode }).catch(() => "");
      if (url && live.current === L) setSrc(url);
    }, 250);
  };
  const idx = playlist.indexOf(current);
  const next = (dir = 1) => {
    if (!playlist.length) return;
    let i = shuffle ? Math.floor(Math.random() * playlist.length) : idx + dir;
    if (i >= playlist.length) {
      if (repeat !== "all") return setPlaying(false);
      i = 0;
    }
    if (i < 0) i = playlist.length - 1;
    openFile(playlist[i]);
  };
  const screenshot = async () => {
    const el = v();
    if (!el || isAudio) return;
    const c = document.createElement("canvas");
    c.width = el.videoWidth;
    c.height = el.videoHeight;
    c.getContext("2d")!.drawImage(el, 0, 0);
    const dir = joinPath(settings?.downloadDir ?? "", "ภาพหน้าจอ");
    const path = joinPath(dir, `${stem(current)}_${formatDuration(now()).replace(/:/g, "-")}.png`);
    try {
      await call("write_base64_file", { path, data: c.toDataURL("image/png").split(",")[1] });
      toast(`📸 บันทึกภาพแล้ว: ${basename(path)}`, "success");
    } catch (e) {
      toast(String(e), "error");
    }
  };
  const addBookmark = () => {
    const t = now();
    const label = prompt("ชื่อบุ๊กมาร์ก", `ฉากที่ ${formatDuration(t)}`);
    if (label === null) return;
    setBookmarks((b) => ({ ...b, [current]: [...(b[current] ?? []), { t, label }].sort((x, y) => x.t - y.t) }));
  };
  const fullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else wrap.current?.requestFullscreen();
  };
  const pip = async () => {
    const el = v();
    if (!el) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await el.requestPictureInPicture();
    } catch {
      // WebView2 บางเวอร์ชันไม่รองรับ PiP → ย่อหน้าต่างให้เล็กและอยู่บนสุดแทน
      if (isTauri) {
        const w = getCurrentWindow();
        await w.setAlwaysOnTop(true);
        await w.setSize(new LogicalSize(480, 300));
        setShowPanel(false);
        toast("โหมดหน้าต่างเล็ก (อยู่บนสุด) — กด P อีกครั้งเพื่อคืนขนาด");
      }
    }
  };
  const fitWindow = async () => {
    if (!isTauri || !meta?.width || !meta.height) return;
    const w = getCurrentWindow();
    const scale = Math.min(1, 1600 / meta.width, 900 / meta.height);
    await w.setAlwaysOnTop(false);
    await w.setSize(new LogicalSize(Math.round(meta.width * scale) + 260, Math.round(meta.height * scale) + 200));
  };
  const restoreWindow = async () => {
    if (!isTauri) return;
    const w = getCurrentWindow();
    await w.setAlwaysOnTop(false);
    await w.setSize(new LogicalSize(1360, 860));
    setShowPanel(true);
  };

  // ---------- คีย์ลัด ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      const el = v();
      if (!el) return;
      const k = e.key.toLowerCase();
      const handled = true;
      switch (k) {
        case " ":
        case "k":
          toggle();
          break;
        case "arrowleft":
          seek(now() - (e.shiftKey ? 30 : 5));
          break;
        case "arrowright":
          seek(now() + (e.shiftKey ? 30 : 5));
          break;
        case "arrowup":
          el.volume = Math.min(1, el.volume + 0.05);
          break;
        case "arrowdown":
          el.volume = Math.max(0, el.volume - 0.05);
          break;
        case "m":
          el.muted = !el.muted;
          break;
        case "f":
          fullscreen();
          break;
        case "s":
          screenshot();
          break;
        case "b":
          addBookmark();
          break;
        case "p":
          if (!showPanel) restoreWindow();
          else pip();
          break;
        case "[":
          setAb((x) => ({ ...x, a: now() }));
          toast(`จุด A = ${formatDuration(now())}`);
          break;
        case "]":
          setAb((x) => ({ ...x, b: now() }));
          toast(`จุด B = ${formatDuration(now())}`);
          break;
        case "\\":
          setAb({});
          break;
        case "n":
          next(1);
          break;
        case ",":
          if (el.paused && !live.current) seek(now() - 1 / 30);
          break;
        case ".":
          if (el.paused && !live.current) seek(now() + 1 / 30);
          break;
        case "<":
          el.playbackRate = Math.max(0.25, el.playbackRate - 0.25);
          break;
        case ">":
          el.playbackRate = Math.min(4, el.playbackRate + 0.25);
          break;
        default:
          if (/^[0-9]$/.test(k)) seek((total() * Number(k)) / 10);
          else return;
      }
      if (handled) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ซ่อนแถบควบคุมเมื่อไม่ขยับเมาส์
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const mv = () => {
      setIdle(false);
      clearTimeout(t);
      t = setTimeout(() => setIdle(true), 2500);
    };
    const el = wrap.current;
    el?.addEventListener("mousemove", mv);
    return () => {
      el?.removeEventListener("mousemove", mv);
      clearTimeout(t);
    };
  }, [src]);

  const onTime = () => {
    const el = v();
    if (!el) return;
    const t = now();
    if (pendingSeek.current) return; // กำลังรอสตรีมใหม่ที่จุดที่กรอไป
    setTime(t);
    if (ab.a !== undefined && ab.b !== undefined && ab.b > ab.a && t >= ab.b) seek(ab.a);
    if (Date.now() - lastSave.current > 5000 && total() > 60) {
      lastSave.current = Date.now();
      setResume((r) => ({ ...r, [current]: t }));
    }
  };
  const onLoaded = () => {
    const el = v();
    if (!el) return;
    setDur(total());
    pendingSeek.current = false;
    setPreparing("");
    el.playbackRate = speed;
    el.volume = volume;
    const r = resume[current];
    if (!live.current && r && r > 10 && r < el.duration - 10) {
      el.currentTime = r;
      toast(`▶ เล่นต่อจาก ${formatDuration(r)}`);
    }
    el.play().catch(() => {});
  };
  const onEnded = () => {
    setResume((r) => {
      const n = { ...r };
      delete n[current];
      return n;
    });
    if (repeat === "one") {
      seek(0);
      v()?.play();
    } else next(1);
  };

  const cue = useMemo(() => cueAt(cues, time - subOffset), [cues, time, subOffset]);
  const marks = bookmarks[current] ?? [];

  const loadSub = async () => {
    const f = await pickFiles({ multiple: false, filters: [{ name: "ซับไตเติ้ล", extensions: [...SUB_EXT, "lrc"] }] });
    if (!f[0]) return;
    const t = await call<string>("read_text_file", { path: f[0] });
    setCues(parseAny(t));
    toast(`โหลดซับ ${basename(f[0])} แล้ว (${parseAny(t).length} บรรทัด)`, "success");
  };
  const openFolder = async () => {
    const d = await pickFolder("เปิดโฟลเดอร์วิดีโอ");
    if (!d) return;
    const files = await api.scan(d, false, true);
    addToPlaylist(files.filter((f) => f.kind === "video" || f.kind === "audio").map((f) => f.path).sort((a, b) => a.localeCompare(b, "th", { numeric: true })));
  };

  return (
    <div className={showPanel ? "" : "-m-6"}>
      {showPanel && (
        <PageHeader
          title="ดูคลิป"
          subtitle="เล่นวิดีโอ/เสียงทุกฟอร์แมต พร้อมซับไทย บุ๊กมาร์ก และเล่นต่อจากเดิม"
          icon={<PlayCircle />}
          actions={
            <>
              <button className="btn" onClick={async () => addToPlaylist(await pickFiles({ filters: [{ name: "มีเดีย", extensions: [...VIDEO_EXT, ...AUDIO_EXT, ...SUB_EXT] }] }))}>
                <Plus size={15} /> เปิดไฟล์
              </button>
              <button className="btn" onClick={() => openFolder()}>
                <FolderOpen size={15} /> เปิดโฟลเดอร์
              </button>
              <button className="btn" onClick={() => settings && api.scan(settings.downloadDir, true, true).then((f) => addToPlaylist(f.filter((x) => x.kind !== "image").sort((a, b) => b.modified - a.modified).slice(0, 50).map((x) => x.path), false))}>
                <ListVideo size={15} /> จากโฟลเดอร์ดาวน์โหลด
              </button>
            </>
          }
        />
      )}
      <div className={`grid gap-4 ${showPanel ? "xl:grid-cols-[1fr_320px]" : ""}`}>
        <div>
          <div ref={wrap} className={`group relative overflow-hidden bg-black ${showPanel ? "rounded-2xl" : ""} ${idle && playing ? "cursor-none" : ""}`}>
            {src ? (
              <>
                {isAudio && (
                  <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-accent/30 to-accent2/20">
                    <div className="text-center">
                      <div className={`mx-auto mb-4 grid h-40 w-40 place-items-center rounded-full bg-gradient-to-br from-accent to-accent2 text-6xl shadow-glow ${playing ? "animate-spin [animation-duration:6s]" : ""}`}>🎵</div>
                      <div className="text-lg font-semibold">{stem(current)}</div>
                    </div>
                  </div>
                )}
                <video
                  ref={video}
                  src={src}
                  className={`${showPanel ? "aspect-video" : "h-screen"} w-full ${isAudio ? "opacity-0" : ""}`}
                  onClick={toggle}
                  onDoubleClick={fullscreen}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onTimeUpdate={onTime}
                  onLoadedMetadata={onLoaded}
                  onEnded={onEnded}
                  onVolumeChange={(e) => {
                    setVolume(e.currentTarget.volume);
                    setMuted(e.currentTarget.muted);
                  }}
                  onRateChange={(e) => setSpeed(e.currentTarget.playbackRate)}
                  onError={() => {
                    setPreparing("");
                    pendingSeek.current = false;
                    toast("เล่นไฟล์นี้ไม่ได้ ลองแปลงเป็น MP4 ในหน้าแปลงไฟล์", "error");
                  }}
                />
                {cue && (
                  <div className="pointer-events-none absolute inset-x-0 bottom-20 text-center">
                    <span className="selectable inline-block whitespace-pre-line rounded-lg bg-black/60 px-3 py-1 font-display leading-snug text-white" style={{ fontSize: subSize, textShadow: "0 2px 4px #000" }}>
                      {cue.text}
                    </span>
                  </div>
                )}
                {/* แถบควบคุม */}
                <div className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-4 pb-3 pt-10 transition-opacity ${idle && playing ? "opacity-0" : "opacity-100"}`}>
                  <div className="relative">
                    <input type="range" min={0} max={dur || 0} step={0.1} value={time} onChange={(e) => seek(Number(e.target.value))} className="w-full accent-[rgb(var(--accent))]" />
                    {marks.map((m) => (
                      <button key={m.t} title={m.label} onClick={() => seek(m.t)} className="absolute -top-1 h-3 w-1.5 -translate-x-1/2 rounded bg-amber-300" style={{ left: `${(m.t / (dur || 1)) * 100}%` }} />
                    ))}
                    {ab.a !== undefined && <div className="absolute -top-1 h-3 w-0.5 bg-lime-300" style={{ left: `${(ab.a / (dur || 1)) * 100}%` }} />}
                    {ab.b !== undefined && <div className="absolute -top-1 h-3 w-0.5 bg-red-400" style={{ left: `${(ab.b / (dur || 1)) * 100}%` }} />}
                  </div>
                  <div className="flex items-center gap-2 text-white">
                    <IconBtn onClick={() => next(-1)} title="ก่อนหน้า"><SkipBack size={18} /></IconBtn>
                    <IconBtn onClick={toggle} title="เล่น/หยุด (Space)">{playing ? <Pause size={22} /> : <Play size={22} />}</IconBtn>
                    <IconBtn onClick={() => next(1)} title="ถัดไป (N)"><SkipForward size={18} /></IconBtn>
                    <span className="font-mono text-xs">
                      {formatDuration(time)} / {formatDuration(dur)}
                    </span>
                    <input
                      className="w-20 rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs outline-none"
                      placeholder="ไปที่…"
                      value={seekText}
                      onChange={(e) => setSeekText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          seek(parseTime(seekText));
                          setSeekText("");
                        }
                      }}
                    />
                    <div className="flex-1" />
                    <IconBtn onClick={() => v() && (v()!.muted = !muted)} title="ปิดเสียง (M)">{muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}</IconBtn>
                    <input type="range" min={0} max={1} step={0.01} value={muted ? 0 : volume} onChange={(e) => v() && ((v()!.volume = Number(e.target.value)), (v()!.muted = false))} className="w-20" />
                    <select value={speed} onChange={(e) => v() && (v()!.playbackRate = Number(e.target.value))} className="rounded bg-white/10 px-1 py-0.5 text-xs">
                      {SPEEDS.map((s) => (
                        <option key={s} value={s} className="bg-black">
                          {s}x
                        </option>
                      ))}
                    </select>
                    <IconBtn onClick={() => setAb((x) => (x.a === undefined ? { a: time } : x.b === undefined ? { ...x, b: time } : {}))} title="วนซ้ำ A-B ([ ] \)" active={ab.a !== undefined}>
                      <span className="text-xs font-bold">{ab.a === undefined ? "A-B" : ab.b === undefined ? "A→" : "A⇄B"}</span>
                    </IconBtn>
                    <IconBtn onClick={screenshot} title="จับภาพ (S)"><Camera size={18} /></IconBtn>
                    <IconBtn onClick={addBookmark} title="บุ๊กมาร์ก (B)"><Bookmark size={18} /></IconBtn>
                    <IconBtn onClick={pip} title="ภาพซ้อน (P)"><PictureInPicture2 size={18} /></IconBtn>
                    {!showPanel && <IconBtn onClick={restoreWindow} title="คืนขนาด"><Minimize size={18} /></IconBtn>}
                    <IconBtn onClick={fullscreen} title="เต็มจอ (F)"><Maximize size={18} /></IconBtn>
                  </div>
                </div>
                {preparing && <div className="absolute inset-0 grid place-items-center bg-black/70 text-sm">{preparing}</div>}
              </>
            ) : (
              <div className="grid aspect-video place-items-center">
                {preparing ? (
                  <div className="animate-pulse text-sm">{preparing}</div>
                ) : (
                  <Empty icon={<PlayCircle size={40} />} text="ลากวิดีโอหรือเพลงมาวางที่นี่เพื่อเล่น">
                    <p className="text-xs text-muted">รองรับ MP4 MKV AVI MOV WEBM FLV WMV M4V · MP3 WAV FLAC AAC OGG M4A · ซับ SRT VTT ASS SSA</p>
                  </Empty>
                )}
              </div>
            )}
          </div>
          {showPanel && current && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <b className="mr-auto truncate">{basename(current)}</b>
              {meta && meta.audioTracks.length > 1 && (
                <Select
                  value={audioTrack}
                  onChange={(t) => openFile(current, t)}
                  options={meta.audioTracks.map((a, i) => ({ value: String(i), label: `🔊 ${a.title || a.lang || `แทร็ก ${i + 1}`} (${a.codec})` }))}
                  className="w-56"
                />
              )}
              <button className="btn btn-sm" onClick={() => setShowInfo(true)}><Info size={13} /> ข้อมูลไฟล์</button>
              <button className="btn btn-sm" onClick={fitWindow} disabled={!meta?.width}>พอดีวิดีโอ</button>
            </div>
          )}
        </div>

        {showPanel && (
          <div className="space-y-4">
            <Card
              title={`เพลย์ลิสต์ (${playlist.length})`}
              actions={
                <>
                  <IconBtn onClick={() => setShuffle(!shuffle)} title="สุ่ม" active={shuffle}><Shuffle size={15} /></IconBtn>
                  <IconBtn onClick={() => setRepeat(repeat === "off" ? "all" : repeat === "all" ? "one" : "off")} title={`วนซ้ำ: ${{ off: "ปิด", all: "ทั้งหมด", one: "เพลงเดียว" }[repeat]}`} active={repeat !== "off"}>
                    {repeat === "one" ? <Repeat1 size={15} /> : <Repeat size={15} />}
                  </IconBtn>
                  <IconBtn onClick={() => setPlaylist([])} title="ล้างเพลย์ลิสต์"><Trash2 size={15} /></IconBtn>
                </>
              }
            >
              <div className="max-h-80 space-y-0.5 overflow-auto">
                {playlist.length === 0 && <p className="py-4 text-center text-xs text-muted">ลากไฟล์เข้ามาเพื่อเพิ่ม</p>}
                {playlist.map((p, i) => (
                  <div key={p} onDoubleClick={() => openFile(p)} onClick={() => openFile(p)} className={`group flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${p === current ? "bg-accent/25 text-fg" : "hover:bg-fg/5"}`}>
                    <span className="w-5 font-mono text-[10px] text-muted">{p === current && playing ? "▶" : i + 1}</span>
                    <span className="flex-1 truncate">{stem(p)}</span>
                    {resume[p] ? <span className="font-mono text-[10px] text-amber-300">{formatDuration(resume[p])}</span> : null}
                    <button className="hidden group-hover:block" onClick={(e) => { e.stopPropagation(); setPlaylist(playlist.filter((x) => x !== p)); }}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </Card>
            <Card title="ซับไตเติ้ล" actions={<button className="btn btn-sm" onClick={loadSub}><Subtitles size={13} /> โหลดซับ</button>}>
              <div className="text-xs text-muted">{cues.length ? `${cues.length} บรรทัด` : "ยังไม่มีซับ (ระบบหาไฟล์ .srt ชื่อเดียวกันให้อัตโนมัติ)"}</div>
              {cues.length > 0 && (
                <div className="mt-2 space-y-2">
                  <label className="flex items-center justify-between text-xs">
                    ขนาด <input type="range" min={14} max={56} value={subSize} onChange={(e) => setSubSize(Number(e.target.value))} />
                  </label>
                  <label className="flex items-center justify-between text-xs">
                    เลื่อนเวลา {subOffset.toFixed(1)} วิ
                    <span className="flex gap-1">
                      <button className="btn btn-sm" onClick={() => setSubOffset(subOffset - 0.5)}>-0.5</button>
                      <button className="btn btn-sm" onClick={() => setSubOffset(0)}>0</button>
                      <button className="btn btn-sm" onClick={() => setSubOffset(subOffset + 0.5)}>+0.5</button>
                    </span>
                  </label>
                  <button className="btn btn-sm w-full" onClick={() => setCues([])}>ปิดซับ</button>
                </div>
              )}
            </Card>
            <Card title={`บุ๊กมาร์ก (${marks.length})`}>
              {marks.length === 0 && <p className="text-xs text-muted">กด B ระหว่างดูเพื่อบันทึกฉากที่ชอบ</p>}
              {marks.map((m, i) => (
                <div key={i} className="group flex items-center gap-2 py-0.5 text-sm">
                  <button className="font-mono text-xs text-accent2" onClick={() => seek(m.t)}>
                    {formatDuration(m.t)}
                  </button>
                  <span className="flex-1 truncate">{m.label}</span>
                  <button className="hidden group-hover:block" onClick={() => setBookmarks((b) => ({ ...b, [current]: marks.filter((_, k) => k !== i) }))}>
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </Card>
          </div>
        )}
      </div>
      {showInfo && meta && (
        <Modal title="ข้อมูลไฟล์" onClose={() => setShowInfo(false)}>
          <table className="w-full text-sm">
            <tbody className="selectable">
              {[
                ["ไฟล์", current],
                ["ขนาด", formatBytes(meta.size ?? 0)],
                ["ความยาว", formatDuration(meta.duration)],
                ["ความละเอียด", meta.width ? `${meta.width} × ${meta.height}` : "-"],
                ["Codec วิดีโอ", meta.vcodec ?? "-"],
                ["Codec เสียง", meta.acodec ?? "-"],
                ["บิตเรต", meta.bitrate ? `${Math.round(meta.bitrate / 1000)} kbps` : "-"],
                ["แทร็กเสียง", meta.audioTracks.map((a) => a.lang || a.codec).join(", ") || "-"],
                ["ซับที่ฝัง", meta.subTracks.map((a) => a.lang || a.codec).join(", ") || "-"],
              ].map(([k, val]) => (
                <tr key={k} className="border-b border-fg/5">
                  <td className="py-1.5 pr-4 text-muted">{k}</td>
                  <td className="break-all py-1.5">{val}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}
    </div>
  );
}

function IconBtn({ children, onClick, title, active }: { children: React.ReactNode; onClick: () => void; title: string; active?: boolean }) {
  return (
    <button onClick={onClick} title={title} className={`grid h-8 min-w-8 place-items-center rounded-lg px-1 transition hover:bg-white/15 ${active ? "text-accent2" : ""}`}>
      {children}
    </button>
  );
}
