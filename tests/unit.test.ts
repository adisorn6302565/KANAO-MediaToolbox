// ทดสอบฟังก์ชันบริสุทธิ์ (ไม่ต้องใช้ Tauri)
import { describe, expect, it } from "vitest";
import { formatBytes, formatDuration, parseTime, joinPath, outputPath, safeName, kindOf, toCSV, basename, dirname, stem, extname, localDateKey } from "@/lib/format";
import { parseAny, toSrt, toVtt, toAss, convert, shift, merge, split, cueAt, parseLrc, detectFormat } from "@/lib/subtitle";
import { buildConvertArgs, defaultConvert, buildCompressVideo, buildCompressImage, buildStripMeta, atempoChain, escFilter } from "@/lib/ffmpeg";
import { isScheduleDue, matches, newRule } from "@/lib/automation";
import { comboOf } from "@/lib/nav";
import { markdownToHtml, toYaml, fromYaml, genPassword, strength, convertTemp, b64encode, b64decode, countText } from "@/pages/tools/TextTools";
import { buildQrText, hexToHsl } from "@/pages/tools/ImageTools";
import { tcToFrames, framesToTc, estimateBpm } from "@/pages/tools/MediaTools";
import { computeRename } from "@/pages/Compressor";
import { parseUrls, detectPlatform } from "@/pages/Downloader";
import { buildTimeline, buildAudioArgs } from "@/pages/Editor";
import { filterHistory } from "@/pages/History";
import { extractHashtags } from "@/pages/Social";
import { newApiKey } from "@/pages/Developer";
import type { HistoryItem } from "@/lib/api";

describe("format", () => {
  it("ขนาดไฟล์และเวลา", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 ** 3)).toBe("5.0 GB");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(3725)).toBe("1:02:05");
    expect(parseTime("1:02:03.5")).toBeCloseTo(3723.5);
    expect(parseTime("90")).toBe(90);
    expect(parseTime("1,5")).toBe(1.5);
    expect(parseTime("abc")).toBeNaN();
  });
  it("พาธภาษาไทย", () => {
    const p = "C:\\ผู้ใช้\\วิดีโอ\\คลิป งานบวช.mkv";
    expect(basename(p)).toBe("คลิป งานบวช.mkv");
    expect(dirname(p)).toBe("C:\\ผู้ใช้\\วิดีโอ");
    expect(stem(p)).toBe("คลิป งานบวช");
    expect(extname(p)).toBe("mkv");
    expect(outputPath(p, "mp4", "_แปลง")).toBe("C:\\ผู้ใช้\\วิดีโอ\\คลิป งานบวช_แปลง.mp4");
    expect(joinPath("C:\\a\\", "\\b", "c.txt")).toBe("C:\\a\\b\\c.txt");
    expect(safeName('ชื่อ:ไฟล์?"ทดสอบ"')).toBe("ชื่อ_ไฟล์__ทดสอบ_");
    expect(kindOf("a.FLAC")).toBe("audio");
  });
  it("CSV มี BOM และ escape เครื่องหมายคำพูด", () => {
    const csv = toCSV([{ a: 'x"y', b: "ไทย" }]);
    expect(csv.startsWith("\ufeff")).toBe(true);
    expect(csv).toContain('"x""y"');
  });
});

