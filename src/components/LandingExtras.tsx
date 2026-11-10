import { ArrowRight, Check, PenLine, Wallet } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { RollText, WaveDivider } from "./LandingFx";

const CSS = `
.ff-why { position: relative; z-index: 1; max-width: 1320px; margin: 0 auto; padding: 56px 48px 64px; box-sizing: border-box; font-family: 'Geist', 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif; }
.ff-why h2 { margin: 0; text-align: center; font-size: clamp(34px, 4vw, 56px); font-weight: 500; letter-spacing: -1px; color: #0F1B3D; }
.ff-why h2 em { font-style: italic; font-weight: 800; color: #3D5AF1; }
.ff-why-sub { max-width: 560px; margin: 14px auto 36px; text-align: center; font-size: 18px; line-height: 1.5; color: #5B6478; }
.ff-why-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
.ff-why-card { overflow: hidden; background: #fff; border: 1px solid rgba(61,90,241,.14); border-radius: 22px; box-shadow: 0 18px 38px -30px rgba(36,58,150,.7); }
.ff-why-art { height: 210px; display: flex; flex-direction: column; justify-content: center; gap: 10px; padding: 20px; box-sizing: border-box; background: linear-gradient(135deg, #EDF1FF, #F3EEFF); }
.ff-why-body { padding: 24px; }
.ff-why-body h3 { margin: 0 0 8px; font-size: 22px; font-weight: 700; letter-spacing: -.3px; color: #0F1B3D; }
.ff-why-body p { margin: 0; font-size: 15.5px; line-height: 1.5; color: #5B6478; }
.ff-route { display: flex; align-items: center; gap: 10px; padding: 11px 14px; border-radius: 12px; background: #fff; font-size: 14px; font-weight: 600; color: #3F4A63; box-shadow: 0 6px 14px -10px rgba(36,58,150,.6); }
.ff-chip { padding: 4px 10px; border-radius: 999px; background: rgba(61,90,241,.1); color: #3D5AF1; font-size: 12.5px; font-weight: 700; }
.ff-route-end { margin-left: auto; font-size: 12.5px; color: #15803D; font-weight: 700; }
.ff-flow { display: flex; align-items: center; justify-content: center; gap: 14px; }
.ff-flow-node { width: 74px; height: 74px; border-radius: 20px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; background: #fff; color: #3D5AF1; font-size: 12px; font-weight: 700; box-shadow: 0 10px 20px -12px rgba(36,58,150,.7); }
.ff-logos { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.ff-logos img { width: 100%; max-width: 76px; margin: 0 auto; display: block; border-radius: 18px; box-shadow: 0 10px 20px -12px rgba(36,58,150,.7); }
/* card lift + tilt */
.ff-why-card { position: relative; transition: transform .4s cubic-bezier(.33,1,.68,1), box-shadow .25s; will-change: transform; }
.ff-why-card::after { content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; opacity: 0; transition: opacity .4s cubic-bezier(.33,1,.68,1);
  background: radial-gradient(circle 130px at var(--gx, 50%) var(--gy, 50%), rgba(255,255,255,.55), rgba(255,255,255,0)); }
.ff-why-card:hover::after { opacity: 1; }
.ff-why-card:hover { box-shadow: 0 30px 50px -28px rgba(36,58,150,.75); }
/* 1: USDC flowing into Arc */
.ff-track { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 34px; color: #9AA6C8; }
.ff-coin { position: absolute; left: 0; top: 50%; width: 9px; height: 9px; margin-top: -4.5px; border-radius: 50%; opacity: 0; background: radial-gradient(circle at 35% 30%, #fff, #6F8BFF 50%, #3D5AF1); box-shadow: 0 0 8px rgba(61,90,241,.7);
  animation: ff-coin 4.5s ease-in-out infinite; animation-delay: var(--d, 0s); }
@keyframes ff-coin { 0% { left: -2px; opacity: 0; } 4% { opacity: 1; } 22% { left: calc(100% - 7px); opacity: 1; } 27%, 100% { left: calc(100% - 7px); opacity: 0; } }
.ff-route-end { border-radius: 999px; padding: 3px 8px; margin-right: -8px; animation: ff-native 4.5s ease-out infinite; animation-delay: var(--d, 0s); }
@keyframes ff-native { 0%, 22% { background: transparent; box-shadow: none; } 28% { background: rgba(21,128,61,.12); box-shadow: 0 0 0 4px rgba(21,128,61,.08); } 50%, 100% { background: transparent; box-shadow: none; } }
/* 2: wallet -> sign -> done */
.ff-flow-node { transition: background .35s, color .35s, transform .35s, box-shadow .35s; }
.ff-flow-node.is-on { background: #3D5AF1; color: #fff; transform: translateY(-3px) scale(1.05); box-shadow: 0 14px 24px -12px rgba(61,90,241,.9); }
.ff-flow-node.is-done { background: #16A34A; color: #fff; box-shadow: 0 14px 24px -12px rgba(22,163,74,.9); }
.ff-flow-arrow { display: inline-flex; color: #C3CCEA; transition: color .35s, transform .35s; }
.ff-flow-arrow.is-on { color: #3D5AF1; transform: translateX(3px); }
/* 3: partners floating, linked on hover */
.ff-logos { position: relative; }
.ff-logos::before { content: ""; position: absolute; left: 17%; right: 17%; top: 50%; height: 2px; margin-top: -1px; border-radius: 2px; transform: scaleX(0); transition: transform .5s ease-out;
  background: repeating-linear-gradient(90deg, #3D5AF1 0 8px, transparent 8px 14px); background-size: 28px 2px; animation: ff-link 1s linear infinite; }
.ff-why-card:hover .ff-logos::before { transform: scaleX(1); }
@keyframes ff-link { to { background-position: 28px 0; } }
.ff-logos img { position: relative; animation: ff-bob 4s ease-in-out infinite; }
.ff-logos img:nth-child(2) { animation-delay: -1.3s; }
.ff-logos img:nth-child(3) { animation-delay: -2.6s; }
@keyframes ff-bob { 50% { transform: translateY(-7px); } }
@media (prefers-reduced-motion: reduce) { .ff-coin, .ff-route-end, .ff-logos img, .ff-logos::before { animation: none; } .ff-coin { display: none; } }
.ff-cta { position: relative; z-index: 1; overflow: hidden; padding: 84px 24px; text-align: center; background: radial-gradient(circle at 80% 0%, #4F6BFF 0%, transparent 45%), linear-gradient(120deg, #17248A, #2238C9); font-family: 'Geist', 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif; }
.ff-cta h2 { margin: 0 0 14px; font-size: clamp(34px, 4.2vw, 58px); font-weight: 800; letter-spacing: -1.2px; color: #fff; }
.ff-cta p { margin: 0 auto 30px; max-width: 520px; font-size: 18px; line-height: 1.5; color: #D7DEFF; }
.ff-cta-btns { display: flex; flex-wrap: wrap; justify-content: center; gap: 12px; }
.ff-cta button { display: inline-flex; align-items: center; gap: 8px; padding: 15px 26px; border-radius: 15px; cursor: pointer; font: inherit; font-size: 16px; font-weight: 700; border: 1px solid rgba(255,255,255,.4); background: transparent; color: #fff; }
.ff-cta button.ff-cta-main { background: #fff; color: #2238C9; border-color: #fff; }
.ff-cta > h2, .ff-cta > p, .ff-cta > .ff-cta-btns { position: relative; z-index: 1; }
.ff-cta { padding-top: 110px; }
.ff-spot { position: absolute; inset: 0; pointer-events: none; opacity: 0; transition: opacity .4s;
  background: radial-gradient(circle 280px at var(--sx, 50%) var(--sy, 50%), rgba(255,255,255,.16), rgba(255,255,255,0)); }
.ff-cta:hover .ff-spot { opacity: 1; }
@media (max-width: 960px) { .ff-why { padding: 40px 16px 44px; } .ff-why-grid { grid-template-columns: 1fr; } }
`;

