import type { ReactNode } from "react";

type FooterLink = { label: string; href?: string; onClick?: () => void };
const REPO = "https://github.com/sekuler/flowfi";

const CSS = `
.ff-foot { container-type: inline-size; position: relative; overflow: hidden; background: linear-gradient(180deg, #F8F9FF 0%, #E9EEFF 100%); font-family: 'Geist', 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif; }
.ff-foot::before { content: ""; position: absolute; inset: 0 0 auto; height: 1px; background: linear-gradient(90deg, transparent, #3D5AF1 50%, transparent); opacity: .45; }
.ff-foot-glow { position: absolute; width: 420px; height: 420px; left: -130px; top: -190px; border-radius: 50%; background: radial-gradient(circle, rgba(91,120,255,.2), transparent 68%); pointer-events: none; }
.ff-foot-main { position: relative; padding: 68px clamp(32px, 5vw, 96px) 48px; display: grid; grid-template-columns: auto repeat(3, minmax(110px, 1fr)) auto; gap: 44px; }
.ff-foot-brand { display: flex; align-items: flex-start; gap: 24px; padding-right: 44px; border-right: 1px solid rgba(61,90,241,.18); }
.ff-foot-name { margin: -2px 0 6px; font-family: 'Source Serif 4', Georgia, 'Times New Roman', serif; font-size: 50px; line-height: 1.05; font-weight: 600; letter-spacing: -.01em; color: #0F1B3D; }
.ff-foot-name span { color: #3D5AF1; }
.ff-foot-tag { margin: 0 0 8px; font-size: 19px; font-weight: 600; color: #0F1B3D; white-space: nowrap; }
.ff-foot-desc { margin: 0; font-size: 15px; line-height: 1.5; color: #5B6478; white-space: nowrap; }
.ff-foot h3 { margin: 6px 0 22px; font-size: 13.5px; font-weight: 700; letter-spacing: .15em; text-transform: uppercase; color: #3D5AF1; }
.ff-foot-col { display: flex; flex-direction: column; align-items: flex-start; gap: 16px; }
.ff-foot-link { padding: 0; border: 0; background: none; cursor: pointer; font: inherit; font-size: 17px; color: #3F4A63; text-decoration: none; transition: color .15s, transform .15s; }
.ff-foot-link:hover { color: #3D5AF1; transform: translateX(3px); }
.ff-foot-soc { display: flex; gap: 12px; }
.ff-foot-soc a { width: 50px; height: 50px; border-radius: 15px; display: flex; align-items: center; justify-content: center; color: #3D5AF1; background: rgba(255,255,255,.85); border: 1px solid rgba(61,90,241,.28); box-shadow: 0 0 14px rgba(61,90,241,.16); transition: transform .18s, box-shadow .18s, border-color .18s; }
.ff-foot-soc a:hover { transform: translateY(-2px); border-color: #3D5AF1; box-shadow: 0 0 20px rgba(61,90,241,.38); }
.ff-foot-base { position: relative; padding: 0 16px 32px; display: flex; flex-direction: column; align-items: center; gap: 14px; color: #5B6478; font-size: 14px; text-align: center; }
.ff-foot-pill { display: inline-flex; align-items: center; gap: 10px; padding: 14px 30px; border-radius: 999px; background: rgba(255,255,255,.8); border: 1px solid rgba(61,90,241,.3); box-shadow: 0 8px 22px -14px rgba(61,90,241,.7); font-size: 17px; font-weight: 600; color: #0F1B3D; }
.ff-foot-pill svg { flex: none; color: #3D5AF1; }
.ff-foot-pill b { font-weight: 600; color: #3D5AF1; }
.ff-flowmark { position: relative; flex: none; width: 112px; height: 112px; padding: 3px; border-radius: 32px; overflow: hidden; box-shadow: 0 10px 34px -6px rgba(61,90,241,.55); }
.ff-flowmark-ring { position: absolute; inset: -40%; background: conic-gradient(from 0deg, #3D5AF1, #7DF0FF, #FFFFFF, #8B7BFF, #3D5AF1); animation: ff-flow-spin 3.4s linear infinite; }
.ff-flowmark-inner { position: relative; display: block; border-radius: 29px; overflow: hidden; }
.ff-flowmark-inner::after { content: ""; position: absolute; top: -20%; bottom: -20%; left: -70%; width: 45%; transform: skewX(-20deg); background: linear-gradient(90deg, transparent, rgba(255,255,255,.65), transparent); animation: ff-flow-sweep 3.4s ease-in-out infinite; }
@keyframes ff-flow-spin { to { transform: rotate(360deg); } }
@keyframes ff-flow-sweep { 0%, 35% { left: -70%; } 75%, 100% { left: 130%; } }
@container (max-width: 1240px) {
  .ff-foot-main { grid-template-columns: repeat(4, 1fr); }
  .ff-foot-brand { grid-column: 1 / -1; padding: 0 0 28px; border-right: 0; border-bottom: 1px solid rgba(61,90,241,.18); }
}
@container (max-width: 860px) {
  .ff-foot-main { grid-template-columns: 1fr 1fr; padding: 44px 16px 32px; gap: 32px 20px; }
  .ff-foot-pill { padding: 10px 18px; font-size: 14px; }
  .ff-foot-name { font-size: 42px; }
  .ff-foot-link { font-size: 16px; }
}
@container (max-width: 440px) {
  .ff-foot-brand { flex-direction: column; }
}
@media (prefers-reduced-motion: reduce) { .ff-flowmark-ring, .ff-flowmark-inner::after { animation: none; } }
`;