describe("subtitle", () => {
  const srt = "1\n00:00:01,000 --> 00:00:02,500\nสวัสดี\n\n2\n00:00:03,000 --> 00:00:04,000\nลาก่อน\n";
  it("อ่าน/เขียน SRT VTT ASS", () => {
    const cues = parseAny(srt);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({ start: 1, end: 2.5, text: "สวัสดี" });
    expect(parseAny(toVtt(cues))).toEqual(cues);
    expect(parseAny(toSrt(cues))).toEqual(cues);
    const ass = toAss(cues);
    expect(detectFormat(ass)).toBe("ass");
    expect(parseAny(ass).map((c) => c.text)).toEqual(["สวัสดี", "ลาก่อน"]);
    expect(convert(srt, "vtt").startsWith("WEBVTT")).toBe(true);
  });
  it("เลื่อนเวลา รวม แยก", () => {
    const cues = parseAny(srt);
    expect(shift(cues, -2)[0].start).toBe(0);
    expect(merge(cues, shift(cues, 10))).toHaveLength(4);
    const [a, b] = split(cues, 2.8);
    expect(a).toHaveLength(1);
    expect(b[0].start).toBeCloseTo(0.2);
    expect(cueAt(cues, 1.2)?.text).toBe("สวัสดี");
  });
  it("อ่าน LRC", () => {
    const l = parseLrc("[00:01.00]บรรทัดหนึ่ง\n[00:05.50]บรรทัดสอง");
    expect(l[0].text).toBe("บรรทัดหนึ่ง");
    expect(l[1].start).toBeCloseTo(5.5);
  });
});

describe("ffmpeg builders", () => {
  it("แปลงพื้นฐาน", () => {
    const a = buildConvertArgs("in.mkv", "out.mp4", { ...defaultConvert });
    expect(a[0]).toBe("-y");
    expect(a).toContain("in.mkv");
    expect(a.at(-1)).toBe("out.mp4");
  });
  it("ความเร็วเกิน 2x แยก atempo หลายตัว", () => {
    expect(atempoChain(4)).toBe("atempo=2,atempo=2");
    expect(atempoChain(0.25)).toBe("atempo=0.5,atempo=0.5");
  });
  it("escape ข้อความ drawtext", () => {
    expect(escFilter("a:b'c")).not.toMatch(/(^|[^\\]):/);
  });
  it("two-pass ได้ 2 คำสั่ง", () => {
    const p = buildCompressVideo("a.mp4", "b.mp4", { mode: "size", crf: 28, targetMB: 10, duration: 60, maxHeight: 720, twoPass: true, codec: "h264", audioKbps: 128, hw: "none" });
    expect(p).toHaveLength(2);
    expect(p[0]).toContain("-pass");
  });
  it("รูปและลบเมตา", () => {
    expect(buildCompressImage("a.jpg", "b.webp", { quality: 80, maxSide: 1920, scalePct: 100, stripExif: true })).toContain("-map_metadata");
    expect(buildStripMeta("a.mp4", "b.mp4")).toContain("copy");
  });
  it("ไทม์ไลน์: 2 คลิป + ทรานซิชัน", () => {
    const { args, duration } = buildTimeline(
      {
        clips: [
          { id: "1", path: "a.mp4", duration: 5, start: 0, end: 5, hasAudio: true },
          { id: "2", path: "b.png", duration: 3, start: 0, end: 3, hasAudio: false },
        ],
        preset: "youtube", transition: "fade", transDur: 1, music: "", musicVol: 0.3, origVol: 1, text: "ทดสอบ", textSize: 48, subtitle: "",
        filter: "none", lut: "", speed: 1, kenBurns: false, overlay: "", chroma: false, chromaColor: "#00ff00", fadeIn: true, fadeOut: true,
      },
      "out.mp4",
    );
    expect(duration).toBeCloseTo(7);
    expect(args.join(" ")).toContain("xfade=transition=fade");
    expect(args).toContain("-loop");
  });
  it("เสียง: pitch + fade", () => {
    const a = buildAudioArgs("in.mp3", "out.mp3", { start: "", end: "", fadeIn: 1, fadeOut: 2, normalize: true, denoise: false, bass: 3, mid: 0, treble: 0, echo: false, reverb: false, volume: 1, pitch: 2, speed: 1, format: "mp3" }, 30);
    const af = a[a.indexOf("-af") + 1];
    expect(af).toContain("asetrate");
    expect(af).toContain("afade=t=out:st=28.000");
  });
});