const FLOW = [
  { label: "Wallet", Icon: Wallet },
  { label: "You sign", Icon: PenLine },
  { label: "Done", Icon: Check },
];

// Lights Wallet -> You sign -> Done one after another, then starts over.
function FlowArt() {
  const [step, setStep] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setStep(5); return; }
    let on = true;
    const io = "IntersectionObserver" in window ? new IntersectionObserver(([e]) => { on = e.isIntersecting; }) : null;
    if (ref.current) io?.observe(ref.current);
    const t = window.setInterval(() => { if (on) setStep((s) => (s + 1) % 8); }, 650);
    return () => { window.clearInterval(t); io?.disconnect(); };
  }, []);
  // steps: 0 idle, 1 wallet, 2 arrow, 3 sign, 4 arrow, 5 done, 6-7 hold
  return (
    <div className="ff-flow" ref={ref}>
      {FLOW.map(({ label, Icon }, i) => (
        <Fragment key={label}>
          {i > 0 && <span className={`ff-flow-arrow${step >= i * 2 ? " is-on" : ""}`}><ArrowRight size={18} /></span>}
          <div className={`ff-flow-node${step >= i * 2 + 1 ? (i === 2 ? " is-done" : " is-on") : ""}`}><Icon size={24} />{label}</div>
        </Fragment>
      ))}
    </div>
  );
}

