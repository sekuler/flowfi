// Live, clickable strip of projects in the Arc ecosystem. Logos are shown in their original colors.
const PROJECTS = [
  { name: "Circle", logo: "circle.png", x: "circle" },
  { name: "Morpho", logo: "morpho.jpg", x: "Morpho" },
  { name: "Aave", logo: "aave.png", x: "aave" },
  { name: "LI.FI", logo: "lifi.png", x: "lifiprotocol" },
  { name: "Aero", logo: "aero.jpg", x: "aeroxyz" },
  { name: "Across", logo: "across.jpg", x: "AcrossProtocol" },
  { name: "Uniswap", logo: "uniswap.jpg", x: "Uniswap" },
  { name: "LayerZero", logo: "layerzero.jpg", x: "LayerZero_Core" },
  { name: "Stargate", logo: "stargate.png", x: "StargateFinance" },
  { name: "Alchemy", logo: "alchemy.jpg", x: "Alchemy" },
  { name: "Keyrock", logo: "keyrock.jpg", x: "keyrock" },
  { name: "Bitwise", logo: "bitwise.png", x: "Bitwise" },
  { name: "Galaxy", logo: "galaxy.jpg", x: "galaxyhq" },
  { name: "Steakhouse", logo: "steakhouse.jpg", x: "SteakhouseFi" },
];

const TOP = PROJECTS.slice(0, 7);
const BOTTOM = PROJECTS.slice(7);

const CSS = `
.ff-eco { position: relative; z-index: 1; padding: 8px 0 28px; }
.ff-eco-orn { display: flex; align-items: center; justify-content: center; gap: 12px; color: #3D5AF1; }
.ff-eco-orn::before, .ff-eco-orn::after { content: ""; width: 120px; height: 1px; background: linear-gradient(90deg, transparent, rgba(61,90,241,.75)); }
.ff-eco-orn::after { transform: scaleX(-1); }
.ff-eco-title { width: fit-content; margin: 10px auto 28px; padding: 0 16px; text-align: center; font-family: 'Source Serif 4', Georgia, 'Times New Roman', serif; font-size: clamp(34px, 5.4vw, 72px); line-height: 1.1; font-weight: 500; letter-spacing: .04em; text-transform: uppercase; color: #3D5AF1; background: linear-gradient(90deg, #7B5CF0, #3D5AF1 55%, #3D8BF1); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
.ff-eco-panel { padding: 14px 0; background: linear-gradient(135deg, #E6EBFF, #F1EDFF); border-block: 1px solid rgba(61,90,241,.13); }
.ff-eco-view { overflow: hidden; padding: 10px 0 12px;
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 5%, #000 95%, transparent); mask-image: linear-gradient(90deg, transparent, #000 5%, #000 95%, transparent); }
.ff-eco-track { display: flex; width: max-content; animation: ff-eco-scroll 70s linear infinite; }
.ff-eco-track--reverse { animation-direction: reverse; }
.ff-eco-track--all { display: none; animation-duration: 90s; }
.ff-eco-view:hover .ff-eco-track, .ff-eco-view:focus-within .ff-eco-track { animation-play-state: paused; }
@keyframes ff-eco-scroll { to { transform: translateX(-50%); } }
.ff-eco-card { position: relative; flex: none; display: flex; flex-direction: column; align-items: center; gap: 12px; width: 150px; margin-right: 14px; padding: 20px 8px 16px; box-sizing: border-box; text-decoration: none;
  background: linear-gradient(180deg, #FFFFFF 0%, #EDF1FF 100%); border: 1px solid rgba(61,90,241,.2); border-radius: 18px; box-shadow: 0 10px 24px -18px rgba(36,58,150,.5); transition: transform .2s, border-color .2s, box-shadow .2s; }
.ff-eco-card:hover, .ff-eco-card:focus-visible { transform: translateY(-4px); border-color: rgba(61,90,241,.5); box-shadow: 0 16px 30px -16px rgba(61,90,241,.55); }
.ff-eco-card img { width: 72px; height: 72px; border-radius: 18px; object-fit: cover; display: block; }
.ff-eco-name { font-size: 13.5px; font-weight: 700; color: #0F1B3D; }
.ff-eco-x { position: absolute; top: 8px; right: 8px; display: flex; color: #8A93A8; transition: color .2s; }
.ff-eco-card:hover .ff-eco-x, .ff-eco-card:focus-visible .ff-eco-x { color: #3D5AF1; }
@media (max-width: 860px) {
  .ff-eco { padding: 4px 0 20px; }
  .ff-eco-orn::before, .ff-eco-orn::after { width: 70px; }
  .ff-eco-track--split { display: none; }
  .ff-eco-track--all { display: flex; }
  .ff-eco-card { width: 124px; margin-right: 10px; padding: 16px 6px 13px; }
  .ff-eco-card img { width: 60px; height: 60px; border-radius: 15px; }
  .ff-eco-name { font-size: 12.5px; }
}
@media (prefers-reduced-motion: reduce) { .ff-eco-track { animation: none; } .ff-eco-view { overflow-x: auto; } }
`;

// Each row repeats its set six times so the loop has no gap on very wide screens.
function Row({ items, className }: { items: typeof PROJECTS; className: string }) {
  return (
    <div className={`ff-eco-track ${className}`}>
      {[0, 1, 2, 3, 4, 5].map((copy) => items.map((p) => (
        <a key={`${copy}-${p.x}`} className="ff-eco-card" href={`https://x.com/${p.x}`} target="_blank" rel="noopener noreferrer"
          aria-label={copy === 0 ? `${p.name} on X` : undefined} aria-hidden={copy > 0 ? true : undefined} tabIndex={copy > 0 ? -1 : undefined}>
          <span className="ff-eco-x"><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.9 2H22l-7.6 8.7L23.3 22h-6.9l-5.4-6.9L4.7 22H1.5l8.2-9.3L1 2h7.1l4.9 6.4L18.9 2zm-1.2 18h1.9L7.4 4H5.4l12.3 16z" /></svg></span>
          <img src={`/logos/ecosystem/${p.logo}`} alt="" />
          <span className="ff-eco-name">{p.name}</span>
        </a>
      )))}
    </div>
  );
}

export default function EcosystemStrip() {
  return (
    <section className="ff-eco" aria-label="Ecosystem on Arc">
      <style>{CSS}</style>
      <div className="ff-eco-orn" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1c1 6.6 4.4 10 11 11-6.6 1-10 4.4-11 11-1-6.6-4.4-10-11-11 6.6-1 10-4.4 11-11z" /></svg></div>
      <h2 className="ff-eco-title">Ecosystem on Arc</h2>
      <div className="ff-eco-panel">
        <div className="ff-eco-view">
          <Row items={TOP} className="ff-eco-track--split" />
        </div>
        <div className="ff-eco-view" style={{ marginTop: -6 }}>
          <Row items={BOTTOM} className="ff-eco-track--split ff-eco-track--reverse" />
          <Row items={PROJECTS} className="ff-eco-track--all" />
        </div>
      </div>
    </section>
  );
}
