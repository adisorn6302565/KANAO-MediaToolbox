// โครงหลักของโปรแกรม: แถบเมนู, แถบบน, toast, ล็อก PIN, คีย์ลัด, ทัวร์, แมวน้อย
import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { Lock, ChevronsLeft, ChevronsRight, EyeOff, Activity, CheckCircle2, AlertTriangle, Info, X } from "lucide-react";
import { NAV, GROUP_LABEL, DEFAULT_SHORTCUTS, comboOf, type Lang } from "@/lib/nav";
import { lockIfPin, useApp } from "@/store/app";
import { api, call, isTauri, listen } from "@/lib/api";
import { Modal, Kbd } from "./ui";
import { applyTheme } from "@/lib/theme";
import { startAutomation } from "@/lib/automation";

export function Layout({ children }: { children: ReactNode }) {
  const settings = useApp((s) => s.settings);
  const locked = useApp((s) => s.locked);
  const jobs = useApp((s) => s.jobs);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("mtb-collapsed") === "1");
  const lang = (settings?.language ?? "th") as Lang;
  const nav = useNavigate();
  const loc = useLocation();
  const running = Object.values(jobs).filter((j) => j.status === "running").length;
  const queued = Object.values(jobs).filter((j) => j.status === "queued").length;

  useEffect(() => {
    if (settings) applyTheme(settings);
  }, [settings]);

  // นับหน้าที่เคยเปิด → ความสำเร็จ "นักสำรวจ"
  useEffect(() => {
    const visited = new Set<string>(JSON.parse(localStorage.getItem("mtb-visited") || "[]"));
    visited.add(loc.pathname);
    localStorage.setItem("mtb-visited", JSON.stringify([...visited]));
    if (visited.size >= 10) useApp.getState().unlock("explorer");
  }, [loc.pathname]);

  // รับไฟล์ที่ลากมาวาง + ไฟล์ที่เปิดจาก Explorer
  useEffect(() => {
    if (!isTauri) return;
    let un1: (() => void) | undefined;
    let un2: (() => void) | undefined;
    import("@tauri-apps/api/webview").then(({ getCurrentWebview }) =>
      getCurrentWebview()
        .onDragDropEvent((e) => {
          if (e.payload.type === "drop" && e.payload.paths.length) useApp.getState().setDropped(e.payload.paths);
        })
        .then((u) => (un1 = u)),
    );
    listen<string>("open-file", (p) => {
      nav("/player");
      setTimeout(() => useApp.getState().setDropped([p]), 300);
    }).then((u) => (un2 = u));
    return () => {
      un1?.();
      un2?.();
    };
  }, [nav]);

  // ระบบอัตโนมัติ (เฝ้าโฟลเดอร์)
  useEffect(() => startAutomation(), []);

  // อัปเดต yt-dlp อัตโนมัติสัปดาห์ละครั้ง
  useEffect(() => {
    if (!useApp.getState().settings?.autoUpdate) return;
    api.kvGet<number>("ytdlp.lastUpdate", 0).then((last) => {
      if (Date.now() - last < 7 * 86400_000) return;
      call<string>("update_ytdlp")
        .then((out) => {
          api.kvSet("ytdlp.lastUpdate", Date.now());
          api.log("info", "update", out);
        })
        .catch(() => {});
    });
  }, []);

  // ปลั๊กอินที่ตั้งให้รันตอนเปิดโปรแกรม
  useEffect(() => {
    api.kvGet<{ name: string; code: string; enabled: boolean }[]>("dev.plugins", []).then((list) =>
      list.filter((p) => p.enabled).forEach((p) => import("@/pages/Developer").then((m) => m.runPlugin(p)).catch((e) => api.log("error", `plugin:${p.name}`, String(e)))),
    );
  }, []);

  // คีย์ลัด + Konami
  useEffect(() => {
    const konami = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
    let pos = 0;
    const h = (e: KeyboardEvent) => {
      // ล็อกอยู่: ปิดคีย์ลัดทั้งหมด (เปลี่ยนหน้า/เปิดหน้าต่างอยู่ข้างหลังจอล็อกได้)
      if (useApp.getState().locked) return;
      pos = e.key === konami[pos] ? pos + 1 : e.key === konami[0] ? 1 : 0;
      if (pos === konami.length) {
        pos = 0;
        useApp.getState().unlock("konami");
        document.body.animate([{ transform: "rotate(0)" }, { transform: "rotate(360deg)" }], { duration: 900 });
      }
      const target = e.target as HTMLElement;
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
      const map = { ...DEFAULT_SHORTCUTS, ...(useApp.getState().settings?.shortcuts ?? {}) };
      const combo = comboOf(e);
      const action = Object.entries(map).find(([, v]) => v === combo)?.[0];
      if (!action) return;
      if (typing && !combo.includes("Ctrl")) return;
      if (loc.pathname === "/player" && !combo.includes("Ctrl")) return; // หน้าเล่นคลิปมีคีย์ลัดของตัวเอง
      e.preventDefault();
      if (action.startsWith("/")) nav(action);
      else if (action === "panic") call("panic_hide");
      else if (action === "lock") lockIfPin();
      else if (action === "help") useApp.getState().setShortcuts(true);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [nav, loc.pathname]);

  // ล็อกอัตโนมัติเมื่อไม่ใช้งาน
  useEffect(() => {
    const mins = settings?.autoLockMinutes ?? 0;
    if (!mins) return;
    let last = Date.now();
    const bump = () => (last = Date.now());
    const events = ["mousemove", "keydown", "mousedown", "wheel"];
    events.forEach((ev) => window.addEventListener(ev, bump));
    const t = setInterval(async () => {
      if (Date.now() - last > mins * 60_000 && !useApp.getState().locked) {
        if (await call<boolean>("has_pin")) useApp.getState().setLocked(true);
      }
    }, 10_000);
    return () => {
      clearInterval(t);
      events.forEach((ev) => window.removeEventListener(ev, bump));
    };
  }, [settings?.autoLockMinutes]);

  const groups = (["main", "tools", "system"] as const).map((g) => ({ g, items: NAV.filter((n) => n.group === g) }));

  // ล็อกอยู่: ทำให้ทุกอย่างหลังจอล็อกกด/Tab ไปถึงไม่ได้
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const kids = Array.from(rootRef.current?.children ?? []) as HTMLElement[];
    for (const el of kids) {
      if (el.dataset.lockscreen === undefined) el.toggleAttribute("inert", locked);
    }
  }, [locked]);

  return (
    <div ref={rootRef} className="flex h-full">
      <aside className={`glass m-2 mr-0 flex shrink-0 flex-col overflow-hidden rounded-2xl transition-all ${collapsed ? "w-[64px]" : "w-[220px]"}`}>
        <div className="flex items-center gap-2 px-3 py-3">
          <img src="/icon.png" className="h-9 w-9 animate-float rounded-xl" alt="" />
          {!collapsed && (
            <div className="leading-tight">
              <div className="font-display text-[15px] font-semibold gradient-text">มีเดียทูลบ็อกซ์</div>
              <div className="text-[10px] text-muted">MediaToolbox</div>
            </div>
          )}
        </div>
        <nav className="flex-1 space-y-3 overflow-y-auto overflow-x-hidden px-2 pb-2">
          {groups.map(({ g, items }) => (
            <div key={g}>
              {!collapsed && <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">{GROUP_LABEL[g][lang]}</div>}
              {items.map((n) => (
                <NavLink
                  key={n.path}
                  to={n.path}
                  end={n.path === "/"}
                  title={n.label[lang]}
                  className={({ isActive }) =>
                    `mb-0.5 flex items-center gap-3 rounded-xl px-2.5 py-2 text-sm transition ${isActive ? "bg-gradient-to-r from-accent/30 to-accent2/10 text-fg shadow-[inset_2px_0_0_rgb(var(--accent))]" : "text-muted hover:bg-fg/5 hover:text-fg"}`
                  }
                >
                  <n.icon size={18} className="shrink-0" />
                  {!collapsed && <span className="truncate">{n.label[lang]}</span>}
                  {!collapsed && n.path === "/download" && running + queued > 0 && <span className="ml-auto rounded-full bg-accent px-1.5 text-[10px] text-white">{running + queued}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="divider flex items-center justify-between gap-1 p-2">
          {!collapsed && (
            <div className="flex min-w-0 items-center gap-2 px-1">
              <div className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-neon-pink to-accent text-xs">
                {settings?.avatar ? <img src={settings.avatar} className="h-full w-full object-cover" alt="" /> : "😎"}
              </div>
              <span className="truncate text-xs">{settings?.displayName}</span>
            </div>
          )}
          <button className="btn btn-sm" onClick={() => { setCollapsed(!collapsed); localStorage.setItem("mtb-collapsed", collapsed ? "0" : "1"); }} title="ย่อ/ขยายเมนู">
            {collapsed ? <ChevronsRight size={14} /> : <ChevronsLeft size={14} />}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="mx-2 mt-2 flex items-center justify-between gap-3 px-3 py-1.5">
          <div className="flex items-center gap-2 text-xs text-muted">
            <Activity size={14} className={running ? "animate-pulse text-accent2" : ""} />
            {running ? `กำลังทำ ${running} งาน` : "พร้อมใช้งาน"}
            {queued > 0 && ` · รอคิว ${queued}`}
            {!isTauri && <span className="chip bg-amber-500/20 text-amber-300">โหมดดูตัวอย่างในเบราว์เซอร์</span>}
          </div>
          <div className="flex items-center gap-1.5">
            <button className="btn btn-sm" onClick={() => useApp.getState().setShortcuts(true)} title="คีย์ลัด (?)">
              <Kbd>?</Kbd>
            </button>
            <button className="btn btn-sm" onClick={lockIfPin} title="ล็อก (Ctrl+L)">
              <Lock size={13} />
            </button>
            <button className="btn btn-sm text-red-300" onClick={() => call("panic_hide")} title="ปุ่มฉุกเฉิน — ซ่อนทันที (Ctrl+Shift+H)">
              <EyeOff size={13} />
            </button>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-2">{children}</main>
      </div>

      <Toasts />
      <ShortcutsModal />
      {settings && !settings.onboarded && <Tour />}
      {locked && <LockScreen />}
      <Cat />
    </div>
  );
}

function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismiss);
  return (
    <div className="fixed bottom-4 right-4 z-[60] flex w-[360px] flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className="glass flex items-start gap-2 p-3 text-sm shadow-xl animate-fadein" style={{ background: "rgb(var(--bg) / 0.9)" }}>
          {t.kind === "success" ? <CheckCircle2 className="shrink-0 text-lime-400" size={18} /> : t.kind === "error" ? <AlertTriangle className="shrink-0 text-red-400" size={18} /> : <Info className="shrink-0 text-accent2" size={18} />}
          <span className="flex-1 selectable">{t.text}</span>
          <button onClick={() => dismiss(t.id)} className="text-muted hover:text-fg" aria-label="ปิด">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

export const SHORTCUT_LABELS: Record<string, string> = {
  "/": "ไปหน้าแรก",
  "/download": "ไปหน้าโหลดคลิป",
  "/convert": "ไปหน้าแปลงไฟล์",
  "/compress": "ไปหน้าบีบอัด",
  "/editor": "ไปหน้าตัดต่อ",
  "/player": "ไปหน้าดูคลิป",
  "/library": "ไปหน้าคลังไฟล์",
  "/history": "ไปหน้าประวัติ",
  "/settings": "ไปหน้าตั้งค่า",
  panic: "ปุ่มฉุกเฉิน (ซ่อนหน้าต่าง)",
  lock: "ล็อกโปรแกรม",
  help: "เปิดหน้าคีย์ลัด",
};

function ShortcutsModal() {
  const open = useApp((s) => s.shortcutsOpen);
  const custom = useApp((s) => s.settings?.shortcuts);
  if (!open) return null;
  const map = { ...DEFAULT_SHORTCUTS, ...(custom ?? {}) };
  const player = [
    ["Space", "เล่น/หยุด"], ["← / →", "กรอ 5 วินาที"], ["Shift + ← / →", "กรอ 30 วินาที"], ["↑ / ↓", "เสียงดัง/เบา"], ["F", "เต็มจอ"], ["M", "ปิดเสียง"], ["S", "จับภาพหน้าจอ"], ["B", "บุ๊กมาร์ก"], ["[ / ]", "ตั้งจุด A / B"], ["P", "ภาพซ้อน (PiP)"], ["< / >", "ลด/เพิ่มความเร็ว"], ["N", "คลิปถัดไป"],
  ];
  return (
    <Modal title="⌨️ คีย์ลัด" onClose={() => useApp.getState().setShortcuts(false)} wide>
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h4 className="mb-2 font-semibold">ทั่วไป</h4>
          {Object.entries(map).map(([k, v]) => (
            <div key={k} className="flex justify-between border-b border-fg/5 py-1.5 text-sm">
              <span>{SHORTCUT_LABELS[k] ?? k}</span>
              <Kbd>{v}</Kbd>
            </div>
          ))}
          <p className="mt-2 text-xs text-muted">เปลี่ยนคีย์ลัดได้ที่หน้า ปรับแต่ง</p>
        </div>
        <div>
          <h4 className="mb-2 font-semibold">เครื่องเล่นวิดีโอ</h4>
          {player.map(([k, v]) => (
            <div key={k} className="flex justify-between border-b border-fg/5 py-1.5 text-sm">
              <span>{v}</span>
              <Kbd>{k}</Kbd>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function LockScreen() {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const submit = async () => {
    if (await call<boolean>("verify_pin", { pin })) {
      useApp.getState().setLocked(false);
    } else {
      setErr("PIN ไม่ถูกต้อง");
      setPin("");
    }
  };
  return (
    <div data-lockscreen className="fixed inset-0 z-[100] grid place-items-center bg-bg/95 backdrop-blur-xl">
      <div className="glass w-80 p-6 text-center">
        <Lock className="mx-auto mb-3 text-accent" size={40} />
        <h2 className="font-display text-xl font-semibold">โปรแกรมถูกล็อก</h2>
        <p className="mb-4 text-sm text-muted">ใส่ PIN เพื่อเข้าใช้งาน</p>
        <input
          ref={ref}
          type="password"
          inputMode="numeric"
          className="input text-center font-mono text-2xl tracking-[.5em]"
          value={pin}
          maxLength={12}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        {err && <p className="mt-2 text-sm text-red-400">{err}</p>}
        <button className="btn-primary mt-4 w-full" onClick={submit}>
          ปลดล็อก
        </button>
      </div>
    </div>
  );
}

const TOUR = [
  { title: "ยินดีต้อนรับสู่มีเดียทูลบ็อกซ์ 🎉", body: "โปรแกรมเดียวจบ ครบทุกงานมีเดีย ทำงานในเครื่อง 100% ไม่ต้องสมัครสมาชิก" },
  { title: "โหลดคลิป 📥", body: "วางลิงก์จาก YouTube, Facebook (รวมกลุ่ม), TikTok, IG ได้ทีละหลายลิงก์ ปิดหน้าต่างแล้วยังโหลดต่อในถาดระบบ" },
  { title: "แปลง บีบอัด ตัดต่อ ✂️", body: "ลากไฟล์มาวางได้ทุกหน้า มีค่าสำเร็จรูปสำหรับ YouTube / TikTok / IG และใช้การ์ดจอช่วยได้" },
  { title: "ดูคลิปในตัว 🎬", body: "เล่นได้ทุกไฟล์ ซับไทย จำตำแหน่งดูต่อ บุ๊กมาร์ก วน A-B และภาพซ้อน" },
  { title: "ต้องการความช่วยเหลือ? 🙋", body: "ทุกหน้ามีปุ่ม 'ช่วยเหลือ' มุมขวาบน และกด ? เพื่อดูคีย์ลัดได้ตลอด" },
];

function Tour() {
  const [i, setI] = useState(0);
  const done = () => useApp.getState().saveSettings({ onboarded: true });
  const step = TOUR[i];
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/60 backdrop-blur-sm">
      <div className="glass w-[440px] p-6 animate-fadein" style={{ background: "rgb(var(--bg) / 0.95)" }}>
        <div className="mb-1 text-xs text-muted">
          ทัวร์แนะนำ {i + 1}/{TOUR.length}
        </div>
        <h2 className="font-display text-xl font-semibold">{step.title}</h2>
        <p className="mt-2 leading-relaxed text-muted">{step.body}</p>
        <div className="mt-4 flex gap-1">
          {TOUR.map((_, k) => (
            <div key={k} className={`h-1 flex-1 rounded ${k <= i ? "bg-accent" : "bg-fg/10"}`} />
          ))}
        </div>
        <div className="mt-5 flex justify-between">
          <button className="btn" onClick={done}>
            ข้าม
          </button>
          <div className="flex gap-2">
            {i > 0 && (
              <button className="btn" onClick={() => setI(i - 1)}>
                ย้อนกลับ
              </button>
            )}
            <button className="btn-primary" onClick={() => (i < TOUR.length - 1 ? setI(i + 1) : done())}>
              {i < TOUR.length - 1 ? "ถัดไป" : "เริ่มใช้งาน"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** แมวน้อยเดินเล่นด้านล่างหน้าจอ 🐱 (เปิด/ปิดได้ที่หน้า สนุก) */
function Cat() {
  const [on, setOn] = useState(() => localStorage.getItem("mtb-cat") === "1");
  const [x, setX] = useState(200);
  const [dir, setDir] = useState(1);
  const [pet, setPet] = useState(false);
  useEffect(() => {
    const h = () => setOn(localStorage.getItem("mtb-cat") === "1");
    window.addEventListener("mtb-cat", h);
    return () => window.removeEventListener("mtb-cat", h);
  }, []);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => {
      setX((v) => {
        const nx = v + dir * 3;
        if (nx > window.innerWidth - 60 || nx < 240) setDir((d) => -d);
        return nx;
      });
    }, 60);
    return () => clearInterval(t);
  }, [on, dir]);
  if (!on) return null;
  return (
    <button
      className="fixed bottom-1 z-40 select-none text-3xl transition-transform"
      style={{ left: x, transform: `scaleX(${-dir})` }}
      title="ลูบแมว"
      onClick={() => {
        setPet(true);
        useApp.getState().unlock("cat");
        setTimeout(() => setPet(false), 1500);
      }}
    >
      {pet ? "😻" : "🐈"}
    </button>
  );
}