// #153 3D tilt on hover: card lifts and leans toward the mouse, with a soft glare under the cursor.
const tilt = (e: ReactPointerEvent<HTMLElement>) => {
  if (e.pointerType !== "mouse") return;
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width - 0.5;
  const y = (e.clientY - r.top) / r.height - 0.5;
  el.style.transform = `perspective(900px) translateY(-6px) rotateX(${(-y * 8).toFixed(2)}deg) rotateY(${(x * 8).toFixed(2)}deg)`;
  el.style.setProperty("--gx", `${((x + 0.5) * 100).toFixed(1)}%`);
  el.style.setProperty("--gy", `${((y + 0.5) * 100).toFixed(1)}%`);
};
const untilt = (e: ReactPointerEvent<HTMLElement>) => { e.currentTarget.style.transform = ""; };

export function WhyFlowFi() {
  return (
    <section className="ff-why">
      <style>{CSS}</style>
      <h2>Built for <em>USDC</em>. Live on <em>Arc</em>.</h2>
      <p className="ff-why-sub">Move, swap and earn from one simple app, with your own wallet.</p>
      <div className="ff-why-grid">
        <article className="ff-why-card" onPointerMove={tilt} onPointerLeave={untilt}>
          <div className="ff-why-art">
            {[["Base", "Arc"], ["Ethereum", "Arc"], ["Sui", "Arc"]].map(([a, b], i) => (
              <div key={a} className="ff-route" style={{ ["--d" as string]: `${i * 1.5}s` }}>
                <span className="ff-chip">{a}</span>
                <span className="ff-track"><ArrowRight size={15} /><i className="ff-coin" /></span>
                <span className="ff-chip">{b}</span>USDC<span className="ff-route-end">Native</span>
              </div>
            ))}
          </div>
          <div className="ff-why-body"><h3>Move USDC natively</h3><p>Bring USDC to Arc through Circle's own protocol, with no wrapped tokens.</p></div>
        </article>
        <article className="ff-why-card" onPointerMove={tilt} onPointerLeave={untilt}>
          <div className="ff-why-art"><FlowArt /></div>
          <div className="ff-why-body"><h3>You stay in control</h3><p>You sign every transaction with your own wallet. Your keys stay with you.</p></div>
        </article>
        <article className="ff-why-card" onPointerMove={tilt} onPointerLeave={untilt}>
          <div className="ff-why-art"><div className="ff-logos">
            <img src="/logos/ecosystem/morpho.jpg" alt="Morpho" /><img src="/logos/ecosystem/aave.png" alt="Aave" /><img src="/logos/ecosystem/lifi.png" alt="LI.FI" />
          </div></div>
          <div className="ff-why-body"><h3>All in one place</h3><p>Earn with Morpho and Aave, and swap or bridge through LI.FI from one app.</p></div>
        </article>
      </div>
    </section>
  );
}

// #154 Spotlight hover: a soft light follows the cursor across the closing section.
const spot = (e: ReactPointerEvent<HTMLElement>) => {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty("--sx", `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty("--sy", `${e.clientY - r.top}px`);
};

export function ClosingCta({ onConnect, onExplore }: { onConnect: () => void; onExplore: () => void }) {
  return (
    <section className="ff-cta" onPointerMove={spot}>
      <style>{CSS}</style>
      <WaveDivider />
      <div className="ff-spot" aria-hidden="true" />
      <h2>Start moving USDC on Arc</h2>
      <p>Connect your wallet, or look around first.</p>
      <div className="ff-cta-btns">
        <button type="button" className="ff-cta-main" onClick={onConnect}><RollText text="Connect Wallet" /> <ArrowRight size={18} /></button>
        <button type="button" onClick={onExplore}><RollText text="Explore the app" /></button>
      </div>
    </section>
  );
}
