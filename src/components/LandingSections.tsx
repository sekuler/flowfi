import { ArrowLeftRight, ChevronDown, Code2, Eye, ArrowUpRight, PenLine, Wallet, Zap, BarChart3 } from "lucide-react";
import { useEffect, useRef, useState, type ComponentType } from "react";

// Landing sections. Motion based on the motion-prompt library: #147 Stacking cards, #052 Accordion.

const CSS = `
.ff-sec { position: relative; z-index: 1; font-family: 'Geist', 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif; box-sizing: border-box; }
.ff-sec-head { text-align: center; margin: 0 auto 40px; max-width: 640px; }
.ff-sec-kicker { display: inline-block; margin-bottom: 14px; font-size: 12.5px; font-weight: 700; letter-spacing: 2.5px; text-transform: uppercase; color: #3D5AF1; }
.ff-sec-head h2 { margin: 0; font-size: clamp(32px, 3.8vw, 52px); font-weight: 800; letter-spacing: -1.2px; line-height: 1.08; color: #0F1B3D; }
.ff-sec-head p { margin: 14px 0 0; font-size: 18px; line-height: 1.5; color: #5B6478; }

/* How it works: stacking cards */
.ff-how { max-width: 1080px; margin: 0 auto; padding: 72px 48px 40px; }
.ff-stack-card { position: sticky; display: grid; grid-template-columns: 1fr 260px; align-items: center; gap: 32px; min-height: 280px; margin-bottom: 40px; padding: 40px 48px; border-radius: 24px; box-sizing: border-box; overflow: hidden;
  background: #fff; border: 1px solid rgba(61,90,241,.14); box-shadow: 0 -2px 14px rgba(15,27,61,.08), 0 24px 40px -30px rgba(36,58,150,.6); transform-origin: 50% 0; will-change: transform; }
.ff-stack-card::after { content: ""; position: absolute; inset: 0; background: #0F1B3D; opacity: var(--dim, 0); pointer-events: none; }
.ff-stack-num { font-size: 14px; font-weight: 800; letter-spacing: 2px; color: #3D5AF1; }
.ff-stack-card h3 { margin: 10px 0 12px; font-size: clamp(28px, 3vw, 40px); font-weight: 800; letter-spacing: -1px; color: #0F1B3D; }
.ff-stack-card p { margin: 0; max-width: 460px; font-size: 18px; line-height: 1.55; color: #5B6478; }
.ff-stack-art { display: flex; align-items: center; justify-content: center; gap: 12px; height: 180px; border-radius: 20px; background: linear-gradient(135deg, #EDF1FF, #F3EEFF); }
.ff-stack-tile { width: 64px; height: 64px; border-radius: 18px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; background: #fff; color: #3D5AF1; font-size: 11px; font-weight: 700; box-shadow: 0 10px 20px -12px rgba(36,58,150,.7); }
.ff-stack-tile.is-main { width: 92px; height: 92px; border-radius: 26px; color: #fff; background: linear-gradient(135deg, #5B78FF, #3D5AF1); box-shadow: 0 18px 30px -14px rgba(61,90,241,.9); }

/* Security: dark section */
.ff-safe-wrap { background: radial-gradient(circle at 15% 0%, rgba(79,107,255,.35), transparent 45%), #0B1230; }
.ff-safe { max-width: 1200px; margin: 0 auto; padding: 88px 48px; }
.ff-safe .ff-sec-head h2 { color: #fff; }
.ff-safe .ff-sec-head p { color: #AEB8D9; }
.ff-safe .ff-sec-kicker { color: #8FA9FF; }
.ff-safe-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
.ff-safe-item { padding: 26px 22px; border-radius: 20px; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); transition: background .25s, border-color .25s, transform .25s; }
.ff-safe-item:hover { background: rgba(255,255,255,.07); border-color: rgba(143,169,255,.4); transform: translateY(-3px); }
.ff-safe-icon { width: 46px; height: 46px; border-radius: 14px; display: flex; align-items: center; justify-content: center; margin-bottom: 18px; color: #fff; background: linear-gradient(135deg, #5B78FF, #3D5AF1); box-shadow: 0 12px 24px -12px rgba(91,120,255,.9); }
.ff-safe-item h3 { margin: 0 0 8px; font-size: 18px; font-weight: 700; color: #fff; }
.ff-safe-item p { margin: 0; font-size: 15px; line-height: 1.5; color: #AEB8D9; }
.ff-safe-item a { display: inline-flex; align-items: center; gap: 6px; margin-top: 12px; font-size: 14px; font-weight: 600; color: #8FA9FF; text-decoration: none; }

/* FAQ: accordion */
.ff-faq-wrap { background: #EEF0FF; }
.ff-faq { max-width: 820px; margin: 0 auto; padding: 88px 24px 72px; }
.ff-faq-item { margin-bottom: 10px; border-radius: 16px; background: #fff; border: 1px solid rgba(61,90,241,.12); transition: border-color .35s cubic-bezier(.65,0,.35,1), box-shadow .35s; }
.ff-faq-item.is-open { border-color: rgba(61,90,241,.45); box-shadow: 0 16px 30px -24px rgba(36,58,150,.7); }
.ff-faq-q { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 20px 24px; border: 0; background: none; cursor: pointer; text-align: left; font: inherit; font-size: 17.5px; font-weight: 700; color: #0F1B3D; transition: color .35s; }
.ff-faq-item.is-open .ff-faq-q { color: #3D5AF1; }
.ff-faq-q svg { flex-shrink: 0; transition: transform .35s cubic-bezier(.65,0,.35,1); }
.ff-faq-item.is-open .ff-faq-q svg { transform: rotate(180deg); }
.ff-faq-a { display: grid; grid-template-rows: 0fr; opacity: 0; transition: grid-template-rows .35s cubic-bezier(.65,0,.35,1), opacity .35s cubic-bezier(.65,0,.35,1); }
.ff-faq-item.is-open .ff-faq-a { grid-template-rows: 1fr; opacity: 1; }
.ff-faq-a > div { overflow: hidden; }
.ff-faq-a p { margin: 0; padding: 0 24px 22px; font-size: 16px; line-height: 1.6; color: #5B6478; }

@media (max-width: 960px) {
  .ff-how { padding: 48px 16px 24px; }
  .ff-stack-card { grid-template-columns: 1fr; padding: 28px 24px; gap: 20px; }
  .ff-stack-art { height: 130px; }
  .ff-safe { padding: 64px 16px; }
  .ff-safe-grid { grid-template-columns: 1fr 1fr; }
  .ff-faq { padding: 64px 16px; }
}
@media (max-width: 560px) { .ff-safe-grid { grid-template-columns: 1fr; } }
@media (prefers-reduced-motion: reduce) { .ff-faq-a, .ff-faq-q svg, .ff-safe-item { transition: none; } }
`;

