// เสียงแจ้งเตือนสังเคราะห์ด้วย Web Audio (ไม่ต้องมีไฟล์เสียง ทำงานออฟไลน์)
let ctx: AudioContext | null = null;
function ac(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = "sine", gain = 0.2) {
  const c = ac();
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, c.currentTime + start);
  g.gain.setValueAtTime(0.0001, c.currentTime + start);
  g.gain.exponentialRampToValueAtTime(gain, c.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime + start);
  o.stop(c.currentTime + start + dur + 0.05);
}

export const SOUNDS: Record<string, string> = {
  ding: "ติ๊ง",
  chime: "ระฆัง",
  pop: "ป๊อป",
  coin: "เหรียญ",
  none: "ไม่มีเสียง",
};

export function playSound(name: string) {
  try {
    switch (name) {
      case "ding":
        tone(1046, 0, 0.35);
        tone(1568, 0.08, 0.4, "sine", 0.12);
        break;
      case "chime":
        [523, 659, 784, 1046].forEach((f, i) => tone(f, i * 0.09, 0.5, "triangle", 0.15));
        break;
      case "pop":
        tone(400, 0, 0.08, "square", 0.1);
        break;
      case "coin":
        tone(988, 0, 0.08, "square", 0.1);
        tone(1319, 0.08, 0.3, "square", 0.1);
        break;
      case "error":
        tone(220, 0, 0.25, "sawtooth", 0.12);
        tone(180, 0.2, 0.3, "sawtooth", 0.12);
        break;
      // เสียงมีม (สังเคราะห์)
      case "airhorn":
        [0, 0.25, 0.5].forEach((s) => tone(466, s, 0.2, "sawtooth", 0.2));
        break;
      case "sad":
        [392, 370, 349, 330].forEach((f, i) => tone(f, i * 0.35, 0.4, "triangle", 0.2));
        break;
      case "drum":
        tone(80, 0, 0.2, "sine", 0.5);
        tone(200, 0.15, 0.1, "square", 0.1);
        tone(80, 0.3, 0.2, "sine", 0.5);
        break;
      case "tada":
        [523, 659, 784].forEach((f) => tone(f, 0, 0.8, "triangle", 0.12));
        break;
      case "boing":
        {
          const c = ac();
          const o = c.createOscillator();
          const g = c.createGain();
          o.frequency.setValueAtTime(150, c.currentTime);
          o.frequency.exponentialRampToValueAtTime(600, c.currentTime + 0.3);
          g.gain.setValueAtTime(0.2, c.currentTime);
          g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.4);
          o.connect(g).connect(c.destination);
          o.start();
          o.stop(c.currentTime + 0.45);
        }
        break;
      case "tick":
        tone(1500, 0, 0.03, "square", 0.15);
        break;
      case "tock":
        tone(900, 0, 0.03, "square", 0.12);
        break;
    }
  } catch {
    /* เบราว์เซอร์ไม่อนุญาตเสียง */
  }
}

export function audioContext() {
  return ac();
}
