// หน้า 10: คลังไฟล์ (แกลเลอรี / กรอง / แท็ก / โปรด / สไลด์โชว์)
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Images, Search, Star, Tag, Trash2, FolderInput, Play, X, ChevronLeft, ChevronRight, RefreshCw, FolderOpen, CheckSquare, ListPlus } from "lucide-react";
import { Card, Empty, Field, PageHeader, Select } from "@/components/ui";
import { api, call, confirmDialog, fileUrl, openPath, pickFolder, revealPath, type FileEntry } from "@/lib/api";
import { attempt, useApp } from "@/store/app";
import { useFolderFiles, useKv } from "@/hooks/useData";
import { formatBytes, formatDate, formatDuration } from "@/lib/format";

type Sort = "date" | "name" | "size" | "duration";

export default function Library() {
  const settings = useApp((s) => s.settings);
  const toast = useApp((s) => s.toast);
  const navigate = useNavigate();
  const [dir, setDir] = useKv<string>("library.dir", "");
  const root = dir || settings?.downloadDir;
  const { files, loading, reload } = useFolderFiles(root);
  const [tags, setTags] = useKv<Record<string, string[]>>("library.tags", {});
  const [favs, setFavs] = useKv<string[]>("library.favs", []);
  const [durations, setDurations] = useKv<Record<string, number>>("library.durations", {});
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("all");
  const [ext, setExt] = useState("all");
  const [minMB, setMinMB] = useState(0);
  const [days, setDays] = useState("all");
  const [tagFilter, setTagFilter] = useState("");
  const [onlyFav, setOnlyFav] = useState(false);
  const [sort, setSort] = useState<Sort>("date");
  const [asc, setAsc] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<number | null>(null);
  const [slideshow, setSlideshow] = useState(false);
  const [size, setSize] = useState(200);

  const allTags = useMemo(() => [...new Set(Object.values(tags).flat())].sort(), [tags]);
  const exts = useMemo(() => [...new Set(files.map((f) => f.ext))].sort(), [files]);

  const shown = useMemo(() => {
    const since = days === "all" ? 0 : Date.now() - Number(days) * 86400000;
    const ql = q.toLowerCase();
    const list = files.filter(
      (f) =>
        (kind === "all" || f.kind === kind) &&
        (ext === "all" || f.ext === ext) &&
        f.size >= minMB * 1048576 &&
        f.modified >= since &&
        (!onlyFav || favs.includes(f.path)) &&
        (!tagFilter || tags[f.path]?.includes(tagFilter)) &&
        (!ql || f.name.toLowerCase().includes(ql) || tags[f.path]?.some((t) => t.toLowerCase().includes(ql))),
    );
    const key: Record<Sort, (f: FileEntry) => number | string> = { date: (f) => f.modified, name: (f) => f.name, size: (f) => f.size, duration: (f) => durations[f.path] ?? 0 };
    list.sort((a, b) => {
      const x = key[sort](a);
      const y = key[sort](b);
      const c = typeof x === "string" ? x.localeCompare(y as string, "th", { numeric: true }) : (x as number) - (y as number);
      return asc ? c : -c;
    });
    return list;
  }, [files, kind, ext, minMB, days, onlyFav, favs, tagFilter, tags, q, sort, asc, durations]);

  // เก็บความยาวคลิปไว้ใช้เรียงลำดับ (ดึงทีละน้อยเพื่อไม่ให้เครื่องหน่วง)
  useEffect(() => {
    if (sort !== "duration") return;
    const need = shown.filter((f) => (f.kind === "video" || f.kind === "audio") && durations[f.path] === undefined).slice(0, 30);
    if (!need.length) return;
    (async () => {
      const add: Record<string, number> = {};
      for (const f of need) add[f.path] = await api.probe(f.path).then((p) => Number(p.format?.duration ?? 0)).catch(() => 0);
      setDurations((d) => ({ ...d, ...add }));
    })();
  }, [sort, shown, durations, setDurations]);

  const toggleSel = (p: string) => setSel((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  const selected = [...sel];
  const addTag = (paths: string[]) => {
    const t = prompt("ชื่อแท็ก (คั่นหลายแท็กด้วย ,)");
    if (!t) return;
    const list = t.split(",").map((x) => x.trim()).filter(Boolean);
    setTags((all) => {
      const n = { ...all };
      for (const p of paths) n[p] = [...new Set([...(n[p] ?? []), ...list])];
      return n;
    });
  };
  const moveSel = async () => {
    const d = await pickFolder("ย้ายไปที่");
    if (!d) return;
    await attempt(() => call("move_files", { paths: selected, dest: d, copy: false }), `ย้าย ${selected.length} ไฟล์แล้ว`);
    setSel(new Set());
    reload();
  };
  const deleteSel = async () => {
    if (!(await confirmDialog(`ย้าย ${selected.length} ไฟล์ไปถังขยะ?`))) return;
    await attempt(() => call("delete_files", { paths: selected, permanent: false }), "ย้ายไปถังขยะแล้ว");
    setSel(new Set());
    reload();
  };
  const toPlaylist = async (paths: string[]) => {
    const media = paths.filter((p) => files.find((f) => f.path === p && (f.kind === "video" || f.kind === "audio")));
    const cur = await api.kvGet<string[]>("player.playlist", []);
    await api.kvSet("player.playlist", [...new Set([...cur, ...media])]);
    toast(`เพิ่ม ${media.length} ไฟล์เข้าเพลย์ลิสต์แล้ว`, "success");
  };
  const open = (f: FileEntry) => {
    if (f.kind === "video" || f.kind === "audio") navigate(`/player?file=${encodeURIComponent(f.path)}`);
    else setPreview(shown.indexOf(f));
  };
  const images = shown.filter((f) => f.kind === "image");

  return (
    <div>
      <PageHeader
        title="คลังไฟล์"
        subtitle={`${root ?? ""} · ${files.length} ไฟล์`}
        icon={<Images />}
        actions={
          <>
            <button className="btn" onClick={async () => { const d = await pickFolder(); if (d) setDir(d); }}><FolderOpen size={14} /> เปลี่ยนโฟลเดอร์</button>
            <button className="btn" onClick={reload}><RefreshCw size={14} className={loading ? "animate-spin" : ""} /></button>
            <button className="btn-primary" disabled={!images.length} onClick={() => { setPreview(shown.indexOf(images[0])); setSlideshow(true); }}><Play size={14} /> สไลด์โชว์</button>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[230px_1fr]">
        <Card className="h-fit">
          <div className="space-y-3">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-2.5 text-muted" />
              <input className="input pl-8" placeholder="ค้นหาชื่อหรือแท็ก" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Field label="ชนิด">
              <Select value={kind} onChange={setKind} options={[{ value: "all", label: "ทั้งหมด" }, { value: "video", label: "🎬 วิดีโอ" }, { value: "audio", label: "🎵 เสียง" }, { value: "image", label: "🖼️ รูปภาพ" }]} />
            </Field>
            <Field label="นามสกุล">
              <Select value={ext} onChange={setExt} options={[{ value: "all", label: "ทั้งหมด" }, ...exts.map((e) => ({ value: e, label: e.toUpperCase() }))]} />
            </Field>
            <Field label="วันที่">
              <Select value={days} onChange={setDays} options={[{ value: "all", label: "ทุกช่วง" }, { value: "1", label: "วันนี้" }, { value: "7", label: "7 วัน" }, { value: "30", label: "30 วัน" }, { value: "365", label: "ปีนี้" }]} />
            </Field>
            <Field label={`ขนาดขั้นต่ำ ${minMB} MB`}>
              <input type="range" min={0} max={2000} step={10} value={minMB} onChange={(e) => setMinMB(Number(e.target.value))} className="w-full" />
            </Field>
            <Field label="เรียงตาม">
              <div className="flex gap-1">
                <Select value={sort} onChange={setSort} options={[{ value: "date", label: "วันที่" }, { value: "name", label: "ชื่อ" }, { value: "size", label: "ขนาด" }, { value: "duration", label: "ความยาว" }]} />
                <button className="btn btn-sm" onClick={() => setAsc(!asc)}>{asc ? "↑" : "↓"}</button>
              </div>
            </Field>
            <button className={`btn w-full ${onlyFav ? "!bg-amber-500/30" : ""}`} onClick={() => setOnlyFav(!onlyFav)}><Star size={14} /> รายการโปรด ({favs.length})</button>
            <div>
              <span className="label">แท็ก</span>
              <div className="flex flex-wrap gap-1">
                {allTags.map((t) => (
                  <button key={t} className={`chip ${tagFilter === t ? "!bg-accent text-white" : ""}`} onClick={() => setTagFilter(tagFilter === t ? "" : t)}>#{t}</button>
                ))}
                {!allTags.length && <span className="text-xs text-muted">ยังไม่มีแท็ก</span>}
              </div>
            </div>
            <Field label="ขนาดภาพย่อ">
              <input type="range" min={120} max={360} value={size} onChange={(e) => setSize(Number(e.target.value))} className="w-full" />
            </Field>
          </div>
        </Card>
        <div>
          {sel.size > 0 && (
            <div className="glass sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-xl p-2">
              <span className="px-2 text-sm">เลือก {sel.size} ไฟล์</span>
              <button className="btn btn-sm" onClick={() => setSel(new Set(shown.map((f) => f.path)))}><CheckSquare size={13} /> เลือกทั้งหมด</button>
              <button className="btn btn-sm" onClick={() => addTag(selected)}><Tag size={13} /> ติดแท็ก</button>
              <button className="btn btn-sm" onClick={() => setFavs([...new Set([...favs, ...selected])])}><Star size={13} /> โปรด</button>
              <button className="btn btn-sm" onClick={() => toPlaylist(selected)}><ListPlus size={13} /> เพลย์ลิสต์</button>
              <button className="btn btn-sm" onClick={moveSel}><FolderInput size={13} /> ย้าย</button>
              <button className="btn btn-sm btn-danger" onClick={deleteSel}><Trash2 size={13} /> ลบ</button>
              <button className="btn btn-sm ml-auto" onClick={() => setSel(new Set())}><X size={13} /></button>
            </div>
          )}
          {shown.length === 0 ? (
            <Empty icon={<Images size={36} />} text={loading ? "กำลังโหลด…" : "ไม่พบไฟล์ตามเงื่อนไข"} />
          ) : (
            <div style={{ columnWidth: size }} className="gap-3">
              {shown.slice(0, 600).map((f) => (
                <Tile key={f.path} f={f} selected={sel.has(f.path)} fav={favs.includes(f.path)} tags={tags[f.path] ?? []} duration={durations[f.path]}
                  onOpen={() => open(f)}
                  onSelect={() => toggleSel(f.path)}
                  onFav={() => setFavs(favs.includes(f.path) ? favs.filter((x) => x !== f.path) : [...favs, f.path])}
                  onTag={() => addTag([f.path])}
                  onRemoveTag={(t) => setTags({ ...tags, [f.path]: (tags[f.path] ?? []).filter((x) => x !== t) })}
                />
              ))}
            </div>
          )}
          {shown.length > 600 && <p className="mt-3 text-center text-xs text-muted">แสดง 600 จาก {shown.length} ไฟล์ — ใช้ตัวกรองเพื่อจำกัดผลลัพธ์</p>}
        </div>
      </div>
      {preview !== null && shown[preview] && (
        <Lightbox files={shown} index={preview} onIndex={setPreview} slideshow={slideshow} onClose={() => { setPreview(null); setSlideshow(false); }} />
      )}
    </div>
  );
}

function Tile(props: { f: FileEntry; selected: boolean; fav: boolean; tags: string[]; duration?: number; onOpen: () => void; onSelect: () => void; onFav: () => void; onTag: () => void; onRemoveTag: (t: string) => void }) {
  const { f } = props;
  const [thumb, setThumb] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  // สร้างภาพย่อเมื่อเลื่อนมาเห็นเท่านั้น
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      if (f.kind === "image") setThumb(fileUrl(f.path));
      else if (f.kind === "video") api.thumbnail(f.path).then((t) => setThumb(fileUrl(t))).catch(() => {});
    });
    io.observe(el);
    return () => io.disconnect();
  }, [f]);
  return (
    <div ref={ref} className={`group relative mb-3 break-inside-avoid overflow-hidden rounded-xl border transition ${props.selected ? "border-accent shadow-glow" : "border-fg/10 hover:border-fg/30"}`}>
      <div onClick={props.onOpen} onContextMenu={(e) => { e.preventDefault(); revealPath(f.path); }} className="cursor-pointer bg-black/30">
        {thumb ? (
          <img src={thumb} loading="lazy" className="w-full object-cover" style={{ minHeight: 80 }} alt="" onError={() => setThumb("")} />
        ) : (
          <div className="grid aspect-video place-items-center text-4xl">{f.kind === "audio" ? "🎵" : f.kind === "video" ? "🎬" : "📄"}</div>
        )}
        {f.kind === "video" && <div className="absolute inset-0 grid place-items-center opacity-0 transition group-hover:opacity-100"><Play size={36} className="drop-shadow-lg" /></div>}
      </div>
      <input type="checkbox" checked={props.selected} onChange={props.onSelect} className={`absolute left-2 top-2 h-4 w-4 ${props.selected ? "" : "opacity-0 group-hover:opacity-100"}`} />
      <button onClick={props.onFav} className={`absolute right-2 top-2 ${props.fav ? "text-amber-300" : "text-white opacity-0 group-hover:opacity-100"}`}>
        <Star size={16} fill={props.fav ? "currentColor" : "none"} />
      </button>
      {props.duration ? <span className="absolute right-2 top-[calc(100%-4.5rem)] rounded bg-black/70 px-1 font-mono text-[10px]">{formatDuration(props.duration)}</span> : null}
      <div className="p-2">
        <div className="truncate text-xs" title={f.name}>{f.name}</div>
        <div className="flex justify-between text-[10px] text-muted">
          <span>{formatBytes(f.size)}</span>
          <span>{formatDate(f.modified, false)}</span>
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {props.tags.map((t) => (
            <button key={t} className="chip !px-1.5 !py-0 text-[10px]" onClick={() => props.onRemoveTag(t)} title="คลิกเพื่อลบแท็ก">#{t}</button>
          ))}
          <button className="chip !px-1.5 !py-0 text-[10px] opacity-0 group-hover:opacity-100" onClick={props.onTag}>+ แท็ก</button>
        </div>
      </div>
    </div>
  );
}