type Ico = ComponentType<{ size?: number }>;
const STEPS: { title: string; text: string; tiles: { Icon: Ico; label: string; main?: boolean }[] }[] = [
  { title: "Connect", text: "Connect your own wallet, or open a Circle Wallet with just your email.",
    tiles: [{ Icon: Wallet, label: "Wallet", main: true }] },
  { title: "Choose", text: "Bridge USDC to Arc, swap between tokens, or earn with Morpho and Aave. Everything sits in one app.",
    tiles: [{ Icon: Zap, label: "Bridge" }, { Icon: ArrowLeftRight, label: "Swap", main: true }, { Icon: BarChart3, label: "Earn" }] },
  { title: "Sign", text: "Check the details and sign. Nothing moves until you approve it.",
    tiles: [{ Icon: PenLine, label: "Sign", main: true }] },
];

// #147 Stacking cards: each step sticks a little lower than the one before and covers it;
// the cards underneath shrink 4.5% per card on top and darken under a navy layer (up to 16%).
export function HowItWorks() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const cards = Array.from(root.querySelectorAll<HTMLElement>(".ff-stack-card"));
    let raf = 0;
    const update = () => {
      raf = 0;
      const rects = cards.map((c) => c.getBoundingClientRect());
      cards.forEach((c, i) => {
        let s = 0;
        for (let j = i + 1; j < cards.length; j++) s += Math.min(1, Math.max(0, 1 - (rects[j].top - rects[i].top) / rects[i].height));
        c.style.transform = s ? `scale(${(1 - 0.045 * s).toFixed(4)})` : "";
        c.style.setProperty("--dim", (0.08 * s).toFixed(3));
      });
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); cancelAnimationFrame(raf); };
  }, []);

  return (
    <section className="ff-sec ff-how" ref={ref}>
      <style>{CSS}</style>
      <div className="ff-sec-head">
        <span className="ff-sec-kicker">How it works</span>
        <h2>Three steps. That's it.</h2>
      </div>
      {STEPS.map((s, i) => (
        <article key={s.title} className="ff-stack-card" style={{ top: 96 + i * 16 }}>
          <div>
            <span className="ff-stack-num">STEP 0{i + 1}</span>
            <h3>{s.title}</h3>
            <p>{s.text}</p>
          </div>
          <div className="ff-stack-art" aria-hidden="true">
            {s.tiles.map(({ Icon, label, main }) => (
              <div key={label} className={`ff-stack-tile${main ? " is-main" : ""}`}><Icon size={main ? 32 : 22} />{label}</div>
            ))}
          </div>
        </article>
      ))}
    </section>
  );
}

