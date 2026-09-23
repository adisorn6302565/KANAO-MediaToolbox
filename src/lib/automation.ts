// เครื่องยนต์ระบบอัตโนมัติ: เฝ้าโฟลเดอร์ + กฎ ถ้า-แล้ว + งานตั้งเวลา
import { api, call } from "./api";
import { buildCompressVideo, buildConvertArgs, defaultConvert } from "./ffmpeg";
import { basename, extname, joinPath, outputPath } from "./format";
import { useApp } from "@/store/app";

export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  folder: string;
  /** นามสกุลที่ต้องการ เช่น ["mov"] — ว่าง = ทุกไฟล์ */
  exts: string[];
  /** เงื่อนไขขนาดขั้นต่ำ (MB) — 0 = ไม่ใช้ */
  minSizeMB: number;
  action: "convert" | "compress" | "move" | "copy";
  /** convert: ฟอร์แมตปลายทาง / move,copy: โฟลเดอร์ปลายทาง / compress: crf */
  target: string;
  outDir: string;
  lastRun: number;
  count: number;
}

export interface Schedule {
  id: string;
  name: string;
  enabled: boolean;
  urls: string[];
  mode: "video" | "audio";
  /** HH:MM ทุกวัน */
  time: string;
  lastRun: string;
}

export const RULES_KEY = "automation.rules";
export const SCHEDULES_KEY = "automation.schedules";

export function newRule(): Rule {
  return { id: crypto.randomUUID(), name: "กฎใหม่", enabled: true, folder: "", exts: ["mov"], minSizeMB: 0, action: "convert", target: "mp4", outDir: "", lastRun: Date.now(), count: 0 };
}

/** ตรวจว่าไฟล์เข้าเงื่อนไขกฎหรือไม่ */
export function matches(rule: Rule, f: { name: string; size: number }): boolean {
  const ext = extname(f.name);
  if (rule.exts.length && !rule.exts.map((e) => e.toLowerCase().replace(/^\./, "")).includes(ext)) return false;
  if (rule.minSizeMB > 0 && f.size < rule.minSizeMB * 1024 * 1024) return false;
  if (/_auto\.[^.]+$/.test(f.name)) return false; // ไม่ประมวลผลไฟล์ที่ระบบสร้างเอง
  return true;
}

export async function applyRule(rule: Rule, path: string, size: number) {
  const outDir = rule.outDir || undefined;
  switch (rule.action) {
    case "convert": {
      const out = outputPath(path, rule.target || "mp4", "_auto", outDir);
      await api.ffmpegJob({ kind: "convert", title: `[อัตโนมัติ] ${basename(path)} → ${rule.target}`, input: path, output: out, passes: [buildConvertArgs(path, out, { ...defaultConvert, format: rule.target })] });
      break;
    }
    case "compress": {
      const out = outputPath(path, "mp4", "_auto", outDir);
      const passes = buildCompressVideo(path, out, { mode: "crf", crf: Number(rule.target) || 28, targetMB: 0, duration: 0, maxHeight: 1080, twoPass: false, codec: "h264", audioKbps: 128, hw: "none" });
      await api.ffmpegJob({ kind: "compress", title: `[อัตโนมัติ] บีบอัด ${basename(path)} (${Math.round(size / 1048576)}MB)`, input: path, output: out, passes });
      break;
    }
    case "move":
    case "copy":
      if (rule.target) {
        await call("move_files", { paths: [path], dest: rule.target, copy: rule.action === "copy" });
        api.log("info", "automation", `${rule.action === "copy" ? "คัดลอก" : "ย้าย"} ${basename(path)} → ${rule.target}`);
      }
      break;
  }
}

/** รายชื่อไฟล์ที่กฎนี้เห็นแล้ว — เก็บแยกจากตัวกฎ เพื่อไม่ให้หน้าแก้ไขกฎเขียนทับ */
const seenKey = (ruleId: string) => `automation.seen.${ruleId}`;

/** ขนาดไฟล์รอบก่อน — ไฟล์ใหม่ต้องมีขนาดเท่าเดิม 2 รอบติด (ก๊อปเสร็จแล้ว) ถึงจะเริ่มทำงาน */
const pendingSizes = new Map<string, number>();

/** งานตั้งเวลาที่ควรรันตอนนี้: ถึงเวลาแล้ว (หรือเลยมาแล้ว เช่น เครื่องหลับอยู่) และวันนี้ยังไม่ได้รัน */
export function isScheduleDue(s: Schedule, now: Date): boolean {
  const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return s.enabled && !!s.time && hhmm >= s.time && s.lastRun !== now.toDateString();
}

