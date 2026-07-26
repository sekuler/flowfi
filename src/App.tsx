import Skeleton from "./components/Skeleton";
import StablecoinAnalytics from "./components/StablecoinAnalytics";
import CopilotHome from "./components/CopilotHome";
import TokenLaunch from "./components/TokenLaunch";
import LendingForm from "./components/LendingForm";
import { useState, useEffect, useRef } from "react";
import type { EIP1193Provider } from "viem";
import { createPublicClient, http, erc20Abi, formatUnits } from "viem";
import { arcTestnet } from "./chains";
import WalletConnect from "./components/WalletConnect";
import BridgeForm from "./components/BridgeForm";
import SwapForm from "./components/SwapForm";
import SendForm from "./components/SendForm";
import TxHistory from "./components/TxHistory";
import Dashboard from "./components/Dashboard";
import ReceiveQR from "./components/ReceiveQR";
import UnifiedBalance from "./components/UnifiedBalance";
import CircleWallet from "./components/CircleWallet";
import Perpetuals from "./components/Perpetuals";
import LiquidityPools from "./components/LiquidityPools";
import AiNarrator from "./components/AiNarrator";
import AiCopilot from "./components/AiCopilot";
import ToastContainer from "./components/ToastContainer";
import { showToast } from "./toast";

interface WalletInfo {
  provider: EIP1193Provider;
  address: string;
  walletName: string;
}

interface Balances {
  usdc: string | null;
  eurc: string | null;
  usyc: string | null;
  native: string | null;
}

interface RecentTx {
  hash: string;
  method: string;
  age: string;
}

type Tab = "home" | "portfolio" | "send" | "receive" | "swap" | "perps" | "pools" | "lending" | "launch" | "analytics" | "dashboard" | "history" | "bridge" | "circlewallet";

const ARC_USDC = "0x3600000000000000000000000000000000000000" as `0x${string}`;
const ARC_EURC = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" as `0x${string}`;
const ARC_USYC = "0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C" as `0x${string}`;

const TAB_GROUPS: { group: string; color: string; tabs: { id: Tab; label: string; emoji: string }[] }[] = [
 {
  group: "WALLET",
  color: "#22d3ee",
  tabs: [
    { id: "home",      label: "Home",      emoji: "✦" },
    { id: "portfolio", label: "Portfolio", emoji: "◈" },
    { id: "send",      label: "Send",      emoji: "↗" },
    { id: "receive",   label: "Receive",   emoji: "↙" },
  ],
},
{
  group: "TRADING",
  color: "#22d3ee",
  tabs: [
    { id: "swap",      label: "Swap",      emoji: "⇄" },
    { id: "perps",     label: "Perpetuals", emoji: "▲" },
    { id: "pools",     label: "Liquidity Pools", emoji: "💧" },
    { id: "lending",   label: "Lending",   emoji: "🏦" },
    { id: "launch",    label: "Launch Token", emoji: "🚀" },
  ],
},
  {
    group: "INFRASTRUCTURE",
    color: "#6366f1",
    tabs: [
      { id: "bridge",    label: "Bridge",    emoji: "⬡" },
    ],
  },
 {
  group: "ANALYTICS",
  color: "#6366f1",
  tabs: [
    { id: "dashboard", label: "Dashboard", emoji: "▤" },
    { id: "analytics", label: "Stablecoin Analytics", emoji: "📊" },
    { id: "history",   label: "History",   emoji: "↺" },
  ],
},
  {
    group: "SETTINGS",
    color: "#a5b4fc",
    tabs: [
      { id: "circlewallet", label: "Circle Wallet", emoji: "◎" },
    ],
  },
];

const LANDING_FEATURES = [
  { icon: "✦", title: "AI Copilot", desc: "Type what you want — swap, send, borrow, or open a trade — and Copilot executes it for you." },
  { icon: "⇄", title: "Smart Swap", desc: "On-chain swap with an AI advisor that reads real pool liquidity before you trade." },
  { icon: "⬡", title: "Real CCTP Bridge", desc: "Genuine cross-chain USDC transfer via Circle's official burn/attest/mint protocol." },
  { icon: "▲", title: "Leveraged Trading", desc: "Long or short BTC/ETH with live pricing and real-time PNL tracking." },
  { icon: "🏦", title: "Lending & Borrowing", desc: "Supply USDC to earn interest, or borrow against EURC collateral." },
  { icon: "🚀", title: "Token Launch", desc: "Deploy your own ERC20 token on Arc and pair it with liquidity in seconds." },
];