const SAFE: { Icon: Ico; title: string; text: string; link?: { href: string; label: string } }[] = [
  { Icon: PenLine, title: "You sign every transaction", text: "Every transaction is shown to you first. Nothing goes out until you approve it." },
  { Icon: Wallet, title: "Self-custody by default", text: "Connect your own wallet and your assets stay in it. FlowFi never holds them." },
  { Icon: Code2, title: "Open source", text: "FlowFi's code is public, so anyone can read how it works.",
    link: { href: "https://github.com/sekuler/flowfi", label: "View on GitHub" } },
  { Icon: Eye, title: "Reviewed and watched", text: "Open-source security researchers have reviewed FlowFi, and the app warns you if your wallet is delegated to an unknown contract." },
];

export function SecuritySection() {
  return (
    <section className="ff-sec ff-safe-wrap">
      <style>{CSS}</style>
      <div className="ff-safe">
        <div className="ff-sec-head">
          <span className="ff-sec-kicker">Security</span>
          <h2>Built to keep you in control</h2>
          <p>Your wallet, your keys, your decision on every transaction.</p>
        </div>
        <div className="ff-safe-grid">
          {SAFE.map(({ Icon, title, text, link }) => (
            <div key={title} className="ff-safe-item">
              <div className="ff-safe-icon"><Icon size={22} /></div>
              <h3>{title}</h3>
              <p>{text}</p>
              {link && <a href={link.href} target="_blank" rel="noopener noreferrer">{link.label}<ArrowUpRight size={15} /></a>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const FAQS = [
  { q: "What is FlowFi?", a: "FlowFi is an app on Arc where you can bridge, swap, send and earn with USDC, EURC and other tokens, all in one place." },
  { q: "Does FlowFi charge a fee?", a: "No. FlowFi adds no fee of its own on bridge, swap or Earn. You only pay the network gas and any fee set by the route or protocol you choose, and you see it before you sign." },
  { q: "Who holds my assets?", a: "If you connect your own wallet, your assets stay in that wallet and you sign every transaction. If you use a Circle Wallet, it is opened with your email and you can withdraw to your own wallet whenever you like." },
  { q: "Which chains can I bridge from?", a: "Ethereum, Base, Arbitrum, Solana, Sui and many more, through LI.FI and Circle's CCTP." },
  { q: "Can I try it without a wallet?", a: "Yes. You can look around Bridge, Swap and Earn before connecting anything." },
];

// #052 Accordion: one question opens at a time; the row grows, the answer fades in and the chevron turns.
export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="ff-sec ff-faq-wrap"><div className="ff-faq">
      <style>{CSS}</style>
      <div className="ff-sec-head">
        <span className="ff-sec-kicker">FAQ</span>
        <h2>Questions, answered</h2>
      </div>
      {FAQS.map((f, i) => (
        <div key={f.q} className={`ff-faq-item${open === i ? " is-open" : ""}`}>
          <button type="button" className="ff-faq-q" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
            {f.q}<ChevronDown size={20} />
          </button>
          <div className="ff-faq-a"><div><p>{f.a}</p></div></div>
        </div>
      ))}
    </div></section>
  );
}