function Column({ title, links }: { title: string; links: FooterLink[] }) {
  return (
    <nav aria-label={title}>
      <h3>{title}</h3>
      <div className="ff-foot-col">
        {links.map((l) => l.onClick
          ? <button key={l.label} type="button" className="ff-foot-link" onClick={l.onClick}>{l.label}</button>
          : <a key={l.label} className="ff-foot-link" href={l.href} {...(l.href?.startsWith("#") ? {} : { target: "_blank", rel: "noopener noreferrer" })}>{l.label}</a>)}
      </div>
    </nav>
  );
}

export default function SiteFooter({ mark, product }: { mark: ReactNode; product: FooterLink[] }) {
  return (
    <footer className="ff-foot">
      <style>{CSS}</style>
      <span className="ff-foot-glow" aria-hidden="true" />
      <div className="ff-foot-main">
        <div className="ff-foot-brand">
          <div className="ff-flowmark">
            <span className="ff-flowmark-ring" aria-hidden="true" />
            <span className="ff-flowmark-inner">{mark}</span>
          </div>
          <div>
            <p className="ff-foot-name">Flow<span>Fi</span></p>
            <p className="ff-foot-tag">Keep your assets flowing.</p>
            <p className="ff-foot-desc">Bridge, swap and earn on Arc from one app.</p>
          </div>
        </div>
        <Column title="Product" links={product} />
        <Column title="Resources" links={[
          { label: "Documentation", href: `${REPO}#readme` },
          { label: "Explorer", href: "https://arc.etherscan.io" },
          { label: "Arc Docs", href: "https://docs.arc.io" },
        ]} />
        <Column title="Legal" links={[
          { label: "Terms", href: `${REPO}/blob/main/TERMS.md` },
          { label: "Privacy", href: `${REPO}/blob/main/PRIVACY.md` },
          { label: "Risk", href: `${REPO}/blob/main/RISK.md` },
        ]} />
        <div>
          <h3>Contact</h3>
          <div className="ff-foot-soc">
          <a href="https://x.com/flowfifinance" target="_blank" rel="noopener noreferrer" aria-label="X">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.9 2H22l-7.6 8.7L23.3 22h-6.9l-5.4-6.9L4.7 22H1.5l8.2-9.3L1 2h7.1l4.9 6.4L18.9 2zm-1.2 18h1.9L7.4 4H5.4l12.3 16z" /></svg>
          </a>
          <a href={REPO} target="_blank" rel="noopener noreferrer" aria-label="GitHub">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5C5.73.5.75 5.48.75 11.75c0 5.02 3.26 9.28 7.78 10.78.57.1.78-.25.78-.55 0-.27-.01-1.17-.02-2.12-3.16.69-3.83-1.34-3.83-1.34-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.75 1.18 1.75 1.18 1.02 1.75 2.68 1.24 3.33.95.1-.74.4-1.24.72-1.53-2.52-.29-5.17-1.26-5.17-5.6 0-1.24.44-2.25 1.17-3.04-.12-.29-.51-1.45.11-3.02 0 0 .96-.31 3.14 1.16a10.9 10.9 0 0 1 5.72 0c2.18-1.47 3.14-1.16 3.14-1.16.62 1.57.23 2.73.11 3.02.73.79 1.17 1.8 1.17 3.04 0 4.35-2.65 5.31-5.18 5.59.41.35.77 1.05.77 2.12 0 1.53-.01 2.76-.01 3.14 0 .3.2.66.79.55 4.51-1.51 7.77-5.76 7.77-10.78C23.25 5.48 18.27.5 12 .5z" /></svg>
          </a>
          <a href="mailto:contact@flowfi.finance" aria-label="Email">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m4 7 8 6 8-6" /></svg>
          </a>
        </div>
        </div>
      </div>
      <div className="ff-foot-base">
        <div className="ff-foot-pill">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 1c1 6.6 4.4 10 11 11-6.6 1-10 4.4-11 11-1-6.6-4.4-10-11-11 6.6-1 10-4.4 11-11z" /></svg>
          <span>Built on <b>Arc</b>. Integrated with <b>USDC</b>.</span>
        </div>
        <span>© 2026 FlowFi. All rights reserved.</span>
      </div>
    </footer>
  );
}
