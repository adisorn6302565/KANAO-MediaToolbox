// ใช้ธีมและสีเน้นกับทั้งโปรแกรม
import type { Settings } from "./api";

export const THEMES = [
  { id: "dark", label: "มืด (ค่าเริ่มต้น)" },
  { id: "light", label: "สว่าง" },
  { id: "cyberpunk", label: "Cyberpunk" },
  { id: "ocean", label: "Ocean" },
  { id: "sunset", label: "Sunset" },
  { id: "custom", label: "ธีมที่สร้างเอง" },
];

export const ACCENTS = ["#a855f7", "#22d3ee", "#ff2bd6", "#a3e635", "#fbbf24", "#f97316", "#3b82f6", "#ef4444"];

export function hexToRgb(hex: string): string | null {
  const m = hex.trim().match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return null;
  return `${parseInt(m[1], 16)} ${parseInt(m[2], 16)} ${parseInt(m[3], 16)}`;
}

export const CUSTOM_KEYS = [
  { key: "bg", label: "พื้นหลัง" },
  { key: "bg2", label: "พื้นหลัง (ไล่สี)" },
  { key: "fg", label: "ตัวอักษร" },
  { key: "muted", label: "ตัวอักษรรอง" },
  { key: "accent", label: "สีหลัก" },
  { key: "accent2", label: "สีรอง" },
];

export function applyTheme(s: Pick<Settings, "theme" | "accent" | "customTheme"> & { fullEffects?: boolean }) {
  const root = document.documentElement;
  // โหมดประหยัดเครื่อง: ปิดกระจกฝ้า (backdrop-filter กิน GPU ทุกครั้งที่จอขยับ) และแอนิเมชันวนซ้ำ
  root.toggleAttribute("data-lite", !s.fullEffects);
  const isCustom = s.theme === "custom";
  root.dataset.theme = isCustom ? "dark" : s.theme;
  root.classList.toggle("dark", s.theme !== "light");
  // ล้างค่าที่เคยตั้งไว้ก่อน
  for (const k of CUSTOM_KEYS) root.style.removeProperty(`--${k.key}`);
  if (isCustom) {
    for (const k of CUSTOM_KEYS) {
      const rgb = hexToRgb(s.customTheme?.[k.key] ?? "");
      if (rgb) root.style.setProperty(`--${k.key}`, rgb);
    }
  }
  const acc = hexToRgb(s.accent);
  if (acc && !(isCustom && s.customTheme?.accent) && s.accent !== "#a855f7") root.style.setProperty("--accent", acc);
}
