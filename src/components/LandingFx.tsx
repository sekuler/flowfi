import { useEffect, useRef } from "react";

// Landing page effects, based on the motion-prompt library (showheyohtaki.github.io/motion-prompt):
//   #079 Scroll progress bar, #084 Magnetic button, #156 Text roll on hover, #165 Animated shape divider.

const CSS = `
.ff-progress { position: fixed; top: 0; left: 0; right: 0; height: 4px; z-index: 50; pointer-events: none; }
.ff-progress i { display: block; height: 100%; width: 100%; transform-origin: 0 50%; transform: scaleX(0); background: linear-gradient(90deg, #7C3AED, #3D5AF1 60%, #5B9BFF); box-shadow: 0 0 10px rgba(61,90,241,.45); }
.ff-roll { display: inline-flex; white-space: pre; }
.ff-roll-ch { position: relative; display: inline-block; overflow: hidden; line-height: 1.2; vertical-align: bottom; }
.ff-roll-ch > span { display: block; transition: transform .36s cubic-bezier(.65,0,.35,1); transition-delay: calc(var(--i) * .035s); }
.ff-roll-ch > span + span { position: absolute; left: 0; top: 100%; }
:is(button, a):hover .ff-roll-ch > span, :is(button, a):focus-visible .ff-roll-ch > span { transform: translateY(-100%); }
.ff-wave { position: absolute; left: 0; top: 0; width: 100%; height: 60px; pointer-events: none; z-index: 0; }
@media (prefers-reduced-motion: reduce) { .ff-roll-ch > span { transition: none; } :is(button, a):hover .ff-roll-ch > span { transform: none; } }
`;

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// #156 Text roll on hover: each letter rolls up and an identical copy rises in from below, 0.035 s apart.
export function RollText({ text }: { text: string }) {
  return (
    <span className="ff-roll" aria-label={text}>
      {Array.from(text).map((ch, i) => (
        <span key={i} className="ff-roll-ch" aria-hidden="true" style={{ ["--i" as string]: i }}>
          <span>{ch}</span><span>{ch}</span>
        </span>
      ))}
    </span>
  );
}

// #165 Animated shape divider: two layered waves where the product section meets the closing section.
// Drawn in the FAQ section's colour, hanging down into the blue.
export function WaveDivider() {
  const svgRef = useRef<SVGSVGElement>(null);
  const backRef = useRef<SVGPathElement>(null);
  const frontRef = useRef<SVGPathElement>(null);
  useEffect(() => {
    const svg = svgRef.current, back = backRef.current, front = frontRef.current;
    if (!svg || !back || !front) return;
    const LOOP = 4.7; // seconds per loop, as in the library
    const wave = (w: number, u: number, center: number, parts: [number, number][]) => {
      const ph = (2 * Math.PI * u) / LOOP;
      let d = `M0,0 L${w},0`;
      for (let x = w; x >= 0; x -= 8) {
        let y = center;
        for (const [len, amp] of parts) y += amp * Math.sin((2 * Math.PI * x) / len - ph);
        d += ` L${x},${y.toFixed(1)}`;
      }
      return d + " Z";
    };
    const draw = (u: number) => {
      const w = svg.clientWidth || 1200;
      back.setAttribute("d", wave(w, u, 36, [[650, 12.8], [325, 6.4]]));
      front.setAttribute("d", wave(w, u, 24, [[750, 14.4], [275, 5.6]]));
    };
    if (reducedMotion()) { draw(0); return; }
    let raf = 0, on = true;
    const io = new IntersectionObserver(([e]) => { on = e.isIntersecting; });
    io.observe(svg);
    const t0 = performance.now();
    const tick = (now: number) => { if (on) draw(((now - t0) / 1000) % LOOP); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); io.disconnect(); };
  }, []);
  return (
    <svg ref={svgRef} className="ff-wave" aria-hidden="true">
      <defs>
        <linearGradient id="ff-wave-fill" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#EEF0FF" /><stop offset="1" stopColor="#EEF0FF" />
        </linearGradient>
      </defs>
      <path ref={backRef} fill="url(#ff-wave-fill)" fillOpacity=".45" />
      <path ref={frontRef} fill="url(#ff-wave-fill)" />
    </svg>
  );
}

export default function LandingFx() {
  const barRef = useRef<HTMLElement>(null);

  // #079 Scroll progress bar: fill = how far down the page you are.
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.transform = `scaleX(${max > 0 ? Math.min(1, window.scrollY / max) : 0})`;
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); cancelAnimationFrame(raf); };
  }, []);

  // #084 Magnetic button: near the cursor the button leans 35% of the way toward it,
  // closing 18% of the gap each frame; when the cursor leaves it springs back over 1.1 s (elastic).
  useEffect(() => {
    if (reducedMotion() || !window.matchMedia("(pointer: fine)").matches) return;
    const els = Array.from(document.querySelectorAll<HTMLElement>(".ff-magnet, .ff-cta-main"));
    const st = els.map(() => ({ x: 0, y: 0, tx: 0, ty: 0, inside: false, back: null as null | { t0: number; x: number; y: number } }));
    const elastic = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : Math.pow(2, -10 * x) * Math.sin(((x - 0.075) * 2 * Math.PI) / 0.3) + 1);
    let mx = -9999, my = -9999, last = 0, raf = 0;
    const onMove = (e: PointerEvent) => { mx = e.clientX; my = e.clientY; };
    const tick = (now: number) => {
      const dt = last ? Math.min(now - last, 100) / 1000 : 1 / 60;
      last = now;
      els.forEach((el, i) => {
        const s = st[i];
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2 - s.x, cy = r.top + r.height / 2 - s.y; // resting centre
        const range = Math.max(r.width, r.height) / 2 + 60;
        const inside = Math.hypot(mx - cx, my - cy) < range;
        if (inside) {
          s.back = null;
          s.tx = (mx - cx) * 0.35; s.ty = (my - cy) * 0.35;
          const k = 1 - Math.pow(1 - 0.18, dt * 60);
          s.x += (s.tx - s.x) * k; s.y += (s.ty - s.y) * k;
        } else if (s.inside) {
          s.back = { t0: now, x: s.x, y: s.y };
        }
        s.inside = inside;
        if (s.back) {
          const p = elastic((now - s.back.t0) / 1100);
          s.x = s.back.x * (1 - p); s.y = s.back.y * (1 - p);
          if (now - s.back.t0 >= 1100) { s.back = null; s.x = 0; s.y = 0; }
        }
        el.style.transform = s.x || s.y ? `translate(${s.x.toFixed(2)}px, ${s.y.toFixed(2)}px)` : "";
      });
      raf = requestAnimationFrame(tick);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      els.forEach((el) => { el.style.transform = ""; });
    };
  }, []);

  return (
    <>
      <style>{CSS}</style>
      <div className="ff-progress" aria-hidden="true"><i ref={barRef} /></div>
    </>
  );
}
