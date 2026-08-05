import Skeleton from "./components/Skeleton";
import StablecoinAnalytics from "./components/StablecoinAnalytics";
import CopilotHome from "./components/CopilotHome";
import TokenLaunch from "./components/TokenLaunch";
import LendingForm from "./components/LendingForm";
import { useState, useEffect, Component, type ReactNode } from "react";
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
import NotificationCenter from "./components/NotificationCenter";
import { getPoints, getNickname, setNickname as saveNickname, clearNickname } from "./gamification";
import { getDCAPlan, isDCADue } from "./dca";
import { showToast } from "./toast";
import {
  Home, LayoutGrid, ArrowUpRight, ArrowDownLeft, Repeat, TrendingUp, Droplet,
  Landmark, Rocket, Hexagon, CircleDollarSign, LayoutDashboard, BarChart3, History as HistoryIcon,
  Sparkles, Moon, Power, Copy, Check, RefreshCw,
} from "lucide-react";

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

const TAB_GROUPS: { group: string; tabs: { id: Tab; label: string; Icon: any }[] }[] = [
 {
  group: "WALLET",
  tabs: [
    { id: "home",      label: "Home",      Icon: Home },
    { id: "portfolio", label: "Portfolio", Icon: LayoutGrid },
    { id: "send",      label: "Send",      Icon: ArrowUpRight },
    { id: "receive",   label: "Receive",   Icon: ArrowDownLeft },
  ],
},
{
  group: "TRADING",
  tabs: [
    { id: "swap",      label: "Swap",      Icon: Repeat },
    { id: "bridge",    label: "Bridge",    Icon: Hexagon },
    { id: "perps",     label: "Perpetuals", Icon: TrendingUp },
    { id: "pools",     label: "Liquidity Pools", Icon: Droplet },
    { id: "lending",   label: "Lending",   Icon: Landmark },
    { id: "launch",    label: "Launch Token", Icon: Rocket },
  ],
},
  {
    group: "INFRASTRUCTURE",
    tabs: [
      { id: "circlewallet", label: "Circle Wallet", Icon: CircleDollarSign },
    ],
  },
 {
  group: "ANALYTICS",
  tabs: [
    { id: "dashboard", label: "Dashboard", Icon: LayoutDashboard },
    { id: "analytics", label: "Stablecoin Analytics", Icon: BarChart3 },
    { id: "history",   label: "History",   Icon: HistoryIcon },
  ],
},
];

const LANDING_FEATURE_ICONS = [Sparkles, Repeat, Hexagon, TrendingUp, Landmark, Rocket];

const LANDING_FEATURES = [
  { title: "AI Copilot", desc: "Type what you want — swap, send, borrow, or open a trade — and Copilot executes it for you." },
  { title: "Smart Swap", desc: "On-chain swap with an AI advisor that reads real pool liquidity before you trade." },
  { title: "Real CCTP Bridge", desc: "Genuine cross-chain USDC transfer via Circle's official burn/attest/mint protocol." },
  { title: "Leveraged Trading", desc: "Long or short BTC/ETH with live pricing and real-time PNL tracking." },
  { title: "Lending & Borrowing", desc: "Supply USDC to earn interest, or borrow against EURC collateral." },
  { title: "Token Launch", desc: "Deploy your own ERC20 token on Arc and pair it with liquidity in seconds." },
];

function timeAgo(sec: number) {
  const diff = Math.floor(Date.now() / 1000) - sec;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

/* ---------- Soft pastel blob background ---------- */
function PastelBackground() {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 0, overflow: "hidden", background: "#F8F8FC" }}>
      <div className="flowfi-blob-a" style={{ position: "absolute", top: "-10%", left: "-8%", width: 480, height: 480, borderRadius: "50%", background: "radial-gradient(circle, rgba(139,124,249,0.28) 0%, transparent 70%)", filter: "blur(50px)" }} />
      <div className="flowfi-blob-b" style={{ position: "absolute", top: "20%", right: "-10%", width: 420, height: 420, borderRadius: "50%", background: "radial-gradient(circle, rgba(109,94,247,0.24) 0%, transparent 70%)", filter: "blur(50px)" }} />
      <div className="flowfi-blob-a" style={{ position: "absolute", bottom: "-15%", left: "30%", width: 500, height: 500, borderRadius: "50%", background: "radial-gradient(circle, rgba(59,130,246,0.2) 0%, transparent 70%)", filter: "blur(50px)", animationDelay: "-8s" }} />
    </div>
  );
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