function timeAgo(sec: number) {
  const diff = Math.floor(Date.now() / 1000) - sec;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

/* ---------- Live network background (canvas) ---------- */
function NetworkBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0, height = 0;
    function resize() {
      width = canvas!.width = window.innerWidth;
      height = canvas!.height = window.innerHeight;
    }
    resize();
    window.addEventListener("resize", resize);

    const N = 30;
    const nodes = Array.from({ length: N }, () => ({
      x: Math.random() * width, y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.2, vy: (Math.random() - 0.5) * 0.2,
    }));
    const edges: { a: number; b: number; pulse: number; speed: number }[] = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        if (Math.random() < 0.045) edges.push({ a: i, b: j, pulse: Math.random(), speed: 0.002 + Math.random() * 0.006 });
      }
    }

    let raf: number;
    function step() {
      ctx!.clearRect(0, 0, width, height);
      ctx!.fillStyle = "#050810";
      ctx!.fillRect(0, 0, width, height);

      for (const n of nodes) {
        n.x += n.vx; n.y += n.vy;
        if (n.x < 0 || n.x > width) n.vx *= -1;
        if (n.y < 0 || n.y > height) n.vy *= -1;
      }

      for (const e of edges) {
        const a = nodes[e.a], b = nodes[e.b];
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 340) continue;
        const alpha = Math.max(0, 1 - dist / 340) * 0.15;
        ctx!.strokeStyle = `rgba(99,140,220,${alpha})`;
        ctx!.beginPath(); ctx!.moveTo(a.x, a.y); ctx!.lineTo(b.x, b.y); ctx!.stroke();

        e.pulse += e.speed;
        if (e.pulse > 1) e.pulse = 0;
        const px = a.x + dx * e.pulse, py = a.y + dy * e.pulse;
        const grad = ctx!.createRadialGradient(px, py, 0, px, py, 4);
        grad.addColorStop(0, "rgba(34,211,238,0.85)");
        grad.addColorStop(1, "rgba(34,211,238,0)");
        ctx!.fillStyle = grad;
        ctx!.beginPath(); ctx!.arc(px, py, 4, 0, Math.PI * 2); ctx!.fill();
      }

      for (const n of nodes) {
        ctx!.fillStyle = "rgba(148,163,184,0.4)";
        ctx!.beginPath(); ctx!.arc(n.x, n.y, 1.4, 0, Math.PI * 2); ctx!.fill();
      }
      raf = requestAnimationFrame(step);
    }
    step();

    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);

  return <canvas ref={canvasRef} style={{ position: "fixed", inset: 0, zIndex: 0 }} />;
}

/* ---------- Google Fonts injection ---------- */
function useFlowFiFonts() {
  useEffect(() => {
    if (document.getElementById("flowfi-fonts")) return;
    const link = document.createElement("link");
    link.id = "flowfi-fonts";
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500;600&display=swap";
    document.head.appendChild(link);
  }, []);
}

