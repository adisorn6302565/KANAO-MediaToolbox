// พื้นหลังอนุภาคเคลื่อนไหว (canvas เบา ๆ หยุดเมื่อหน้าต่างถูกซ่อน)
import { useEffect, useRef } from "react";

export function Particles({ density = 40 }: { density?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    let w = 0;
    let h = 0;
    let raf = 0;
    const resize = () => {
      w = c.width = c.offsetWidth * devicePixelRatio;
      h = c.height = c.offsetHeight * devicePixelRatio;
    };
    resize();
    window.addEventListener("resize", resize);
    const style = getComputedStyle(document.documentElement);
    const accent = style.getPropertyValue("--accent").trim().replace(/ /g, ",");
    const accent2 = style.getPropertyValue("--accent2").trim().replace(/ /g, ",");
    const pts = Array.from({ length: density }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.35 * devicePixelRatio,
      vy: (Math.random() - 0.5) * 0.35 * devicePixelRatio,
      r: (Math.random() * 1.8 + 0.6) * devicePixelRatio,
      c: Math.random() > 0.5 ? accent : accent2,
    }));
    const link = 110 * devicePixelRatio;
    // วาดแค่ ~24 fps และหยุดเมื่อหน้าต่างไม่ได้โฟกัส — canvas ที่ขยับทุกเฟรมทำให้การ์ดโปร่งแสง (backdrop-blur) ต้องวาดใหม่ตลอด
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let lastDraw = 0;
    const tick = (now = 0) => {
      if (!document.hidden && document.hasFocus() && !reduce && now - lastDraw >= 42) {
        lastDraw = now;
        ctx.clearRect(0, 0, w, h);
        for (const p of pts) {
          p.x += p.vx * 2.5;
          p.y += p.vy * 2.5;
          if (p.x < 0 || p.x > w) p.vx *= -1;
          if (p.y < 0 || p.y > h) p.vy *= -1;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${p.c},0.7)`;
          ctx.fill();
        }
        for (let i = 0; i < pts.length; i++)
          for (let j = i + 1; j < pts.length; j++) {
            const dx = pts[i].x - pts[j].x;
            const dy = pts[i].y - pts[j].y;
            const d = Math.hypot(dx, dy);
            if (d < link) {
              ctx.strokeStyle = `rgba(${pts[i].c},${0.18 * (1 - d / link)})`;
              ctx.lineWidth = devicePixelRatio * 0.6;
              ctx.beginPath();
              ctx.moveTo(pts[i].x, pts[i].y);
              ctx.lineTo(pts[j].x, pts[j].y);
              ctx.stroke();
            }
          }
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [density]);
  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" />;
}
