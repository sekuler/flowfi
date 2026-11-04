import { ArrowRight, Check, PenLine, Wallet } from "lucide-react";

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
.ff-cta { position: relative; z-index: 1; overflow: hidden; padding: 84px 24px; text-align: center; background: radial-gradient(circle at 80% 0%, #4F6BFF 0%, transparent 45%), linear-gradient(120deg, #17248A, #2238C9); font-family: 'Geist', 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif; }
.ff-cta h2 { margin: 0 0 14px; font-size: clamp(34px, 4.2vw, 58px); font-weight: 800; letter-spacing: -1.2px; color: #fff; }
.ff-cta p { margin: 0 auto 30px; max-width: 520px; font-size: 18px; line-height: 1.5; color: #D7DEFF; }
.ff-cta-btns { display: flex; flex-wrap: wrap; justify-content: center; gap: 12px; }
.ff-cta button { display: inline-flex; align-items: center; gap: 8px; padding: 15px 26px; border-radius: 15px; cursor: pointer; font: inherit; font-size: 16px; font-weight: 700; border: 1px solid rgba(255,255,255,.4); background: transparent; color: #fff; }
.ff-cta button.ff-cta-main { background: #fff; color: #2238C9; border-color: #fff; }
@media (max-width: 960px) { .ff-why { padding: 40px 16px 44px; } .ff-why-grid { grid-template-columns: 1fr; } }
`;

export function WhyFlowFi() {
  return (
    <section className="ff-why">
      <style>{CSS}</style>
      <h2>Built for <em>USDC</em>. Live on <em>Arc</em>.</h2>
      <p className="ff-why-sub">Move, swap and earn from one simple app, with your own wallet.</p>
      <div className="ff-why-grid">
        <article className="ff-why-card">
          <div className="ff-why-art">
            {[["Base", "Arc"], ["Ethereum", "Arc"], ["Sui", "Arc"]].map(([a, b]) => (
              <div key={a} className="ff-route"><span className="ff-chip">{a}</span><ArrowRight size={15} /><span className="ff-chip">{b}</span>USDC<span className="ff-route-end">Native</span></div>
            ))}
          </div>
          <div className="ff-why-body"><h3>Move USDC natively</h3><p>Bring USDC to Arc through Circle's own protocol, with no wrapped tokens.</p></div>
        </article>
        <article className="ff-why-card">
          <div className="ff-why-art"><div className="ff-flow">
            <div className="ff-flow-node"><Wallet size={24} />Wallet</div><ArrowRight size={18} color="#3D5AF1" />
            <div className="ff-flow-node"><PenLine size={24} />You sign</div><ArrowRight size={18} color="#3D5AF1" />
            <div className="ff-flow-node"><Check size={24} />Done</div>
          </div></div>
          <div className="ff-why-body"><h3>You stay in control</h3><p>You sign every transaction with your own wallet. Your keys stay with you.</p></div>
        </article>
        <article className="ff-why-card">
          <div className="ff-why-art"><div className="ff-logos">
            <img src="/logos/ecosystem/morpho.jpg" alt="Morpho" /><img src="/logos/ecosystem/aave.png" alt="Aave" /><img src="/logos/ecosystem/lifi.png" alt="LI.FI" />
          </div></div>
          <div className="ff-why-body"><h3>All in one place</h3><p>Earn with Morpho and Aave, and swap or bridge through LI.FI from one app.</p></div>
        </article>
      </div>
    </section>
  );
}

export function ClosingCta({ onConnect, onExplore }: { onConnect: () => void; onExplore: () => void }) {
  return (
    <section className="ff-cta">
      <style>{CSS}</style>
      <h2>Start moving USDC on Arc</h2>
      <p>Connect your wallet, or look around first.</p>
      <div className="ff-cta-btns">
        <button type="button" className="ff-cta-main" onClick={onConnect}>Connect Wallet <ArrowRight size={18} /></button>
        <button type="button" onClick={onExplore}>Explore the app</button>
      </div>
    </section>
  );
}