function Lightbox({ files, index, onIndex, slideshow, onClose }: { files: FileEntry[]; index: number; onIndex: (i: number) => void; slideshow: boolean; onClose: () => void }) {
  const f = files[index];
  const step = (d: number) => {
    // ในสไลด์โชว์ข้ามไฟล์ที่ไม่ใช่รูป
    let i = index;
    for (let k = 0; k < files.length; k++) {
      i = (i + d + files.length) % files.length;
      if (!slideshow || files[i].kind === "image") break;
    }
    onIndex(i);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => {
    if (!slideshow) return;
    const t = setTimeout(() => step(1), 4000);
    return () => clearTimeout(t);
  });
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95 animate-fadein">
      <div className="flex items-center gap-2 p-3 text-sm text-white">
        <span className="flex-1 truncate">{f.name} · {formatBytes(f.size)}</span>
        {slideshow && <span className="chip">สไลด์โชว์ ▶</span>}
        <button className="btn btn-sm" onClick={() => openPath(f.path)}>เปิดด้วยโปรแกรมอื่น</button>
        <button className="btn btn-sm" onClick={onClose}><X size={16} /></button>
      </div>
      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        <button className="absolute left-3 z-10 rounded-full bg-white/10 p-2 hover:bg-white/20" onClick={() => step(-1)}><ChevronLeft /></button>
        {f.kind === "image" ? (
          <img key={f.path} src={fileUrl(f.path)} className="max-h-full max-w-full object-contain animate-fadein" alt="" />
        ) : f.kind === "video" ? (
          <video src={fileUrl(f.path)} controls autoPlay className="max-h-full max-w-full" />
        ) : f.kind === "audio" ? (
          <audio src={fileUrl(f.path)} controls autoPlay />
        ) : (
          <div className="text-white">ไม่รองรับการแสดงตัวอย่าง</div>
        )}
        <button className="absolute right-3 z-10 rounded-full bg-white/10 p-2 hover:bg-white/20" onClick={() => step(1)}><ChevronRight /></button>
      </div>
    </div>
  );
}
