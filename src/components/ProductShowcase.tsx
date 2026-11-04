import { ArrowRight } from "lucide-react";

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
.ff-show-stage { position: relative; aspect-ratio: 100 / 68; }
.ff-show-card { --tilt: perspective(1500px) rotateX(5deg) rotateY(-9deg) rotate(6deg); position: absolute; overflow: hidden; border-radius: 20px; background: #fff; border: 1px solid #fff; box-shadow: 0 34px 56px -24px rgba(15,27,61,.55), 0 2px 0 rgba(255,255,255,.8) inset; transform: var(--tilt); transition: transform .25s; }
.ff-show-card:hover { transform: var(--tilt) translateY(-8px); z-index: 5; }
.ff-show-card img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: left top; }
.ff-show-home { left: 7%; top: 0; width: 60%; aspect-ratio: 16 / 10; z-index: 1; }
.ff-show-earn { right: 0; top: 13%; width: 41%; aspect-ratio: 16 / 10; z-index: 2; }
.ff-show-bridge { left: 0; bottom: 3%; width: 38%; aspect-ratio: 330 / 250; z-index: 3; }
.ff-show-swap { left: 43%; bottom: 0; width: 38%; aspect-ratio: 307 / 237; z-index: 4; }
@media (max-width: 960px) {
  .ff-show { grid-template-columns: 1fr; padding: 48px 16px; }
  .ff-show h2 { letter-spacing: -1.5px; }
  .ff-show-card { border-radius: 12px; }
}
`;

export default function ProductShowcase({ onOpen }: { onOpen: () => void }) {
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
        <div className="ff-show-stage">
          <div className="ff-show-card ff-show-home"><img src="/showcase/home.jpg" alt="FlowFi home screen" loading="lazy" /></div>
          <div className="ff-show-card ff-show-earn"><img src="/showcase/earn.jpg" alt="FlowFi Earn screen" loading="lazy" /></div>
          <div className="ff-show-card ff-show-bridge"><img src="/showcase/bridge.jpg" alt="FlowFi Bridge screen" loading="lazy" /></div>
          <div className="ff-show-card ff-show-swap"><img src="/showcase/swap.jpg" alt="FlowFi Swap screen" loading="lazy" /></div>
        </div>
      </div>
    </section>
  );
}
