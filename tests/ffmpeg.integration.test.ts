// รันคำสั่ง ffmpeg จริงกับไฟล์ตัวอย่าง (ข้ามถ้าไม่มี ffmpeg ใน PATH)
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildConvertArgs, defaultConvert, buildCompressVideo, buildCompressImage, buildStripMeta } from "@/lib/ffmpeg";
import { buildTimeline, buildAudioArgs } from "@/pages/Editor";

const has = spawnSync("ffmpeg", ["-version"]).status === 0;
const dir = mkdtempSync(join(tmpdir(), "mtb-ทดสอบ-"));
const p = (n: string) => join(dir, n);
const ff = (args: string[]) => {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args], { cwd: dir, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg ${args.join(" ")}\n${r.stderr}`);
};
const ok = (f: string) => expect(existsSync(f) && statSync(f).size > 0).toBe(true);

describe.skipIf(!has)("ffmpeg จริง", () => {
  beforeAll(() => {
    ff(["-y", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=25:duration=4", "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", p("คลิป.mp4")]);
    ff(["-y", "-f", "lavfi", "-i", "testsrc=size=800x600", "-frames:v", "1", p("รูป.png")]);
    ff(["-y", "-f", "lavfi", "-i", "sine=frequency=220:duration=5", p("เสียง.mp3")]);
  }, 60000);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("แปลง", () => {
    ff(buildConvertArgs(p("คลิป.mp4"), p("out.mkv"), { ...defaultConvert }));
    ok(p("out.mkv"));
  }, 60000);

  it("บีบอัด two-pass", () => {
    for (const a of buildCompressVideo(p("คลิป.mp4"), p("small.mp4"), { mode: "size", crf: 28, targetMB: 1, duration: 4, maxHeight: 240, twoPass: true, codec: "h264", audioKbps: 64, hw: "none" })) ff(a);
    ok(p("small.mp4"));
  }, 60000);

  it("บีบอัด CRF", () => {
    for (const a of buildCompressVideo(p("คลิป.mp4"), p("crf.mp4"), { mode: "crf", crf: 30, targetMB: 0, duration: 4, maxHeight: 0, twoPass: false, codec: "h264", audioKbps: 96, hw: "none" })) ff(a);
    ok(p("crf.mp4"));
  }, 60000);

  it("รูปและลบเมตา", () => {
    ff(buildCompressImage(p("รูป.png"), p("รูป.jpg"), { quality: 70, maxSide: 400, scalePct: 100, stripExif: true }));
    ok(p("รูป.jpg"));
    ff(buildStripMeta(p("คลิป.mp4"), p("clean.mp4")));
    ok(p("clean.mp4"));
  }, 60000);

  it("ไทม์ไลน์ + ข้อความ + เพลง", () => {
    const { args } = buildTimeline(
      {
        clips: [
          { id: "1", path: p("คลิป.mp4"), duration: 4, start: 0, end: 3, hasAudio: true },
          { id: "2", path: p("รูป.png"), duration: 2, start: 0, end: 2, hasAudio: false },
        ],
        preset: "hd", transition: "fade", transDur: 0.5, music: p("เสียง.mp3"), musicVol: 0.3, origVol: 1, text: "ทดสอบ: ข้อความ", textSize: 36, subtitle: "",
        filter: "none", lut: "", speed: 1.5, kenBurns: false, overlay: "", chroma: false, chromaColor: "#00ff00", fadeIn: true, fadeOut: true,
      },
      p("timeline.mp4"),
      "C\\:/Windows/Fonts/tahoma.ttf",
    );
    ff(args);
    ok(p("timeline.mp4"));
  }, 120000);

  it("แต่งเสียง", () => {
    ff(buildAudioArgs(p("เสียง.mp3"), p("fx.mp3"), { start: "0.5", end: "4", fadeIn: 1, fadeOut: 1, normalize: true, denoise: true, bass: 4, mid: -2, treble: 2, echo: true, reverb: true, volume: 1.2, pitch: -2, speed: 1.25, format: "mp3" }, 3.5));
    ok(p("fx.mp3"));
  }, 60000);

  it("ฝังซับที่ชื่อไฟล์มี ' [ ] , ; และลายน้ำที่มี % ' : ,", () => {
    const srt = p("ซับ [1], x;y's.srt");
    writeFileSync(srt, "1\n00:00:00,000 --> 00:00:02,000\nสวัสดี\n");
    ff(buildConvertArgs(p("คลิป.mp4"), p("sub.mp4"), { ...defaultConvert, burnSubtitle: srt, watermarkText: "It's 50%: a, b [x];y" }));
    ok(p("sub.mp4"));
  }, 60000);

  it("บีบอัดคลิปแนวตั้งจำกัดด้านสั้น", () => {
    ff(["-y", "-f", "lavfi", "-i", "testsrc=size=360x640:rate=10:duration=1", "-pix_fmt", "yuv420p", p("ตั้ง.mp4")]);
    for (const a of buildCompressVideo(p("ตั้ง.mp4"), p("ตั้งเล็ก.mp4"), { mode: "crf", crf: 30, targetMB: 0, duration: 0, maxHeight: 240, twoPass: false, codec: "h264", audioKbps: 64, hw: "none" })) ff(a);
    const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", p("ตั้งเล็ก.mp4")], { encoding: "utf8" });
    expect(r.stdout.trim()).toBe("240,426");
  }, 60000);
});