/* ---------- Error boundary: prevents a full blank white screen on a render crash ---------- */
class AppErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; message: string }> {
  state = { hasError: false, message: "" };
  static getDerivedStateFromError(err: unknown) {
    return { hasError: true, message: err instanceof Error ? err.message : "Something went wrong." };
  }
  componentDidCatch(err: unknown) {
    console.error("FlowFi render error:", err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, background: "#F8F8FC", padding: "2rem", textAlign: "center" }}>
          <div style={{ fontSize: 40 }}>⚠️</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#111827" }}>Something went wrong</div>
          <div style={{ fontSize: 13, color: "#6B7280", maxWidth: 400 }}>{this.state.message}</div>
          <button onClick={() => window.location.reload()}
            style={{ padding: "0.75rem 1.5rem", borderRadius: 12, border: "none", background: "#6D5EF7", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppInner() {
  useFlowFiFonts();

  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const [balances, setBalances] = useState<Balances>({ usdc: null, eurc: null, usyc: null, native: null });
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [recentTxs, setRecentTxs] = useState<RecentTx[]>([]);
  const [eurUsdRate, setEurUsdRate] = useState<number | null>(null);
  const [nickname, setNicknameState] = useState<string | null>(null);
  const [points, setPoints] = useState(0);

  useEffect(() => {
    setNicknameState(getNickname());
    setPoints(getPoints());
    const interval = setInterval(() => setPoints(getPoints()), 3000);

    const plan = getDCAPlan();
    if (plan && isDCADue(plan)) {
      showToast(`Your DCA plan is due: buy ${plan.amount} USDC → EURC. Open Swap to run it.`, "info");
    }

    return () => clearInterval(interval);
  }, []);

 function handleConnected(provider: EIP1193Provider, address: string, walletName: string) {
  setWallet({ provider, address, walletName });
  setTab("home");
  showToast("Wallet connected", "success");
}

  async function loadBalances(address: string) {
    try {
      const client = createPublicClient({ chain: arcTestnet, transport: http() });
      const [usdc, eurc, usyc, native] = await Promise.all([
        client.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: "balanceOf", args: [address as `0x${string}`] }).catch(() => 0n),
        client.readContract({ address: ARC_EURC, abi: erc20Abi, functionName: "balanceOf", args: [address as `0x${string}`] }).catch(() => 0n),
        client.readContract({ address: ARC_USYC, abi: erc20Abi, functionName: "balanceOf", args: [address as `0x${string}`] }).catch(() => 0n),
        client.getBalance({ address: address as `0x${string}` }).catch(() => 0n),
      ]);
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
    USDC: { icon: "$", color: "#6D5EF7", bg: "rgba(109,94,247,0.08)" },
    EURC: { icon: "€", color: "#6D5EF7", bg: "rgba(168,85,247,0.08)" },
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
      :root {
        --text-primary: #111827;
        --text-secondary: #374151;
        --text-body: #4B5563;
        --text-muted: #6B7280;
        --text-placeholder: #9CA3AF;
        --primary: #6D5EF7;
      }
      * { font-family: 'Inter', system-ui, sans-serif; }
      .flowfi-display { font-family: 'Space Grotesk', 'Inter', sans-serif !important; }
      .flowfi-mono { font-family: 'JetBrains Mono', ui-monospace, monospace !important; }
      button:not(:disabled) { transition: transform 0.12s ease, opacity 0.12s ease, box-shadow 0.12s ease; }
      button:not(:disabled):hover { transform: translateY(-1px); }
      button:not(:disabled):active { transform: translateY(0px) scale(0.98); }
      a { transition: transform 0.12s ease, opacity 0.12s ease; }
      input, select { transition: border-color 0.15s ease, box-shadow 0.15s ease; }
      input:focus, select:focus { box-shadow: 0 0 0 3px rgba(139,92,246,0.15); }
      input[type="text"], input[type="number"], input[type="email"], input[type="search"], select, textarea {
        border: 1.5px solid #D4C9FA !important;
      }
      input[type="text"]:focus, input[type="number"]:focus, input[type="email"]:focus, select:focus, textarea:focus {
        border-color: #6D5EF7 !important;
      }
      input::placeholder { color: #9CA3AF; }
      @keyframes flowfi-fade-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
      .flowfi-page { animation: flowfi-fade-in 0.25s ease-out; }
      @keyframes flowfi-skeleton-pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.8; } }
      .flowfi-skeleton { display: inline-block; background: rgba(139,92,246,0.1); border-radius: 4px; animation: flowfi-skeleton-pulse 1.4s ease-in-out infinite; }
      @keyframes flowfi-drift-a { 0% { transform: translate(0%, 0%) scale(1); } 50% { transform: translate(6%, 8%) scale(1.1); } 100% { transform: translate(0%, 0%) scale(1); } }
      @keyframes flowfi-drift-b { 0% { transform: translate(0%, 0%) scale(1); } 50% { transform: translate(-7%, 5%) scale(0.95); } 100% { transform: translate(0%, 0%) scale(1); } }
      .flowfi-blob-a { animation: flowfi-drift-a 20s ease-in-out infinite; }
      .flowfi-blob-b { animation: flowfi-drift-b 24s ease-in-out infinite; }
      @keyframes flowfi-ticker-scroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
      .flowfi-ticker-track { animation: flowfi-ticker-scroll 20s linear infinite; }
      @keyframes flowfi-dot-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
      .flowfi-live-dot { animation: flowfi-dot-pulse 1.6s ease-in-out infinite; }
      .flowfi-glow-card { transition: box-shadow 0.2s ease, transform 0.2s ease; }
      .flowfi-glow-card:hover { box-shadow: 0 8px 30px rgba(139,92,246,0.15); transform: translateY(-2px); }
    `}</style>
  );

 if (!wallet) {
  return (
    <div style={{ minHeight: "100vh", color: "#111827", position: "relative" }}>
      {sharedStyle}
      <PastelBackground />

      <header style={{ position: "relative", zIndex: 1, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1.5rem 3rem", maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 12, background: "linear-gradient(135deg, #8B7CF9, #6D5EF7)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: "#fff", boxShadow: "0 4px 14px rgba(109,94,247,0.35)" }}>◈</div>
          <div>
            <div className="flowfi-display" style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.1, color: "#111827" }}>FlowFi</div>
            <div style={{ fontSize: 9, color: "#6D5EF7", fontWeight: 700, letterSpacing: "1.5px" }}>AI DEFI OS</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 24 }}>
          {[
            { label: "Faucet", href: "https://faucet.circle.com" },
            { label: "Explorer", href: "https://testnet.arcscan.app" },
            { label: "Docs", href: "https://docs.arc.io" },
          ].map(({ label, href }) => (
            <a key={label} href={href} target="_blank" rel="noopener noreferrer" style={{ color: "#4B5563", fontSize: 13, textDecoration: "none", fontWeight: 500 }}>{label}</a>
          ))}
        </div>
      </header>

      <div style={{ position: "relative", zIndex: 1, maxWidth: 760, margin: "0 auto", textAlign: "center", padding: "3.5rem 2rem 2.5rem" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 16px", borderRadius: 30, background: "rgba(109,94,247,0.1)", fontSize: 12, fontWeight: 700, color: "#6D5EF7", marginBottom: 24 }}>
          <span className="flowfi-live-dot" style={{ width: 6, height: 6, borderRadius: "50%", background: "#6D5EF7" }} />
          LIVE ON ARC TESTNET
        </div>
        <h1 className="flowfi-display" style={{ fontSize: 46, fontWeight: 700, lineHeight: 1.15, letterSpacing: "-1.5px", marginBottom: 20, color: "#111827" }}>
          The AI-powered DeFi<br />operating system for Arc.
        </h1>
        <p style={{ fontSize: 17, color: "#4B5563", lineHeight: 1.6, maxWidth: 560, margin: "0 auto 32px" }}>
          Swap, bridge, lend, launch tokens, trade perpetuals, and manage your stablecoins — all through one intelligent Copilot.
        </p>
     <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, marginBottom: 20 }}>
  <WalletConnect onConnected={handleConnected} />
  <a href="https://x.com/flowfiarc/status/2078926068485173522" target="_blank" rel="noopener noreferrer"
    style={{ display: "flex", alignItems: "center", gap: 6, color: "#6D5EF7", fontSize: 14, fontWeight: 600, textDecoration: "none" }}>
    <span style={{ fontSize: 11 }}>▶</span> Watch Demo
  </a>
</div>
        <p style={{ fontSize: 12, color: "#6B7280", marginBottom: 28 }}>Real wallet signatures. No seed phrase ever requested. Arc Testnet only.</p>

        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "10px 20px" }}>
          {["Native USDC", "CCTP V2", "AI Copilot", "Lending", "Perpetuals", "Token Launch"].map((f) => (
            <div key={f} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#4B5563" }}>
              <span style={{ color: "#22C55E", fontWeight: 800 }}>✓</span>
              {f}
            </div>
          ))}
        </div>
      </div>

      <div style={{ position: "relative", zIndex: 1, maxWidth: 1000, margin: "0 auto", padding: "2rem 2rem 5rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
          {LANDING_FEATURES.map((f, i) => {
            const Icon = LANDING_FEATURE_ICONS[i];
            return (
              <div key={f.title} className="flowfi-glow-card" style={{ background: "#ffffff", borderRadius: 18, padding: "1.5rem", boxShadow: "0 1px 3px rgba(109,94,247,0.08)" , border: "1px solid #D4C9FA" }}>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: "rgba(109,94,247,0.1)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
                  <Icon size={18} color="#6D5EF7" strokeWidth={2} />
                </div>
                <h3 className="flowfi-display" style={{ fontSize: 15, fontWeight: 700, marginBottom: 6, color: "#111827" }}>{f.title}</h3>
                <p style={{ fontSize: 13, color: "#4B5563", lineHeight: 1.5 }}>{f.desc}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

  return (
    <div style={{ minHeight: "100vh", display: "flex", color: "#111827", position: "relative" }}>
      {sharedStyle}
      <PastelBackground />
      <ToastContainer />
      <aside style={{ width: 220, minHeight: "100vh", background: "rgba(255,255,255,0.75)", backdropFilter: "blur(24px)", boxShadow: "1px 0 0 rgba(109,94,247,0.08)", display: "flex", flexDirection: "column", padding: "1.5rem 0", position: "fixed", top: 0, left: 0, zIndex: 2 }}>
        <div style={{ padding: "0 1.25rem 1rem", marginBottom: "0.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 11, background: "linear-gradient(135deg, #8B7CF9, #6D5EF7)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: "#fff", boxShadow: "0 4px 14px rgba(109,94,247,0.35)" }}>◈</div>
            <div>
              <div className="flowfi-display" style={{ fontSize: 15, fontWeight: 700, color: "#111827" }}>FlowFi</div>
              <div style={{ fontSize: 9, color: "#6D5EF7", fontWeight: 700, letterSpacing: "2px" }}>TESTNET</div>
            </div>
          </div>
        </div>
        <nav style={{ flex: 1, padding: "0 0.75rem", display: "flex", flexDirection: "column", overflowY: "auto" }}>
          {TAB_GROUPS.map(({ group, tabs }) => (
            <div key={group} style={{ marginBottom: 4 }}>
              <div style={{ fontSize: 9, color: "#8B7CF9", fontWeight: 800, letterSpacing: "1.5px", padding: "0.35rem 1rem 0.2rem" }}>{group}</div>
              {tabs.map(({ id, label, Icon }) => {
                const active = tab === id;
                return (
                  <button key={id} onClick={() => setTab(id)}
                    style={{
                      width: "100%", padding: "0.45rem 1rem", borderRadius: 999, border: "none",
                      background: active ? "linear-gradient(90deg, #ede9fe, #f5f3ff)" : "transparent",
                      color: active ? "#6D5EF7" : "#4B5563",
                      fontSize: 12.5, fontWeight: active ? 700 : 500, cursor: "pointer",
                      display: "flex", alignItems: "center", gap: 9, textAlign: "left",
                      marginBottom: 1,
                    }}>
                    <Icon size={15} strokeWidth={2} />
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div style={{ padding: "0.65rem 1.25rem", marginTop: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ fontSize: 10, color: "#8B7CF9", fontWeight: 700, letterSpacing: "1px" }}>CONNECTED</span>
            <button onClick={() => {
              const next = window.prompt("Set a local nickname (only visible to you, this browser only):", nickname ?? "");
              if (next === null) return;
              if (next.trim()) { setNicknameState(next.trim()); saveNickname(next.trim()); }
              else { setNicknameState(null); clearNickname(); }
            }} title="Set a local nickname" style={{ background: "none", border: "none", color: "#8B7CF9", cursor: "pointer", fontSize: 10, fontWeight: 700 }}>
              {nickname ? "Edit" : "+ Nickname"}
            </button>
          </div>
          {nickname && <div style={{ fontSize: 13, fontWeight: 700, color: "#111827", marginBottom: 2 }}>{nickname}</div>}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div className="flowfi-mono" style={{ fontSize: 13, color: "#374151" }}>{shortAddr}</div>
            <button onClick={copyAddress} title="Copy address"
              style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: copied ? "#22C55E" : "#6B7280", display: "flex" }}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </button>
          </div>
          <div style={{ fontSize: 11, color: "#6B7280", marginTop: 2 }}>{wallet.walletName}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 8, background: "rgba(109,94,247,0.08)", borderRadius: 999, padding: "4px 10px", width: "fit-content" }}>
            <Sparkles size={11} color="#6D5EF7" />
            <span className="flowfi-mono" style={{ fontSize: 11, fontWeight: 700, color: "#6D5EF7" }}>{points} pts</span>
          </div>
          <button onClick={() => setWallet(null)} style={{ marginTop: 10, fontSize: 11, color: "#6D5EF7", background: "rgba(109,94,247,0.08)", border: "none", borderRadius: 999, padding: "5px 12px", cursor: "pointer", width: "100%" }}>Disconnect</button>
        </div>
        <div style={{ padding: "0.5rem 1.25rem", display: "flex", flexDirection: "column", gap: 4 }}>
          {[
            { label: "arc.io", href: "https://www.arc.io" },
            { label: "Explorer", href: "https://testnet.arcscan.app" },
            { label: "Faucet", href: "https://faucet.circle.com" },
          ].map(({ label, href }) => (
            <a key={label} href={href} target="_blank" rel="noopener noreferrer" style={{ color: "#6D5EF7", fontSize: 12, fontWeight: 600, textDecoration: "none" }}>{label} ↗</a>
          ))}
        </div>
      </aside>

      <main style={{ marginLeft: 220, flex: 1, minHeight: "100vh", position: "relative", zIndex: 1 }}>
        <header style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 14, padding: "1.25rem 2.5rem" }}>
          <NotificationCenter />
          <button disabled title="Coming soon"
            style={{ position: "relative", background: "rgba(109,94,247,0.08)", border: "none", borderRadius: 10, width: 36, height: 36, cursor: "not-allowed", display: "flex", alignItems: "center", justifyContent: "center", color: "#6D5EF7" }}>
            <Moon size={16} />
            <span style={{ position: "absolute", top: -8, right: -10, fontSize: 8, fontWeight: 800, background: "linear-gradient(135deg, #f59e0b, #f97316)", color: "#fff", padding: "2px 5px", borderRadius: 6, boxShadow: "0 0 8px rgba(245,158,11,0.5)" }}>SOON</span>
          </button>
          <div style={{ width: 1, height: 20, background: "rgba(109,94,247,0.12)" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 999, background: "rgba(34,197,94,0.1)" }}>
            <span className="flowfi-live-dot" style={{ width: 7, height: 7, borderRadius: "50%", background: "#22C55E" }} />
            <span style={{ fontSize: 12, fontWeight: 800, color: "#16A34A" }}>Arc Testnet</span>
          </div>
          <a href={`https://testnet.arcscan.app/address/${wallet.address}`} target="_blank" rel="noopener noreferrer"
            className="flowfi-mono"
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 999, background: "rgba(109,94,247,0.1)", color: "#6D5EF7", fontSize: 12, fontWeight: 700, textDecoration: "none" }}>
            {shortAddr}
          </a>
          <button onClick={() => setWallet(null)} title="Disconnect wallet"
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: 10, border: "none", background: "rgba(239,68,68,0.1)", color: "#EF4444", cursor: "pointer" }}>
            <Power size={15} />
          </button>
        </header>

        <div style={{ padding: "2.5rem" }}>
          <div key={tab} className="flowfi-page" style={{ position: "relative", zIndex: 1, maxWidth: tab === "home" || tab === "bridge" ? 1200 : tab === "perps" || tab === "pools" || tab === "swap" || tab === "dashboard" ? 900 : 520, margin: "0 auto" }}>
            <div style={{ marginBottom: "2rem" }}>
              <h1 className="flowfi-display" style={{ fontSize: 24, fontWeight: 700, color: "#111827", marginBottom: 4, letterSpacing: "-0.5px" }}>
                {tab === "home" ? "Home" : tab === "portfolio" ? "Portfolio" : tab === "dashboard" ? "Dashboard" : tab === "analytics" ? "Stablecoin Analytics" : tab === "send" ? "Send" : tab === "receive" ? "Receive" : tab === "swap" ? "Swap" : tab === "perps" ? "Perpetuals" : tab === "pools" ? "Liquidity Pools" : tab === "lending" ? "Lending" : tab === "launch" ? "Launch Token" : tab === "history" ? "History" : tab === "circlewallet" ? "Circle Wallet" : "Bridge"}
              </h1>
              <p style={{ fontSize: 13, color: "#6B7280" }}>
               {tab === "home" ? "Your AI-powered financial overview" : tab === "portfolio" ? "Arc Testnet balances" : tab === "dashboard" ? "Portfolio analytics and activity" : tab === "analytics" ? "Platform-wide stablecoin TVL and distribution" : tab === "send" ? "Send USDC or EURC on Arc" : tab === "receive" ? "Share your address or QR code to receive funds" : tab === "swap" ? "Swap USDC and EURC instantly" : tab === "perps" ? "Leveraged BTC/ETH trading demo" : tab === "pools" ? "Permissionless AMM — create or join any pool" : tab === "lending" ? "Supply to earn, or borrow against collateral" : tab === "launch" ? "Deploy your own ERC20 token on Arc" : tab === "history" ? "Recent transactions on Arc Testnet" : tab === "circlewallet" ? "Create a wallet without a seed phrase" : "Bridge USDC to Arc via CCTP"}
              </p>
              {tab === "portfolio" && balances.usdc !== null && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 11, color: "#6B7280", fontWeight: 600, letterSpacing: "1px", marginBottom: 2 }}>TOTAL VALUE</div>
                  <div className="flowfi-mono" style={{ fontSize: 34, fontWeight: 700, color: "#111827" }}>
                    ${(Number(balances.usdc || 0) + Number(balances.eurc || 0) * (eurUsdRate ?? 1.08) + Number(balances.usyc || 0)).toFixed(2)}
                  </div>
                </div>
              )}
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
                      <div key={label} className="flowfi-glow-card" style={{ background: "#ffffff", borderRadius: 16, padding: "1.25rem", boxShadow: "0 1px 3px rgba(109,94,247,0.08)" , border: "1px solid #D4C9FA" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                          {label === "USDC" || label === "EURC" ? (
  <img src={label === "USDC" ? "https://assets.coingecko.com/coins/images/6319/small/usdc.png" : "https://assets.coingecko.com/coins/images/26045/small/euro.png"} alt={label} style={{ width: 20, height: 20, borderRadius: "50%" }} />
) : (
  <div style={{ width: 20, height: 20, borderRadius: "50%", background: meta.color, color: "#fff", fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{meta.icon}</div>
)}
                          <div style={{ fontSize: 11, color: "#6B7280", fontWeight: 600, letterSpacing: "1px" }}>{label}</div>
                        </div>
                        <div className="flowfi-mono" style={{ fontSize: 22, fontWeight: 700, color: meta.color }}>{value === null ? <Skeleton width={70} height={22} /> : value}</div>
                        <div style={{ fontSize: 11, color: "#6B7280", marginTop: 4 }}>{usd ?? "Arc Testnet"}</div>
                      </div>
                    );
                  })}
                </div>

                <div style={{ background: "#ffffff", borderRadius: 16, padding: "1rem 1.25rem", display: "flex", justifyContent: "space-between", alignItems: "center", boxShadow: "0 1px 3px rgba(109,94,247,0.08)" , border: "1px solid #D4C9FA" }}>
                  <div>
                    <div style={{ fontSize: 11, color: "#6B7280", fontWeight: 600, letterSpacing: "1px", marginBottom: 2 }}>ARC</div>
                    <div style={{ fontSize: 13, color: "#4B5563" }}>Gas Balance</div>
                  </div>
                  <div className="flowfi-mono" style={{ fontSize: 18, fontWeight: 700, color: "#374151" }}>{balances.native === null ? "..." : `${balances.native} ARC`}</div>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <button onClick={() => loadBalances(wallet.address)} style={{ background: "#ffffff", border: "none", borderRadius: 999, padding: "0.5rem 1rem", color: "#6D5EF7", fontSize: 12, cursor: "pointer", boxShadow: "0 1px 3px rgba(109,94,247,0.08)" }}>
                    <RefreshCw size={12} style={{ marginRight: 5, verticalAlign: -1 }} />Refresh
                  </button>
                  {lastUpdated && (
                    <span style={{ fontSize: 11, color: "#6B7280" }}>Updated {timeAgo(lastUpdated)}</span>
                  )}
                </div>

                <div>
                  <div style={{ fontSize: 11, color: "#6B7280", fontWeight: 600, letterSpacing: "1px", marginBottom: 10 }}>QUICK ACTIONS</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => setTab("send")} className="flowfi-glow-card" style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "0.75rem", borderRadius: 12, border: "none", background: "#ffffff", color: "#6D5EF7", fontSize: 12, fontWeight: 600, cursor: "pointer", boxShadow: "0 1px 3px rgba(109,94,247,0.08)" }}><ArrowUpRight size={16} />Send</button>
                    <button onClick={() => setTab("receive")} className="flowfi-glow-card" style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "0.75rem", borderRadius: 12, border: "none", background: "#ffffff", color: "#6D5EF7", fontSize: 12, fontWeight: 600, cursor: "pointer", boxShadow: "0 1px 3px rgba(109,94,247,0.08)" }}><ArrowDownLeft size={16} />Receive</button>
                    <button onClick={() => setTab("swap")} className="flowfi-glow-card" style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "0.75rem", borderRadius: 12, border: "none", background: "#ffffff", color: "#6D5EF7", fontSize: 12, fontWeight: 600, cursor: "pointer", boxShadow: "0 1px 3px rgba(109,94,247,0.08)" }}><Repeat size={16} />Swap</button>
                    <button onClick={() => setTab("bridge")} className="flowfi-glow-card" style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "0.75rem", borderRadius: 12, border: "none", background: "#ffffff", color: "#6D5EF7", fontSize: 12, fontWeight: 600, cursor: "pointer", boxShadow: "0 1px 3px rgba(109,94,247,0.08)" }}><Hexagon size={16} />Bridge</button>
                  </div>
                </div>

                <UnifiedBalance address={wallet.address} />

                <AiNarrator address={wallet.address} balances={balances} />

                {recentTxs.length > 0 && (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <span style={{ fontSize: 11, color: "#6B7280", fontWeight: 600, letterSpacing: "1px" }}>RECENT ACTIVITY</span>
                      <button onClick={() => setTab("history")} style={{ background: "none", border: "none", color: "#6D5EF7", fontSize: 11, cursor: "pointer" }}>View all →</button>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {recentTxs.map((tx) => (
                        <a key={tx.hash} href={`https://testnet.arcscan.app/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer"
                          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.65rem 0.9rem", borderRadius: 12, background: "#ffffff", textDecoration: "none", boxShadow: "0 1px 3px rgba(124,58,237,0.06)" , border: "1px solid #D4C9FA" }}>
                          <span style={{ fontSize: 12, color: "#374151" }}>{tx.method}</span>
                          <span style={{ fontSize: 11, color: "#6B7280" }}>{tx.age}</span>
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                <a href={`https://testnet.arcscan.app/address/${wallet.address}`} target="_blank" rel="noopener noreferrer"
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.875rem 1rem", borderRadius: 12, border: "none", background: "rgba(109,94,247,0.08)", color: "#6D5EF7", textDecoration: "none", fontSize: 13, fontWeight: 600 }}>
                  <span>View on Explorer ↗</span>
                  <span className="flowfi-mono" style={{ fontSize: 11, color: "#6D5EF7" }}>{shortAddr}</span>
                </a>
              </div>
            )}

            {tab === "dashboard" && <Dashboard address={wallet.address} balances={balances} onNavigate={(t) => setTab(t)} />}
            {tab === "analytics" && <StablecoinAnalytics />}
            {tab === "history" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <AiNarrator address={wallet.address} balances={balances} />
                <TxHistory address={wallet.address} />
              </div>
            )}
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

export default function App() {
  return (
    <AppErrorBoundary>
      <AppInner />
    </AppErrorBoundary>
  );
}
