import { ArrowLeftRight, Zap, BarChart3 } from "lucide-react";
import { useEffect, useRef, type ComponentType } from "react";

type Dest = "swap" | "bridge" | "earn";
const BADGES: { dest: Dest; label: string; Icon: ComponentType<{ size?: number; color?: string }> }[] = [
  { dest: "swap", label: "Swap", Icon: ArrowLeftRight },
  { dest: "bridge", label: "Bridge", Icon: Zap },
  { dest: "earn", label: "Earn", Icon: BarChart3 },
];

// Small light points that flow around the coin. rx/ry are fractions of the visual's width/height.
const DOTS = [
  { rx: 0.4, ry: 0.13, speed: 2.3, phase: 0.6, size: 9 },
  { rx: 0.4, ry: 0.13, speed: 2.3, phase: 3.5, size: 6 },
  { rx: 0.33, ry: 0.22, speed: -1.6, phase: 1.9, size: 7 },
  { rx: 0.33, ry: 0.22, speed: -1.6, phase: 4.7, size: 5 },
  { rx: 0.46, ry: 0.17, speed: 1.2, phase: 5.4, size: 6 },
];

const ORBIT_SECONDS = 28; // one full turn of the cards
const TILT = (-14 * Math.PI) / 180; // matches the ring drawn in the image
const COS_T = Math.cos(TILT);
const SIN_T = Math.sin(TILT);
const CENTER_X = 0.5; // coin centre inside the image
const CENTER_Y = 0.36;

const CSS = `
.ff-hv { position: relative; width: 100%; max-width: 720px; perspective: 1100px; }
.ff-hv-stage { position: relative; transition: transform .3s ease-out; will-change: transform; }
.ff-hv img { position: relative; z-index: 2; display: block; width: 100%; height: auto; pointer-events: none; }
.ff-hv-badge { position: absolute; top: 0; left: 0; z-index: 3; display: flex; flex-direction: column; align-items: center; gap: 6px; width: 98px; padding: 15px 6px 12px; border-radius: 22px; cursor: pointer; font: inherit; font-size: 15px; font-weight: 700; color: #0F1B3D;
  background: rgba(255,255,255,.82); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); border: 1px solid #fff; box-shadow: 0 18px 34px -18px rgba(36,58,150,.6); will-change: transform, opacity; transition: box-shadow .2s, color .2s; }
.ff-hv-badge:hover, .ff-hv-badge:focus-visible { color: #3D5AF1; box-shadow: 0 20px 38px -14px rgba(61,90,241,.8); }
.ff-hv-dot { position: absolute; top: 0; left: 0; border-radius: 50%; pointer-events: none; will-change: transform, opacity;
  background: radial-gradient(circle at 35% 30%, #fff, #8FA9FF 45%, #3D5AF1); box-shadow: 0 0 12px 2px rgba(61,90,241,.4); }
@media (max-width: 520px) { .ff-hv-badge { width: 68px; padding: 9px 4px 7px; font-size: 11.5px; border-radius: 16px; } }
`;

export default function HeroVisual({ onOpen }: { onOpen: (dest: Dest) => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const stage = stageRef.current;
    if (!root || !stage) return;
    const badges = Array.from(stage.querySelectorAll<HTMLElement>(".ff-hv-badge"));
    const dots = Array.from(stage.querySelectorAll<HTMLElement>(".ff-hv-dot"));
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let w = 0, h = 0, bw = 0, bh = 0;
    let turn = 0.35; // current orbit angle in radians
    let paused = false;
    let last = 0;
    let raf = 0;

    // Places one element on the tilted ellipse. Lower half = in front of the coin, upper half = behind it.
    const put = (el: HTMLElement, a: number, rx: number, ry: number, ew: number, eh: number, minScale: number, minOpacity: number) => {
      const ex = Math.cos(a) * rx;
      const ey = Math.sin(a) * ry;
      const x = CENTER_X * w + ex * COS_T - ey * SIN_T;
      const y = CENTER_Y * h + ex * SIN_T + ey * COS_T;
      const depth = (Math.sin(a) + 1) / 2; // 0 = far back, 1 = front
      const scale = minScale + (1 - minScale) * depth;
      el.style.transform = `translate(${(x - ew / 2).toFixed(1)}px, ${(y - eh / 2).toFixed(1)}px) scale(${scale.toFixed(3)})`;
      el.style.opacity = (minOpacity + (1 - minOpacity) * depth).toFixed(3);
      el.style.zIndex = Math.sin(a) >= 0 ? "3" : "1";
    };

    const place = () => {
      const rx = w / 2 - bw / 2;
      const ry = h * 0.2;
      badges.forEach((el, i) => put(el, turn + (i * 2 * Math.PI) / badges.length, rx, ry, bw, bh, 0.8, 0.5));
      dots.forEach((el, i) => {
        const d = DOTS[i];
        put(el, turn * d.speed + d.phase, d.rx * w, d.ry * h, d.size, d.size, 0.55, 0.25);
      });
    };

    const measure = () => {
      w = stage.clientWidth;
      h = stage.clientHeight;
      bw = badges[0]?.offsetWidth ?? 0;
      bh = badges[0]?.offsetHeight ?? 0;
      place();
    };

    const tick = (now: number) => {
      const dt = last ? Math.min(now - last, 100) : 0;
      last = now;
      if (!paused) {
        turn += (dt / 1000) * ((2 * Math.PI) / ORBIT_SECONDS);
        place();
      }
      raf = requestAnimationFrame(tick);
    };

    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    measure();
    if (!reduced) raf = requestAnimationFrame(tick);

    const pause = () => { paused = true; };
    const resume = () => { paused = false; };
    badges.forEach((b) => {
      b.addEventListener("pointerenter", pause);
      b.addEventListener("pointerleave", resume);
      b.addEventListener("focus", pause);
      b.addEventListener("blur", resume);
    });

    // The whole visual leans slightly toward the mouse.
    const onMove = (e: PointerEvent) => {
      if (reduced || e.pointerType !== "mouse") return;
      const r = root.getBoundingClientRect();
      const nx = (e.clientX - r.left) / r.width - 0.5;
      const ny = (e.clientY - r.top) / r.height - 0.5;
      stage.style.transform = `rotateY(${(nx * 8).toFixed(2)}deg) rotateX(${(-ny * 8).toFixed(2)}deg)`;
    };
    const onLeave = () => { stage.style.transform = ""; };
    root.addEventListener("pointermove", onMove);
    root.addEventListener("pointerleave", onLeave);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      badges.forEach((b) => {
        b.removeEventListener("pointerenter", pause);
        b.removeEventListener("pointerleave", resume);
        b.removeEventListener("focus", pause);
        b.removeEventListener("blur", resume);
      });
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <div className="ff-hv" ref={rootRef}>
      <style>{CSS}</style>
      <div className="ff-hv-stage" ref={stageRef}>
        <img src="/usdc-hero.webp" alt="USDC on Arc" className="flowfi-float" />
        {DOTS.map((d, i) => (
          <span key={i} className="ff-hv-dot" aria-hidden="true" style={{ width: d.size, height: d.size }} />
        ))}
        {BADGES.map(({ dest, label, Icon }) => (
          <button key={dest} type="button" className="ff-hv-badge" onClick={() => onOpen(dest)}>
            <Icon size={26} color="#3D5AF1" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
