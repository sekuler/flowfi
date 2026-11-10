import { ArrowRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const SLIDES = [
  { src: "/screenshots/2-Home.jpg", label: "Home", alt: "FlowFi home screen" },
  { src: "/screenshots/3-Bridge.jpg", label: "Bridge", alt: "FlowFi Bridge screen" },
  { src: "/screenshots/4-Swap.jpg", label: "Swap", alt: "FlowFi Swap screen" },
  { src: "/screenshots/5-earn-borrow.jpg", label: "Earn", alt: "FlowFi Earn screen" },
  { src: "/screenshots/7-gateway.jpg", label: "Gateway", alt: "FlowFi Gateway screen" },
  { src: "/screenshots/8-dashboard.jpg", label: "Dashboard", alt: "FlowFi Dashboard screen" },
];
const SPIN_SECONDS_PER_SCREEN = 5; // full turn = 6 screens x 5s

const CSS = `
.ff-show-wrap { position: relative; z-index: 1; overflow: hidden; background: linear-gradient(120deg, #F7F7FF 0%, #E8EBFF 55%, #D9DEFF 100%); font-family: 'Geist', 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif; }
.ff-show { max-width: 1920px; margin: 0 auto; display: grid; grid-template-columns: minmax(340px, 5fr) minmax(0, 8fr); align-items: center; gap: 32px; padding: 76px clamp(32px, 5vw, 96px); box-sizing: border-box; }
.ff-show-pill { display: inline-flex; align-items: center; gap: 8px; padding: 8px 16px; border-radius: 999px; background: rgba(255,255,255,.7); border: 1px solid rgba(61,90,241,.22); font-size: 14px; font-weight: 600; color: #3D5AF1; }
.ff-show-pill::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: #22C55E; }
.ff-show h2 { margin: 22px 0 18px; font-size: clamp(42px, 4.5vw, 72px); white-space: nowrap; font-weight: 800; line-height: 1.04; letter-spacing: -2px; color: #0F1B3D; }
.ff-show h2 span { display: block; background: linear-gradient(90deg, #7C3AED, #3B82F6); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
.ff-show p { margin: 0 0 30px; max-width: 360px; font-size: 19px; line-height: 1.5; color: #5B6478; }
.ff-show-cta { display: inline-flex; align-items: center; gap: 10px; padding: 16px 28px; border: 0; border-radius: 16px; cursor: pointer; font: inherit; font-size: 16.5px; font-weight: 700; color: #fff; background: linear-gradient(90deg, #3D5AF1, #5B78FF); box-shadow: 0 16px 28px -14px rgba(61,90,241,.95); transition: transform .18s; }
.ff-show-cta:hover { transform: translateY(-2px); }

.ff-show > div:first-child { position: relative; z-index: 2; }
.ff-cf { position: relative; min-width: 0; }
.ff-cf-stage { position: relative; aspect-ratio: 100 / 56; perspective: 1600px; }
.ff-cf-card { position: absolute; left: 50%; top: 50%; width: 62%; aspect-ratio: 16 / 10; margin: 0; padding: 0; overflow: hidden; border-radius: 18px; background: #fff; border: 1px solid #fff; cursor: pointer;
  box-shadow: 0 34px 56px -24px rgba(15,27,61,.55); will-change: transform, opacity; }
.ff-cf-card img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: center top; pointer-events: none; }
.ff-cf-card[data-active="true"] { cursor: default; box-shadow: 0 44px 70px -26px rgba(15,27,61,.6), 0 0 0 1px rgba(61,90,241,.12); }
.ff-cf-nav { display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 22px; flex-wrap: wrap; }
.ff-cf-tab { padding: 8px 14px; border-radius: 999px; border: 1px solid rgba(61,90,241,.18); background: rgba(255,255,255,.6); font: inherit; font-size: 13.5px; font-weight: 600; color: #5B6478; cursor: pointer; transition: background .25s, color .25s, border-color .25s; }
.ff-cf-tab[aria-pressed="true"] { background: #3D5AF1; border-color: #3D5AF1; color: #fff; }
@media (max-width: 960px) {
  .ff-show { grid-template-columns: 1fr; padding: 48px 16px; }
  .ff-show h2 { letter-spacing: -1.5px; }
  .ff-cf-card { width: 78%; border-radius: 12px; }
  .ff-cf-tab { padding: 6px 11px; font-size: 12.5px; }
}
`;

export default function ProductShowcase({ onOpen }: { onOpen: () => void }) {
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const ctl = useRef({ pos: 0, speed: 1, hover: false, visible: true, target: null as number | null });
  const n = SLIDES.length;

  // Bring a screen to the front by turning the ring the short way round.
  const goTo = (i: number) => {
    const c = ctl.current;
    let d = (i - c.pos) % n;
    if (d > n / 2) d -= n;
    if (d < -n / 2) d += n;
    c.target = c.pos + d;
  };

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const c = ctl.current;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const step = (2 * Math.PI) / n;
    let shown = -1;
    let last = 0;
    let raf = 0;

    const place = () => {
      cardRefs.current.forEach((card, i) => {
        if (!card) return;
        let th = ((i - c.pos) * step) % (2 * Math.PI);
        if (th > Math.PI) th -= 2 * Math.PI;
        if (th < -Math.PI) th += 2 * Math.PI;
        const cos = Math.cos(th);
        const back = 1 - cos; // 0 front, 2 directly behind
        card.style.transform = `translate(-50%, -50%) translateX(${(Math.sin(th) * 47).toFixed(2)}%) translateZ(${(-back * 150).toFixed(1)}px) rotateY(${(th * 0.55 * 180 / Math.PI).toFixed(2)}deg) scale(${(1 - back * 0.1).toFixed(3)})`;
        card.style.opacity = Math.max(0, Math.min(1, (cos - 0.05) / 0.45)).toFixed(3);
        card.style.filter = back > 0.02 ? `saturate(${(1 - back * 0.3).toFixed(2)}) brightness(${(1 - back * 0.08).toFixed(3)})` : "none";
        card.style.zIndex = String(Math.round(cos * 10) + 10);
        card.style.pointerEvents = cos > 0.4 ? "auto" : "none";
      });
      const front = ((Math.round(c.pos) % n) + n) % n;
      if (front !== shown) { shown = front; setActive(front); }
    };

    const tick = (now: number) => {
      const dt = last ? Math.min(now - last, 100) / 1000 : 0;
      last = now;
      if (c.target !== null) {
        c.pos += (c.target - c.pos) * Math.min(1, dt * 5);
        if (Math.abs(c.target - c.pos) < 0.002) { c.pos = c.target; c.target = null; }
        place();
      } else if (!reduced && c.visible) {
        // Slows to a gentle stop under the mouse, picks up again when it leaves.
        c.speed += ((c.hover ? 0 : 1) - c.speed) * Math.min(1, dt * 3);
        c.pos += (dt * c.speed) / SPIN_SECONDS_PER_SCREEN;
        place();
      }
      raf = requestAnimationFrame(tick);
    };

    const io = "IntersectionObserver" in window
      ? new IntersectionObserver(([e]) => { c.visible = e.isIntersecting; }, { threshold: 0.2 })
      : null;
    io?.observe(el);
    place();
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); io?.disconnect(); };
  }, [n]);

  return (
    <section className="ff-show-wrap">
      <style>{CSS}</style>
      <div className="ff-show">
        <div>
          <span className="ff-show-pill">One platform</span>
          <h2 className="flowfi-display">Your DeFi hub<span>on Arc</span></h2>
          <p>Bridge, swap, earn and more, all in one place.</p>
          <button type="button" className="ff-show-cta" onClick={onOpen}>Explore the app <ArrowRight size={17} /></button>
        </div>
        <div className="ff-cf" ref={rootRef} onMouseEnter={() => { ctl.current.hover = true; }} onMouseLeave={() => { ctl.current.hover = false; }}>
          <div className="ff-cf-stage">
            {SLIDES.map((s, i) => (
              <button key={s.src} ref={(b) => { cardRefs.current[i] = b; }} type="button" className="ff-cf-card" data-active={i === active}
                aria-label={`Show ${s.label}`} tabIndex={i === active ? -1 : 0} onClick={() => goTo(i)}>
                <img src={s.src} alt={s.alt} loading="lazy" />
              </button>
            ))}
          </div>
          <div className="ff-cf-nav">
            {SLIDES.map((s, i) => (
              <button key={s.label} type="button" className="ff-cf-tab" aria-pressed={i === active} onClick={() => goTo(i)}>{s.label}</button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