describe("automation / rename / downloader", () => {
  it("กฎเฝ้าโฟลเดอร์", () => {
    const r = { ...newRule(), exts: ["MOV"], minSizeMB: 1 };
    expect(matches(r, { name: "a.mov", size: 2 * 1024 * 1024 })).toBe(true);
    expect(matches(r, { name: "a.mov", size: 100 })).toBe(false);
    expect(matches(r, { name: "a_auto.mov", size: 2 * 1024 * 1024 })).toBe(false);
    expect(matches(r, { name: "a.mp4", size: 2 * 1024 * 1024 })).toBe(false);
  });
  it("เปลี่ยนชื่อกลุ่ม", () => {
    const r = computeRename(["C:\\x\\IMG_1.jpg", "C:\\x\\IMG_2.jpg"], { pattern: "ทริป-{n}", find: "", replace: "", regex: false, start: 1, pad: 3, case: "none" });
    expect(r.map((x) => x.to)).toEqual(["C:\\x\\ทริป-001.jpg", "C:\\x\\ทริป-002.jpg"]);
    const r2 = computeRename(["C:\\x\\IMG_1.jpg"], { pattern: "{name}", find: "IMG_(\\d)", replace: "รูป$1", regex: true, start: 1, pad: 1, case: "none" });
    expect(r2[0].to).toBe("C:\\x\\รูป1.jpg");
  });
  it("แยกลิงก์และตรวจแพลตฟอร์ม", () => {
    const urls = parseUrls("ดูนี่ https://youtu.be/abc และ\nhttps://www.facebook.com/groups/123/posts/456 https://youtu.be/abc");
    expect(urls).toHaveLength(2);
    expect(detectPlatform(urls[1]).name).toMatch(/Facebook/);
  });
  it("คีย์ลัด", () => {
    expect(comboOf({ ctrlKey: true, altKey: false, shiftKey: true, key: "H" } as KeyboardEvent)).toBe("Ctrl+Shift+H");
    expect(comboOf({ ctrlKey: false, altKey: false, shiftKey: true, key: "?" } as KeyboardEvent)).toBe("?");
  });
});

describe("tools", () => {
  it("Markdown ปลอดภัยจาก XSS", () => {
    const h = markdownToHtml("# หัว\n\n<script>alert(1)</script> [x](javascript:alert(1))\n\n- [x] ทำแล้ว");
    expect(h).toContain("<h1>หัว</h1>");
    expect(h).not.toContain("<script>");
    expect(h).not.toContain("javascript:");
    expect(h).toContain("checked");
  });
  it("YAML ไป-กลับ", () => {
    const data = { ชื่อ: "ทดสอบ", n: 3, ok: true, list: ["a", "b"], nested: { x: "1.0", arr: [{ k: 1 }, { k: 2 }] } };
    expect(fromYaml(toYaml(data))).toEqual(data);
  });
  it("รหัสผ่าน", () => {
    const p = genPassword(32, { upper: true, lower: true, digit: true, symbol: true, noAmbiguous: true });
    expect(p).toHaveLength(32);
    expect(p).toMatch(/[A-Z]/);
    expect(p).toMatch(/\d/);
    expect(p).not.toMatch(/[O0Il1]/);
    expect(strength(p).score).toBeGreaterThanOrEqual(3);
    expect(strength("1234").score).toBe(0);
  });
  it("Base64 ภาษาไทย / หน่วย / นับคำ", () => {
    expect(b64decode(b64encode("สวัสดี 👋"))).toBe("สวัสดี 👋");
    expect(convertTemp(100, "เซลเซียส", "ฟาเรนไฮต์")).toBe(212);
    expect(convertTemp(0, "เซลเซียส", "เคลวิน")).toBeCloseTo(273.15);
    const c = countText("สวัสดีครับ hello");
    expect(c.words).toBeGreaterThanOrEqual(3);
    expect(c.thai).toBe(10);
  });
  it("QR WiFi / vCard / สี", () => {
    expect(buildQrText("wifi", { ssid: "บ้าน;1", password: "p:w", security: "WPA" })).toBe("WIFI:T:WPA;S:บ้าน\\;1;P:p\\:w;H:false;;");
    expect(buildQrText("vcard", { first: "สมชาย", phone: "0812345678" })).toContain("TEL;TYPE=CELL:0812345678");
    expect(hexToHsl("#ff0000")).toEqual([0, 100, 50]);
  });
  it("timecode", () => {
    expect(tcToFrames("00:00:01:00", 30)).toBe(30);
    expect(framesToTc(tcToFrames("01:02:03:04", 25), 25)).toBe("01:02:03:04");
  });
  it("BPM จากสัญญาณจังหวะ 120", () => {
    const rate = 11025;
    const data = new Float32Array(rate * 10);
    for (let b = 0; b < 20; b++) {
      const s = Math.floor(b * 0.5 * rate);
      for (let i = 0; i < 400; i++) data[s + i] = Math.sin(i / 3) * (1 - i / 400);
    }
    expect(Math.abs(estimateBpm(data, rate) - 120)).toBeLessThanOrEqual(2);
  });
  it("แฮชแท็กไทย / API key / ประวัติ", () => {
    expect(extractHashtags("#เที่ยวไทย #Travel #เที่ยวไทย")[0]).toEqual(["#เที่ยวไทย", 2]);
    expect(newApiKey("x")).toMatch(/^x_[0-9a-f]{48}$/);
    const h = (id: string, kind: string, createdAt: string): HistoryItem => ({ id, kind, title: id, input: "", output: "", status: "done", sizeBefore: 0, sizeAfter: 0, message: "", createdAt });
    const items = [h("a", "download", "2026-09-01T10:00:00Z"), h("b", "convert", "2026-09-10T10:00:00Z")];
    expect(filterHistory(items, { q: "", kind: "convert", status: "all", from: "", to: "" }).map((x) => x.id)).toEqual(["b"]);
    expect(filterHistory(items, { q: "", kind: "all", status: "all", from: "2026-09-05", to: "" }).map((x) => x.id)).toEqual(["b"]);
  });
});