let started = false;

/** เริ่มลูปเฝ้าโฟลเดอร์ (ทุก 15 วินาที) และงานตั้งเวลา (ทุก 30 วินาที) */
export function startAutomation(): () => void {
  if (started) return () => {};
  started = true;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const rules = await api.kvGet<Rule[]>(RULES_KEY, []);
      const counts: Record<string, number> = {};
      for (const r of rules.filter((r) => r.enabled && r.folder)) {
        // ไม่ใช้ "เวลาแก้ไขไฟล์" ตัดสินว่าไฟล์ใหม่ — ไฟล์ที่ก๊อป/ย้ายมาจะคงเวลาเดิมไว้ จึงถูกข้ามตลอด
        // ใช้รายชื่อไฟล์ที่เคยเห็นแทน
        const files = await api.scan(r.folder, false, false).catch(() => null);
        if (!files) continue;
        const now = Date.now();
        const stored = await api.kvGet<{ folder: string; paths: string[] } | null>(seenKey(r.id), null);
        // ครั้งแรก / กฎเก่า / เพิ่งเปลี่ยนโฟลเดอร์: ไฟล์ที่มีอยู่ก่อนตั้งกฎ (lastRun) ถือว่าเห็นแล้ว
        const seen = new Set(stored?.folder === r.folder ? stored.paths : files.filter((f) => f.modified <= r.lastRun).map((f) => f.path));
        let ran = 0;
        for (const f of files) {
          if (seen.has(f.path)) continue;
          if (!matches(r, f)) {
            seen.add(f.path);
            continue;
          }
          const key = `${r.id}|${f.path}`;
          // ยังเขียนไม่เสร็จ: ขนาดเปลี่ยนจากรอบก่อน หรือเพิ่งแก้ไขไม่ถึง 5 วินาที
          if (pendingSizes.get(key) !== f.size || now - f.modified < 5000) {
            pendingSizes.set(key, f.size);
            continue;
          }
          pendingSizes.delete(key);
          seen.add(f.path);
          ran++;
          await applyRule(r, f.path, f.size).catch((e) => api.log("error", "automation", String(e)));
          useApp.getState().toast(`⚙️ กฎ "${r.name}" ทำงานกับ ${f.name}`);
        }
        // เก็บเฉพาะไฟล์ที่ยังอยู่ในโฟลเดอร์ (รายการจะไม่โตไม่รู้จบ)
        const present = new Set(files.map((f) => f.path));
        await api.kvSet(seenKey(r.id), { folder: r.folder, paths: [...seen].filter((p) => present.has(p)) });
        if (ran) counts[r.id] = ran;
      }
      if (Object.keys(counts).length) {
        // อ่านกฎล่าสุดก่อนเขียน — ผู้ใช้อาจแก้กฎระหว่างที่ลูปนี้ทำงาน
        const latest = await api.kvGet<Rule[]>(RULES_KEY, []);
        await api.kvSet(RULES_KEY, latest.map((r) => (counts[r.id] ? { ...r, count: r.count + counts[r.id] } : r)));
      }

      const schedules = await api.kvGet<Schedule[]>(SCHEDULES_KEY, []);
      const d = new Date();
      const today = d.toDateString();
      let schChanged = false;
      for (const s of schedules.filter((s) => isScheduleDue(s, d))) {
        const st = useApp.getState().settings;
        await api
          .startDownload({ urls: s.urls, mode: s.mode, quality: "best", format: s.mode === "audio" ? "mp3" : "mp4", subtitles: false, subLangs: "", thumbnail: false, metadata: true, playlist: true, liveFromStart: false, outputDir: joinPath(st?.downloadDir ?? "", s.name), template: "", extraArgs: ["--download-archive", joinPath(st?.downloadDir ?? "", s.name, "archive.txt")] })
          .catch((e) => api.log("error", "schedule", String(e)));
        s.lastRun = today;
        schChanged = true;
      }
      if (schChanged) {
        const ran = new Set(schedules.filter((s) => s.lastRun === today).map((s) => s.id));
        const latest = await api.kvGet<Schedule[]>(SCHEDULES_KEY, []);
        await api.kvSet(SCHEDULES_KEY, latest.map((s) => (ran.has(s.id) ? { ...s, lastRun: today } : s)));
      }
    } finally {
      busy = false;
    }
  };
  const t = setInterval(tick, 15_000);
  setTimeout(tick, 3000);
  return () => {
    clearInterval(t);
    started = false;
  };
}