export default function App() {
  useFlowFiFonts();

  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const [balances, setBalances] = useState<Balances>({ usdc: null, eurc: null, usyc: null, native: null });
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [recentTxs, setRecentTxs] = useState<RecentTx[]>([]);
  const [eurUsdRate, setEurUsdRate] = useState<number | null>(null);

 function handleConnected(provider: EIP1193Provider, address: string, walletName: string) {
  setWallet({ provider, address, walletName });
  setTab("home");
  showToast("Wallet connected", "success");
}

  async function loadBalances(address: string) {
    try {
      const client = createPublicClient({ chain: arcTestnet, transport: http() });
      const usdc = await client.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: "balanceOf", args: [address as `0x${string}`] }).catch(() => 0n);
      await new Promise(r => setTimeout(r, 300));
      const eurc = await client.readContract({ address: ARC_EURC, abi: erc20Abi, functionName: "balanceOf", args: [address as `0x${string}`] }).catch(() => 0n);
      await new Promise(r => setTimeout(r, 300));
      const usyc = await client.readContract({ address: ARC_USYC, abi: erc20Abi, functionName: "balanceOf", args: [address as `0x${string}`] }).catch(() => 0n);
      await new Promise(r => setTimeout(r, 300));
      const native = await client.getBalance({ address: address as `0x${string}` }).catch(() => 0n);
      setBalances({
        usdc: Number(formatUnits(usdc as bigint, 6)).toFixed(2),
        eurc: Number(formatUnits(eurc as bigint, 6)).toFixed(2),
        usyc: Number(formatUnits(usyc as bigint, 6)).toFixed(2),
        native: Number(formatUnits(native as bigint, 18)).toFixed(4),
      });
      setLastUpdated(Math.floor(Date.now() / 1000));
    } catch {
      setBalances({ usdc: "—", eurc: "—", usyc: "—", native: "—" });
    }
  }

  async function loadRecentTxs(address: string) {
    try {
      const res = await fetch(`https://testnet.arcscan.app/api?module=account&action=txlist&address=${address}&limit=3`);
      const data = await res.json();
      const items: RecentTx[] = (data.result ?? []).slice(0, 3).map((tx: any) => ({
        hash: tx.hash,
        method: tx.methodId === "0x" ? "Contract Deploy" : (tx.methodId && tx.methodId !== "0x" ? "Transaction" : "Transfer"),
        age: tx.timeStamp ? timeAgo(Number(tx.timeStamp)) : "—",
      }));
      setRecentTxs(items);
    } catch {
      setRecentTxs([]);
    }
  }

  async function loadEurRate() {
    try {
      const res = await fetch("https://api.frankfurter.app/latest?from=EUR&to=USD");
      const data = await res.json();
      if (data.rates?.USD) setEurUsdRate(data.rates.USD);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    if (wallet) {
      loadBalances(wallet.address);
      loadRecentTxs(wallet.address);
      loadEurRate();
    }
  }, [wallet]);

  function copyAddress() {
    if (!wallet) return;
    navigator.clipboard.writeText(wallet.address);
    setCopied(true);
    showToast("Address copied", "success");
    setTimeout(() => setCopied(false), 1500);
  }

  const shortAddr = wallet ? wallet.address.slice(0, 6) + "..." + wallet.address.slice(-4) : "";

  const TOKEN_META: Record<string, { icon: string; color: string; bg: string }> = {
    USDC: { icon: "$", color: "#22d3ee", bg: "rgba(34,211,238,0.08)" },
    EURC: { icon: "€", color: "#6366f1", bg: "rgba(99,102,241,0.08)" },
    USYC: { icon: "Y", color: "#f59e0b", bg: "rgba(245,158,11,0.08)" },
  };

  function usdEquivalent(label: string, value: string | null): string | null {
    if (value === null || value === "—") return null;
    const num = Number(value);
    if (isNaN(num)) return null;
    if (label === "USDC") return `$${num.toFixed(2)}`;
    if (label === "USYC") return `~$${num.toFixed(2)}`;
    if (label === "EURC") {
      const rate = eurUsdRate ?? 1.08;
      return `~$${(num * rate).toFixed(2)}`;
    }
    return null;
  }

  const sharedStyle = (
    <style>{`
      * { font-family: 'Inter', system-ui, sans-serif; }
      .flowfi-display { font-family: 'Space Grotesk', 'Inter', sans-serif !important; }
      .flowfi-mono { font-family: 'JetBrains Mono', ui-monospace, monospace !important; }
      button:not(:disabled) { transition: transform 0.12s ease, opacity 0.12s ease, box-shadow 0.12s ease; }
      button:not(:disabled):hover { transform: translateY(-1px); }
      button:not(:disabled):active { transform: translateY(0px) scale(0.98); }
      a { transition: transform 0.12s ease, opacity 0.12s ease; }
      input, select { transition: border-color 0.15s ease, box-shadow 0.15s ease; }
      input:focus, select:focus { box-shadow: 0 0 0 3px rgba(34,211,238,0.15); }
      @keyframes flowfi-fade-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
      .flowfi-page { animation: flowfi-fade-in 0.25s ease-out; }
      @keyframes flowfi-skeleton-pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.8; } }
      .flowfi-skeleton { display: inline-block; background: rgba(255,255,255,0.08); border-radius: 4px; animation: flowfi-skeleton-pulse 1.4s ease-in-out infinite; }
      @keyframes flowfi-drift { 0% { transform: translate(-8%, -4%) rotate(0deg); } 50% { transform: translate(5%, 6%) rotate(180deg); } 100% { transform: translate(-8%, -4%) rotate(360deg); } }
      .flowfi-blob { animation: flowfi-drift 24s ease-in-out infinite; }
      @keyframes flowfi-ticker-scroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
      .flowfi-ticker-track { animation: flowfi-ticker-scroll 20s linear infinite; }
      @keyframes flowfi-icon-pulse { 0%,100% { box-shadow: 0 0 12px rgba(34,211,238,0.4); } 50% { box-shadow: 0 0 22px rgba(34,211,238,0.7); } }
      .flowfi-brand-icon { animation: flowfi-icon-pulse 2.4s ease-in-out infinite; }
      @keyframes flowfi-dot-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
      .flowfi-live-dot { animation: flowfi-dot-pulse 1.6s ease-in-out infinite; }
    `}</style>
  );

 if (!wallet) {
  return (
    <div style={{ minHeight: "100vh", color: "#f8fafc", position: "relative" }}>
      {sharedStyle}
      <NetworkBackground />

      <header style={{ position: "relative", zIndex: 1, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1.5rem 3rem", maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div className="flowfi-brand-icon" style={{ width: 34, height: 34, borderRadius: 10, background: "linear-gradient(135deg, #22d3ee, #6366f1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: "#04121f" }}>◈</div>
          <div>
            <div className="flowfi-display" style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.1 }}>FlowFi</div>
            <div style={{ fontSize: 9, color: "#67e8f9", fontWeight: 700, letterSpacing: "1.5px" }}>AI DEFI OS</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 24 }}>
          {[
            { label: "Faucet", href: "https://faucet.circle.com" },
            { label: "Explorer", href: "https://testnet.arcscan.app" },
            { label: "Docs", href: "https://docs.arc.io" },
          ].map(({ label, href }) => (
            <a key={label} href={href} target="_blank" rel="noopener noreferrer" style={{ color: "#94a3b8", fontSize: 13, textDecoration: "none", fontWeight: 500 }}>{label}</a>
          ))}
        </div>
      </header>

      <div style={{ position: "relative", zIndex: 1, maxWidth: 760, margin: "0 auto", textAlign: "center", padding: "3.5rem 2rem 2.5rem" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 16px", borderRadius: 30, background: "rgba(34,211,238,0.1)", border: "1px solid rgba(34,211,238,0.3)", fontSize: 12, fontWeight: 700, color: "#67e8f9", marginBottom: 24 }}>
          <span className="flowfi-live-dot" style={{ width: 6, height: 6, borderRadius: "50%", background: "#22d3ee" }} />
          LIVE ON ARC TESTNET
        </div>
        <h1 className="flowfi-display" style={{ fontSize: 46, fontWeight: 700, lineHeight: 1.15, letterSpacing: "-1.5px", marginBottom: 20 }}>
          The AI-powered DeFi<br />operating system for Arc.
        </h1>
        <p style={{ fontSize: 17, color: "#94a3b8", lineHeight: 1.6, maxWidth: 560, margin: "0 auto 32px" }}>
          Swap, bridge, lend, launch tokens, trade perpetuals, and manage your stablecoins — all through one intelligent Copilot.
        </p>
     <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, marginBottom: 20 }}>
  <WalletConnect onConnected={handleConnected} />
  <a href="https://x.com/flowfiarc/status/2078926068485173522" target="_blank" rel="noopener noreferrer"
    style={{ display: "flex", alignItems: "center", gap: 6, color: "#a5b4fc", fontSize: 14, fontWeight: 600, textDecoration: "none" }}>
    <span style={{ fontSize: 11 }}>▶</span> Watch Demo
  </a>
</div>
        <p style={{ fontSize: 12, color: "#475569", marginBottom: 28 }}>Real wallet signatures. No seed phrase ever requested. Arc Testnet only.</p>

        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "10px 20px" }}>
          {["Native USDC", "CCTP V2", "AI Copilot", "Lending", "Perpetuals", "Token Launch"].map((f) => (
            <div key={f} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#94a3b8" }}>
              <span style={{ color: "#6ee7b7", fontWeight: 800 }}>✓</span>
              {f}
            </div>
          ))}
        </div>
      </div>

      <div style={{ position: "relative", zIndex: 1, maxWidth: 1000, margin: "0 auto", padding: "2rem 2rem 5rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
          {LANDING_FEATURES.map((f) => (
            <div key={f.title} style={{ background: "rgba(15,23,42,0.6)", backdropFilter: "blur(16px)", border: "1px solid rgba(148,163,184,0.12)", borderRadius: 16, padding: "1.5rem" }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: "rgba(34,211,238,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, marginBottom: 14 }}>{f.icon}</div>
              <h3 className="flowfi-display" style={{ fontSize: 15, fontWeight: 700, marginBottom: 6, color: "#f1f5f9" }}>{f.title}</h3>
              <p style={{ fontSize: 13, color: "#64748b", lineHeight: 1.5 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

  return (
    <div style={{ minHeight: "100vh", display: "flex", color: "#f8fafc", position: "relative" }}>
      {sharedStyle}
      <NetworkBackground />
      <ToastContainer />
      <aside style={{ width: 220, minHeight: "100vh", background: "rgba(8,12,20,0.6)", backdropFilter: "blur(24px)", borderRight: "1px solid rgba(148,163,184,0.1)", display: "flex", flexDirection: "column", padding: "1.5rem 0", position: "fixed", top: 0, left: 0, zIndex: 2 }}>
        <div style={{ padding: "0 1.25rem 1.5rem", borderBottom: "1px solid rgba(148,163,184,0.1)", marginBottom: "1rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div className="flowfi-brand-icon" style={{ width: 32, height: 32, borderRadius: 10, background: "linear-gradient(135deg, #22d3ee, #6366f1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: "#04121f" }}>◈</div>
            <div>
              <div className="flowfi-display" style={{ fontSize: 15, fontWeight: 700, color: "#f8fafc" }}>FlowFi</div>
              <div style={{ fontSize: 9, color: "#67e8f9", fontWeight: 700, letterSpacing: "2px" }}>TESTNET</div>
            </div>
          </div>
        </div>
        <nav style={{ flex: 1, padding: "0 0.75rem", display: "flex", flexDirection: "column", overflowY: "auto" }}>
          {TAB_GROUPS.map(({ group, tabs }) => (
            <div key={group} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 9, color: "#475569", fontWeight: 800, letterSpacing: "1.5px", padding: "0.5rem 1rem 0.3rem" }}>{group}</div>
              {tabs.map(({ id, label, emoji }) => {
                const active = tab === id;
                return (
                  <button key={id} onClick={() => setTab(id)}
                    style={{
                      width: "100%", padding: "0.6rem 1rem", borderRadius: 10, border: "none",
                      background: active ? "linear-gradient(90deg, rgba(34,211,238,0.14), rgba(99,102,241,0.08))" : "transparent",
                      color: active ? "#67e8f9" : "#94a3b8",
                      fontSize: 13, fontWeight: active ? 700 : 500, cursor: "pointer",
                      display: "flex", alignItems: "center", gap: 10, textAlign: "left",
                      boxShadow: active ? "inset 0 0 0 1px rgba(34,211,238,0.25)" : "none",
                      position: "relative", marginBottom: 2,
                    }}>
                    {active && <span style={{ position: "absolute", left: -12, top: "20%", width: 3, height: "60%", borderRadius: 2, background: "linear-gradient(180deg, #22d3ee, #6366f1)" }} />}
                    <span style={{ fontSize: 15 }}>{emoji}</span>
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div style={{ padding: "1rem 1.25rem", borderTop: "1px solid rgba(148,163,184,0.1)", marginTop: "auto" }}>
          <div style={{ fontSize: 10, color: "#475569", marginBottom: 4, fontWeight: 600, letterSpacing: "1px" }}>CONNECTED</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div className="flowfi-mono" style={{ fontSize: 13, color: "#94a3b8" }}>{shortAddr}</div>
            <button onClick={copyAddress} title="Copy address"
              style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: copied ? "#6ee7b7" : "#64748b", fontSize: 12 }}>
              {copied ? "✓" : "⧉"}
            </button>
          </div>
          <div style={{ fontSize: 11, color: "#334155", marginTop: 2 }}>{wallet.walletName}</div>
          <button onClick={() => setWallet(null)} style={{ marginTop: 10, fontSize: 11, color: "#64748b", background: "none", border: "1px solid rgba(148,163,184,0.12)", borderRadius: 6, padding: "4px 10px", cursor: "pointer", width: "100%" }}>Disconnect</button>
        </div>
        <div style={{ padding: "0.75rem 1.25rem", display: "flex", flexDirection: "column", gap: 6 }}>
          {[
            { label: "arc.io", href: "https://www.arc.io", color: "#a5b4fc" },
            { label: "Explorer", href: "https://testnet.arcscan.app", color: "#67e8f9" },
            { label: "Faucet", href: "https://faucet.circle.com", color: "#6ee7b7" },
          ].map(({ label, href, color }) => (
            <a key={label} href={href} target="_blank" rel="noopener noreferrer" style={{ color, fontSize: 12, fontWeight: 600, textDecoration: "none" }}>{label} ↗</a>
          ))}
        </div>
      </aside>

      <main style={{ marginLeft: 220, flex: 1, minHeight: "100vh", position: "relative", zIndex: 1 }}>
        <header style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 14, padding: "1.25rem 2.5rem", borderBottom: "1px solid rgba(148,163,184,0.1)" }}>
          <button disabled title="Coming soon"
            style={{ position: "relative", background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 8, width: 36, height: 36, cursor: "not-allowed", fontSize: 16 }}>
            🔔
            <span style={{ position: "absolute", top: -8, right: -10, fontSize: 8, fontWeight: 800, background: "linear-gradient(135deg, #f59e0b, #f97316)", color: "#fff", padding: "2px 5px", borderRadius: 6, boxShadow: "0 0 8px rgba(245,158,11,0.5)" }}>SOON</span>
          </button>
          <button disabled title="Coming soon"
            style={{ position: "relative", background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 8, width: 36, height: 36, cursor: "not-allowed", fontSize: 16 }}>
            🌙
            <span style={{ position: "absolute", top: -8, right: -10, fontSize: 8, fontWeight: 800, background: "linear-gradient(135deg, #f59e0b, #f97316)", color: "#fff", padding: "2px 5px", borderRadius: 6, boxShadow: "0 0 8px rgba(245,158,11,0.5)" }}>SOON</span>
          </button>
          <div style={{ width: 1, height: 20, background: "rgba(148,163,184,0.12)" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 20, background: "rgba(34,211,238,0.1)", border: "1px solid rgba(34,211,238,0.3)" }}>
            <span className="flowfi-live-dot" style={{ width: 7, height: 7, borderRadius: "50%", background: "#22d3ee" }} />
            <span style={{ fontSize: 12, fontWeight: 800, color: "#67e8f9" }}>Arc Testnet</span>
          </div>
          <a href={`https://testnet.arcscan.app/address/${wallet.address}`} target="_blank" rel="noopener noreferrer"
            className="flowfi-mono"
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 20, background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.3)", color: "#c7d2fe", fontSize: 12, fontWeight: 700, textDecoration: "none" }}>
            {shortAddr}
          </a>
        </header>

        <div style={{ padding: "2.5rem" }}>
          <div key={tab} className="flowfi-page" style={{ position: "relative", zIndex: 1, maxWidth: tab === "perps" || tab === "pools" || tab === "swap" || tab === "bridge" || tab === "dashboard" ? 900 : 520, margin: "0 auto" }}>
            <div style={{ marginBottom: "2rem" }}>
              <h1 className="flowfi-display" style={{ fontSize: 24, fontWeight: 700, color: "#f8fafc", marginBottom: 4, letterSpacing: "-0.5px" }}>
                {tab === "home" ? "Home" : tab === "portfolio" ? "Portfolio" : tab === "dashboard" ? "Dashboard" : tab === "analytics" ? "Stablecoin Analytics" : tab === "send" ? "Send" : tab === "receive" ? "Receive" : tab === "swap" ? "Swap" : tab === "perps" ? "Perpetuals" : tab === "pools" ? "Liquidity Pools" : tab === "lending" ? "Lending" : tab === "launch" ? "Launch Token" : tab === "history" ? "History" : tab === "circlewallet" ? "Circle Wallet" : "Bridge"}
              </h1>
              <p style={{ fontSize: 13, color: "#64748b" }}>
               {tab === "home" ? "Your AI-powered financial overview" : tab === "portfolio" ? "Arc Testnet balances" : tab === "dashboard" ? "Portfolio analytics and activity" : tab === "analytics" ? "Platform-wide stablecoin TVL and distribution" : tab === "send" ? "Send USDC or EURC on Arc" : tab === "receive" ? "Share your address or QR code to receive funds" : tab === "swap" ? "Swap USDC and EURC instantly" : tab === "perps" ? "Leveraged BTC/ETH trading demo" : tab === "pools" ? "Permissionless AMM — create or join any pool" : tab === "lending" ? "Supply to earn, or borrow against collateral" : tab === "launch" ? "Deploy your own ERC20 token on Arc" : tab === "history" ? "Recent transactions on Arc Testnet" : tab === "circlewallet" ? "Create a wallet without a seed phrase" : "Bridge USDC to Arc via CCTP"}
              </p>
            </div>
{tab === "home" && <CopilotHome address={wallet.address} balances={balances} onNavigate={(t) => setTab(t)} />}
{tab === "portfolio" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem" }}>
                  {(["USDC", "EURC", "USYC"] as const).map((label) => {
                    const value = label === "USDC" ? balances.usdc : label === "EURC" ? balances.eurc : balances.usyc;
                    const meta = TOKEN_META[label];
                    const usd = usdEquivalent(label, value);
                    return (
                      <div key={label} style={{ background: "rgba(15,23,42,0.6)", backdropFilter: "blur(16px)", border: `1px solid ${meta.color}30`, borderRadius: 14, padding: "1.25rem" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                          {label === "USDC" || label === "EURC" ? (
  <img src={label === "USDC" ? "https://assets.coingecko.com/coins/images/6319/small/usdc.png" : "https://assets.coingecko.com/coins/images/26045/small/euro.png"} alt={label} style={{ width: 20, height: 20, borderRadius: "50%" }} />
) : (
  <div style={{ width: 20, height: 20, borderRadius: "50%", background: meta.color, color: "#04121f", fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{meta.icon}</div>
)}
                          <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, letterSpacing: "1px" }}>{label}</div>
                        </div>
                        <div className="flowfi-mono" style={{ fontSize: 22, fontWeight: 700, color: meta.color }}>{value === null ? <Skeleton width={70} height={22} /> : value}</div>
                        <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>{usd ?? "Arc Testnet"}</div>
                      </div>
                    );
                  })}
                </div>

                <div style={{ background: "rgba(15,23,42,0.5)", backdropFilter: "blur(14px)", border: "1px solid rgba(148,163,184,0.1)", borderRadius: 14, padding: "1rem 1.25rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 11, color: "#475569", fontWeight: 600, letterSpacing: "1px", marginBottom: 2 }}>ARC</div>
                    <div style={{ fontSize: 13, color: "#64748b" }}>Gas Balance</div>
                  </div>
                  <div className="flowfi-mono" style={{ fontSize: 18, fontWeight: 700, color: "#94a3b8" }}>{balances.native === null ? "..." : `${balances.native} ARC`}</div>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <button onClick={() => loadBalances(wallet.address)} style={{ background: "none", border: "1px solid rgba(148,163,184,0.12)", borderRadius: 10, padding: "0.5rem 1rem", color: "#64748b", fontSize: 12, cursor: "pointer" }}>
                    ↻ Refresh
                  </button>
                  {lastUpdated && (
                    <span style={{ fontSize: 11, color: "#334155" }}>Updated {timeAgo(lastUpdated)}</span>
                  )}
                </div>

                <div>
                  <div style={{ fontSize: 11, color: "#334155", fontWeight: 600, letterSpacing: "1px", marginBottom: 10 }}>QUICK ACTIONS</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => setTab("send")} style={{ flex: 1, padding: "0.75rem", borderRadius: 10, border: "1px solid rgba(34,211,238,0.2)", background: "rgba(34,211,238,0.06)", color: "#22d3ee", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>↗ Send</button>
                    <button onClick={() => setTab("receive")} style={{ flex: 1, padding: "0.75rem", borderRadius: 10, border: "1px solid rgba(99,102,241,0.2)", background: "rgba(99,102,241,0.06)", color: "#818cf8", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>↙ Receive</button>
                    <button onClick={() => setTab("swap")} style={{ flex: 1, padding: "0.75rem", borderRadius: 10, border: "1px solid rgba(139,92,246,0.2)", background: "rgba(139,92,246,0.06)", color: "#a78bfa", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>⇄ Swap</button>
                  </div>
                </div>

                <UnifiedBalance address={wallet.address} />

                <AiNarrator address={wallet.address} balances={balances} />

                {recentTxs.length > 0 && (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <span style={{ fontSize: 11, color: "#334155", fontWeight: 600, letterSpacing: "1px" }}>RECENT ACTIVITY</span>
                      <button onClick={() => setTab("history")} style={{ background: "none", border: "none", color: "#22d3ee", fontSize: 11, cursor: "pointer" }}>View all →</button>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {recentTxs.map((tx) => (
                        <a key={tx.hash} href={`https://testnet.arcscan.app/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer"
                          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.65rem 0.9rem", borderRadius: 10, background: "rgba(2,6,23,0.4)", border: "1px solid rgba(148,163,184,0.08)", textDecoration: "none" }}>
                          <span style={{ fontSize: 12, color: "#94a3b8" }}>{tx.method}</span>
                          <span style={{ fontSize: 11, color: "#475569" }}>{tx.age}</span>
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                <a href={`https://testnet.arcscan.app/address/${wallet.address}`} target="_blank" rel="noopener noreferrer"
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.875rem 1rem", borderRadius: 10, border: "1px solid rgba(99,102,241,0.25)", background: "rgba(99,102,241,0.08)", color: "#a5b4fc", textDecoration: "none", fontSize: 13, fontWeight: 600 }}>
                  <span>View on Explorer ↗</span>
                  <span className="flowfi-mono" style={{ fontSize: 11, color: "#818cf8" }}>{shortAddr}</span>
                </a>
              </div>
            )}

            {tab === "dashboard" && <Dashboard address={wallet.address} balances={balances} onNavigate={(t) => setTab(t)} />}
            {tab === "analytics" && <StablecoinAnalytics />}
            {tab === "history" && <TxHistory address={wallet.address} />}
            {tab === "receive" && <ReceiveQR address={wallet.address} />}
            {tab === "bridge" && <BridgeForm provider={wallet.provider} address={wallet.address} walletName={wallet.walletName} />}
            {tab === "swap" && <SwapForm provider={wallet.provider} address={wallet.address} balances={balances} onRefresh={() => loadBalances(wallet.address)} />}
            {tab === "send" && <SendForm provider={wallet.provider} address={wallet.address} balances={balances} onRefresh={() => loadBalances(wallet.address)} />}
            {tab === "circlewallet" && <CircleWallet />}
            {tab === "perps" && <Perpetuals provider={wallet.provider} address={wallet.address} />}
            {tab === "pools" && <LiquidityPools provider={wallet.provider} address={wallet.address} balances={balances} onRefresh={() => loadBalances(wallet.address)} />}
          {tab === "lending" && <LendingForm provider={wallet.provider} address={wallet.address} balances={balances} onRefresh={() => loadBalances(wallet.address)} />}
          {tab === "launch" && <TokenLaunch provider={wallet.provider} address={wallet.address} onNavigateToPools={() => setTab("pools")} />}
          </div>
        </div>
      </main>

      <AiCopilot provider={wallet.provider} address={wallet.address} balances={balances} onRefresh={() => loadBalances(wallet.address)} onNavigate={(t) => setTab(t)} />
    </div>
  );
}