describe("แก้บั๊กจาก QA", () => {
  it("เปลี่ยนชื่อกลุ่มคงตัวพิมพ์นามสกุลเดิม (ไม่เปลี่ยน .JPG → .jpg เอง)", () => {
    const r = computeRename(["C:\\x\\IMG_1.JPG"], { pattern: "{name}", find: "", replace: "", regex: false, start: 1, pad: 1, case: "none" });
    expect(r[0].to).toBe(r[0].from);
    const up = computeRename(["C:\\x\\img.Mp4"], { pattern: "{name}", find: "", replace: "", regex: false, start: 1, pad: 1, case: "upper" });
    expect(up[0].to).toBe("C:\\x\\IMG.Mp4");
  });
  it("งานตั้งเวลารันย้อนหลังได้ถ้าพลาดเวลา แต่ไม่รันซ้ำในวันเดียวกัน", () => {
    const s = { id: "1", name: "a", enabled: true, urls: [], mode: "video" as const, time: "06:00", lastRun: "" };
    const at = (h: number, m: number) => new Date(2026, 8, 18, h, m);
    expect(isScheduleDue(s, at(5, 59))).toBe(false);
    expect(isScheduleDue(s, at(6, 0))).toBe(true);
    expect(isScheduleDue(s, at(9, 30))).toBe(true); // เครื่องหลับตอน 6 โมง
    expect(isScheduleDue({ ...s, lastRun: at(6, 0).toDateString() }, at(9, 30))).toBe(false);
    expect(isScheduleDue({ ...s, enabled: false }, at(9, 30))).toBe(false);
  });
  it("บีบอัดจำกัดด้านสั้น (คลิปแนวตั้งไม่ถูกย่อเกิน)", () => {
    const [args] = buildCompressVideo("a.mp4", "b.mp4", { mode: "crf", crf: 28, targetMB: 0, duration: 0, maxHeight: 1080, twoPass: false, codec: "h264", audioKbps: 128, hw: "none" });
    const vf = args[args.indexOf("-vf") + 1];
    expect(vf).toContain("if(gt(iw,ih)");
  });
  it("วันที่ใช้เวลาเครื่อง ไม่ใช่ UTC", () => {
    expect(localDateKey(new Date(2026, 8, 18, 3, 0))).toBe("2026-09-18");
  });
});
