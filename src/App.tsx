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
import FeedbackWidget from "./components/FeedbackWidget";
import OnboardingModal, { hasSeenOnboarding } from "./components/OnboardingModal";
import BridgeForm from "./components/BridgeForm";
import GatewayPanel from "./components/GatewayPanel";
import SwapForm from "./components/SwapForm";
import SendForm from "./components/SendForm";
import TxHistory from "./components/TxHistory";
import Dashboard from "./components/Dashboard";
import ReceiveQR from "./components/ReceiveQR";
import UnifiedBalance from "./components/UnifiedBalance";
import CircleWallet from "./components/CircleWallet";
import LiquidityPools from "./components/LiquidityPools";
import AiCopilot from "./components/AiCopilot";
import ToastContainer from "./components/ToastContainer";
import MarketTicker from "./components/MarketTicker";
import NotificationCenter from "./components/NotificationCenter";
import { getPoints, getNickname, setNickname as saveNickname, clearNickname } from "./gamification";
import { getDCAPlan, isDCADue } from "./dca";
import { getCircleWallet, type CircleWalletInfo } from "./circleWalletHelpers";
import { getRules, isRuleDue, markRuleTriggered } from "./automation";
import { showToast } from "./toast";
import {
  Home, LayoutGrid, ArrowUpRight, ArrowDownLeft, Repeat, TrendingUp, Droplet,
  Landmark, Rocket, Hexagon, CircleDollarSign, LayoutDashboard, BarChart3, History as HistoryIcon,
  Sparkles, Moon, Power, Copy, Check, RefreshCw, Zap,
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

type Tab = "home" | "portfolio" | "send" | "receive" | "swap" | "pools" | "lending" | "launch" | "analytics" | "dashboard" | "history" | "bridge" | "circlewallet" | "gateway";

const ARC_USDC = "0x3600000000000000000000000000000000000000" as `0x${string}`;
const ARC_EURC = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" as `0x${string}`;
const ARC_USYC = "0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C" as `0x${string}`;

const HOME_TAB: { id: Tab; label: string; Icon: any } = { id: "home", label: "Home", Icon: Home };
const PORTFOLIO_TAB: { id: Tab; label: string; Icon: any } = { id: "portfolio", label: "Portfolio", Icon: LayoutGrid };

const TAB_GROUPS: { group: string; variant?: "testnet"; tabs: { id: Tab; label: string; Icon: any }[] }[] = [
 {
  group: "📈 TRADE",
  tabs: [
    { id: "swap",      label: "Swap",      Icon: Repeat },
  ],
},
{
  group: "TRANSFER",
  tabs: [
    { id: "bridge",       label: "Bridge",        Icon: Hexagon },
    { id: "gateway",      label: "Gateway",       Icon: Zap },
    { id: "circlewallet", label: "Circle Wallet", Icon: CircleDollarSign },
    { id: "send",         label: "Send",          Icon: ArrowUpRight },
    { id: "receive",      label: "Receive",       Icon: ArrowDownLeft },
  ],
},
{
  group: "🛠️ TOOLS",
  tabs: [
    { id: "pools",     label: "Liquidity", Icon: Droplet },
    { id: "launch",    label: "Launch Token", Icon: Rocket },
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
{
  group: "TESTNET ONLY",
  variant: "testnet",
  tabs: [
    { id: "lending",   label: "Lending",   Icon: Landmark },
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
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth <= 860);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    function onResize() { setIsMobile(window.innerWidth <= 860); }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const [tab, setTab] = useState<Tab>("home");
  const [balances, setBalances] = useState<Balances>({ usdc: null, eurc: null, usyc: null, native: null });
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [recentTxs, setRecentTxs] = useState<RecentTx[]>([]);
  const [eurUsdRate, setEurUsdRate] = useState<number | null>(null);
  const [nickname, setNicknameState] = useState<string | null>(null);
  const [circleWalletInfo, setCircleWalletInfo] = useState<CircleWalletInfo | null>(null);
  const [circleBalances, setCircleBalances] = useState<{ usdc: string; eurc: string } | null>(null);
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

  useEffect(() => {
    let cancelled = false;
    async function loadCircleBalances(info: CircleWalletInfo) {
      try {
        const client = createPublicClient({ chain: arcTestnet, transport: http() });
        const [usdc, eurc] = await Promise.all([
          client.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: "balanceOf", args: [info.address as `0x${string}`] }),
          client.readContract({ address: ARC_EURC, abi: erc20Abi, functionName: "balanceOf", args: [info.address as `0x${string}`] }),
        ]);
        if (!cancelled) setCircleBalances({ usdc: Number(formatUnits(usdc as bigint, 6)).toFixed(2), eurc: Number(formatUnits(eurc as bigint, 6)).toFixed(2) });
      } catch {
        if (!cancelled) setCircleBalances({ usdc: "—", eurc: "—" });
      }
    }
    function refresh() {
      const info = getCircleWallet();
      setCircleWalletInfo(info);
      if (info) loadCircleBalances(info);
      else setCircleBalances(null);
    }
    refresh();
    const interval = setInterval(refresh, 15000);
    window.addEventListener("circle-wallet-changed", refresh);
    return () => { cancelled = true; clearInterval(interval); window.removeEventListener("circle-wallet-changed", refresh); };
  }, []);

 function handleConnected(provider: EIP1193Provider, address: string, walletName: string) {
  setWallet({ provider, address, walletName });
  setTab("home");
  showToast("Wallet connected", "success");
  if (!hasSeenOnboarding()) setShowOnboarding(true);
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

      const usdcNum = Number(formatUnits(usdc as bigint, 6));
      for (const rule of getRules()) {
        if (isRuleDue(rule, usdcNum)) {
          markRuleTriggered(rule.id);
          showToast(`Automation: USDC balance is above ${rule.conditionValue} — you set a reminder to supply ${rule.actionAmount} USDC to Lending. Open Lending to confirm.`, "info");
        }
      }
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
      const res = await fetch("https://api.frankfurter.dev/v1/latest?from=EUR&to=USD");
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
      input[type="number"]::-webkit-outer-spin-button,
      input[type="number"]::-webkit-inner-spin-button {
        -webkit-appearance: none;
        margin: 0;
      }
      input[type="number"] {
        -moz-appearance: textfield;
      }
      input::placeholder { color: #9CA3AF; }
      @media (max-width: 860px) {
        html, body, #root { overflow-x: auto; max-width: 100vw; }
      }
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
          Tell FlowFi what you want.<br />It handles the rest.
        </h1>
        <p style={{ fontSize: 17, color: "#4B5563", lineHeight: 1.6, maxWidth: 560, margin: "0 auto 32px" }}>
          Swap, bridge, lend, launch tokens, trade perpetuals, and manage your stablecoins — all through one intelligent Copilot on Arc.
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
          {["Native USDC", "CCTP V2", "AI Copilot", "Lending", "Token Launch"].map((f) => (
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

      <footer style={{ position: "relative", zIndex: 1, background: "linear-gradient(180deg, #171130, #120D26)", marginTop: 40 }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "3rem 2rem 1.5rem", display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "2.5rem" }}>
          <div style={{ maxWidth: 320 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <div style={{ width: 30, height: 30, borderRadius: 10, background: "linear-gradient(135deg, #8B7CF9, #6D5EF7)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: "#fff" }}>◈</div>
              <span className="flowfi-display" style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>FlowFi</span>
            </div>
            <p style={{ fontSize: 12.5, color: "#9CA3AF", lineHeight: 1.6, marginBottom: 16 }}>
              An AI-powered DeFi platform built on Arc Testnet, Circle's stablecoin-native Layer-1. Swap, bridge, and provide liquidity through one intelligent Copilot.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <a href="https://x.com/flowfiarc" target="_blank" rel="noopener noreferrer"
                style={{ width: 34, height: 34, borderRadius: 9, background: "#000", display: "flex", alignItems: "center", justifyContent: "center" }} aria-label="X (Twitter)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff"><path d="M18.9 2H22l-7.6 8.7L23.3 22h-6.9l-5.4-6.9L4.7 22H1.5l8.2-9.3L1 2h7.1l4.9 6.4L18.9 2zm-1.2 18h1.9L7.4 4H5.4l12.3 16z" /></svg>
              </a>
              <a href="https://github.com/sekuler/flowfi" target="_blank" rel="noopener noreferrer"
                style={{ width: 34, height: 34, borderRadius: 9, background: "#24292e", display: "flex", alignItems: "center", justifyContent: "center" }} aria-label="GitHub">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><path d="M12 .5C5.73.5.75 5.48.75 11.75c0 5.02 3.26 9.28 7.78 10.78.57.1.78-.25.78-.55 0-.27-.01-1.17-.02-2.12-3.16.69-3.83-1.34-3.83-1.34-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.75 1.18 1.75 1.18 1.02 1.75 2.68 1.24 3.33.95.1-.74.4-1.24.72-1.53-2.52-.29-5.17-1.26-5.17-5.6 0-1.24.44-2.25 1.17-3.04-.12-.29-.51-1.45.11-3.02 0 0 .96-.31 3.14 1.16a10.9 10.9 0 0 1 5.72 0c2.18-1.47 3.14-1.16 3.14-1.16.62 1.57.23 2.73.11 3.02.73.79 1.17 1.8 1.17 3.04 0 4.35-2.65 5.31-5.18 5.59.41.35.77 1.05.77 2.12 0 1.53-.01 2.76-.01 3.14 0 .3.2.66.79.55 4.51-1.51 7.77-5.76 7.77-10.78C23.25 5.48 18.27.5 12 .5z" /></svg>
              </a>
            </div>
          </div>

          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "#fff", marginBottom: 14 }}>Quick Links</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                { label: "Live App", href: "#top" },
                { label: "Faucet", href: "https://faucet.circle.com" },
                { label: "Explorer", href: "https://testnet.arcscan.app" },
                { label: "Watch Demo", href: "https://x.com/flowfiarc/status/2078926068485173522" },
              ].map(({ label, href }) => (
                <a key={label} href={href} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: "#9CA3AF", textDecoration: "none" }}>{label}</a>
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "#fff", marginBottom: 14 }}>Resources</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                { label: "Documentation", href: "https://github.com/sekuler/flowfi#readme" },
                { label: "Arc Docs", href: "https://docs.arc.io" },
                { label: "Source Code", href: "https://github.com/sekuler/flowfi" },
              ].map(({ label, href }) => (
                <a key={label} href={href} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: "#9CA3AF", textDecoration: "none" }}>{label}</a>
              ))}
            </div>
          </div>
        </div>
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ maxWidth: 1100, margin: "0 auto", padding: "1.1rem 2rem", display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8 }}>
            <span style={{ fontSize: 11.5, color: "#6B7280" }}>© 2026 FlowFi. All rights reserved.</span>
            <span style={{ fontSize: 11.5, color: "#6B7280" }}>Built on Circle & Arc Testnet</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

  return (
    <div style={{ minHeight: "100vh", display: "flex", color: "#111827", position: "relative" }}>
      {sharedStyle}
      <PastelBackground />
      <ToastContainer />
      {isMobile && mobileMenuOpen && (
        <div onClick={() => setMobileMenuOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.4)", zIndex: 3 }} />
      )}
      <aside style={{
        width: 220, minHeight: "100vh", background: "rgba(255,255,255,0.98)", backdropFilter: "blur(24px)",
        boxShadow: isMobile ? "0 0 32px rgba(17,24,39,0.2)" : "1px 0 0 rgba(109,94,247,0.08)",
        display: "flex", flexDirection: "column", padding: "1.5rem 0",
        position: "fixed", top: 0, left: isMobile && !mobileMenuOpen ? -240 : 0, zIndex: 4,
        transition: "left 0.2s ease",
      }}>
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
          <div style={{ marginBottom: 4 }}>
            {[HOME_TAB, PORTFOLIO_TAB].map((t) => (
              <button key={t.id} onClick={() => { setTab(t.id); if (isMobile) setMobileMenuOpen(false); }}
                style={{
                  width: "100%", padding: "0.45rem 1rem", borderRadius: 999, border: "none",
                  background: tab === t.id ? "linear-gradient(90deg, #ede9fe, #f5f3ff)" : "transparent",
                  color: tab === t.id ? "#6D5EF7" : "#4B5563",
                  fontSize: 12.5, fontWeight: tab === t.id ? 700 : 500, cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 9, textAlign: "left",
                  marginBottom: 1,
                }}>
                <t.Icon size={15} strokeWidth={2} />
                <span>{t.label}</span>
              </button>
            ))}
          </div>
          {TAB_GROUPS.map(({ group, variant, tabs }) => (
            <div key={group} style={{ marginBottom: 4 }}>
              <div style={{ display: "inline-block", fontSize: 9, color: "#ffffff", background: variant === "testnet" ? "#D97706" : "#3B82F6", fontWeight: 800, letterSpacing: "1.5px", padding: "0.3rem 0.6rem", borderRadius: 6, margin: "0.35rem 1rem 0.2rem" }}>{group}</div>
              {tabs.map(({ id, label, Icon }) => {
                const active = tab === id;
                return (
                  <button key={id} onClick={() => { setTab(id); if (isMobile) setMobileMenuOpen(false); }}
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
          <button onClick={() => { localStorage.removeItem("flowfi-last-wallet-rdns"); setWallet(null); }} style={{ marginTop: 10, fontSize: 11, color: "#6D5EF7", background: "rgba(109,94,247,0.08)", border: "none", borderRadius: 999, padding: "5px 12px", cursor: "pointer", width: "100%" }}>Disconnect</button>
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

      <main style={{ marginLeft: isMobile ? 0 : 220, flex: 1, minHeight: "100vh", position: "relative", zIndex: 1 }}>
        {isMobile && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.85rem 1rem", background: "rgba(255,255,255,0.9)", backdropFilter: "blur(12px)", position: "sticky", top: 0, zIndex: 3, boxShadow: "0 1px 0 rgba(109,94,247,0.08)" }}>
            <button onClick={() => setMobileMenuOpen(true)} style={{ background: "none", border: "none", fontSize: 20, color: "#6D5EF7", cursor: "pointer", padding: "4px 8px" }}>
              ☰
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 26, height: 26, borderRadius: 8, background: "linear-gradient(135deg, #8B7CF9, #6D5EF7)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "#fff" }}>◈</div>
              <span className="flowfi-display" style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>FlowFi</span>
            </div>
            <div style={{ width: 32 }} />
          </div>
        )}
        <MarketTicker />
        <header style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 14, padding: isMobile ? "0.85rem 1rem" : "1.25rem 2.5rem" }}>
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
          <button onClick={() => { localStorage.removeItem("flowfi-last-wallet-rdns"); setWallet(null); }} title="Disconnect wallet"
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: 10, border: "none", background: "rgba(239,68,68,0.1)", color: "#EF4444", cursor: "pointer" }}>
            <Power size={15} />
          </button>
        </header>

        <div style={{ padding: isMobile ? "1rem" : "2.5rem" }}>
          <div key={tab} className="flowfi-page" style={{ maxWidth: isMobile ? "100%" : (tab === "home" || tab === "bridge" || tab === "gateway" ? 1200 : tab === "pools" || tab === "swap" || tab === "dashboard" ? 900 : 520), margin: "0 auto" }}>
            <div style={{ marginBottom: "2rem" }}>
              <h1 className="flowfi-display" style={{ fontSize: 24, fontWeight: 700, color: "#111827", marginBottom: 4, letterSpacing: "-0.5px" }}>
                {tab === "home" ? "Home" : tab === "portfolio" ? "Portfolio" : tab === "dashboard" ? "Dashboard" : tab === "analytics" ? "Stablecoin Analytics" : tab === "send" ? "Send" : tab === "receive" ? "Receive" : tab === "swap" ? "Swap" : tab === "pools" ? "Liquidity Pools" : tab === "lending" ? "Lending" : tab === "launch" ? "Launch Token" : tab === "history" ? "History" : tab === "circlewallet" ? "Circle Wallet" : "Bridge"}
              </h1>
              <p style={{ fontSize: 13, color: "#6B7280" }}>
               {tab === "home" ? "Your AI-powered financial overview" : tab === "portfolio" ? "Arc Testnet balances" : tab === "dashboard" ? "Portfolio analytics and activity" : tab === "analytics" ? "Platform-wide stablecoin TVL and distribution" : tab === "send" ? "Send USDC or EURC on Arc" : tab === "receive" ? "Share your address or QR code to receive funds" : tab === "swap" ? "Swap USDC and EURC instantly" : tab === "pools" ? "Permissionless AMM — create or join any pool" : tab === "lending" ? "Supply to earn, or borrow against collateral — testnet only, not planned for mainnet" : tab === "launch" ? "Deploy your own ERC20 token on Arc" : tab === "history" ? "Recent transactions on Arc Testnet" : tab === "circlewallet" ? "Create a wallet without a seed phrase" : "Bridge USDC to Arc via CCTP"}
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
                <div style={{ fontSize: 11, color: "#6B7280", fontWeight: 700, letterSpacing: "1px" }}>BROWSER WALLET · {shortAddr}</div>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "0.75rem" }}>
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

                {circleWalletInfo && (
                  <>
                    <div style={{ fontSize: 11, color: "#6B7280", fontWeight: 700, letterSpacing: "1px", marginTop: 6 }}>CIRCLE WALLET · {circleWalletInfo.address.slice(0, 6)}...{circleWalletInfo.address.slice(-4)}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                      {(["USDC", "EURC"] as const).map((label) => (
                        <div key={label} className="flowfi-glow-card" style={{ background: "#ffffff", borderRadius: 16, padding: "1.25rem", boxShadow: "0 1px 3px rgba(109,94,247,0.08)", border: "1px solid #D4C9FA" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                            <img src={label === "USDC" ? "https://assets.coingecko.com/coins/images/6319/small/usdc.png" : "https://assets.coingecko.com/coins/images/26045/small/euro.png"} alt={label} style={{ width: 20, height: 20, borderRadius: "50%" }} />
                            <div style={{ fontSize: 11, color: "#6B7280", fontWeight: 600, letterSpacing: "1px" }}>{label}</div>
                          </div>
                          <div className="flowfi-mono" style={{ fontSize: 22, fontWeight: 700, color: label === "USDC" ? "#3B82F6" : "#22C55E" }}>
                            {circleBalances ? (label === "USDC" ? circleBalances.usdc : circleBalances.eurc) : <Skeleton width={70} height={22} />}
                          </div>
                          <div style={{ fontSize: 11, color: "#6B7280", marginTop: 4 }}>Same address, 4 chains</div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {!circleWalletInfo && (
                  <button onClick={() => setTab("circlewallet")}
                    style={{ background: "#f5f3ff", border: "none", borderRadius: 14, padding: "0.9rem 1rem", color: "#6D5EF7", fontSize: 12.5, fontWeight: 600, cursor: "pointer", textAlign: "left" }}>
                    + Create a Circle Wallet to see it alongside your browser wallet here
                  </button>
                )}
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
            {tab === "history" && <TxHistory address={wallet.address} />}
            {tab === "receive" && <ReceiveQR address={wallet.address} />}
            {tab === "bridge" && <BridgeForm provider={wallet.provider} address={wallet.address} walletName={wallet.walletName} onNavigate={(t) => setTab(t)} />}
            {tab === "gateway" && <GatewayPanel provider={wallet.provider} address={wallet.address} />}
            {tab === "swap" && <SwapForm provider={wallet.provider} address={wallet.address} balances={balances} onRefresh={() => loadBalances(wallet.address)} />}
            {tab === "send" && <SendForm provider={wallet.provider} address={wallet.address} balances={balances} onRefresh={() => loadBalances(wallet.address)} />}
            {tab === "circlewallet" && <CircleWallet />}
            {tab === "pools" && <LiquidityPools provider={wallet.provider} address={wallet.address} balances={balances} onRefresh={() => loadBalances(wallet.address)} />}
          {tab === "lending" && <LendingForm provider={wallet.provider} address={wallet.address} balances={balances} onRefresh={() => loadBalances(wallet.address)} />}
          {tab === "launch" && <TokenLaunch provider={wallet.provider} address={wallet.address} onNavigateToPools={() => setTab("pools")} />}
          </div>
        </div>

        <footer style={{ background: "linear-gradient(180deg, #171130, #120D26)", marginTop: 48 }}>
          <div style={{ maxWidth: 1100, margin: "0 auto", padding: "3rem 2rem 1.5rem", display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "2.5rem" }}>
            <div style={{ maxWidth: 320 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <div style={{ width: 30, height: 30, borderRadius: 10, background: "linear-gradient(135deg, #8B7CF9, #6D5EF7)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: "#fff" }}>◈</div>
                <span className="flowfi-display" style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>FlowFi</span>
              </div>
              <p style={{ fontSize: 12.5, color: "#9CA3AF", lineHeight: 1.6, marginBottom: 16 }}>
                An AI-powered DeFi platform built on Arc Testnet, Circle's stablecoin-native Layer-1. Swap, bridge, and provide liquidity through one intelligent Copilot.
              </p>
              <div style={{ display: "flex", gap: 10 }}>
                <a href="https://x.com/flowfiarc" target="_blank" rel="noopener noreferrer"
                  style={{ width: 34, height: 34, borderRadius: 9, background: "#000", display: "flex", alignItems: "center", justifyContent: "center" }} aria-label="X (Twitter)">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff"><path d="M18.9 2H22l-7.6 8.7L23.3 22h-6.9l-5.4-6.9L4.7 22H1.5l8.2-9.3L1 2h7.1l4.9 6.4L18.9 2zm-1.2 18h1.9L7.4 4H5.4l12.3 16z" /></svg>
                </a>
                <a href="https://github.com/sekuler/flowfi" target="_blank" rel="noopener noreferrer"
                  style={{ width: 34, height: 34, borderRadius: 9, background: "#24292e", display: "flex", alignItems: "center", justifyContent: "center" }} aria-label="GitHub">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><path d="M12 .5C5.73.5.75 5.48.75 11.75c0 5.02 3.26 9.28 7.78 10.78.57.1.78-.25.78-.55 0-.27-.01-1.17-.02-2.12-3.16.69-3.83-1.34-3.83-1.34-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.75 1.18 1.75 1.18 1.02 1.75 2.68 1.24 3.33.95.1-.74.4-1.24.72-1.53-2.52-.29-5.17-1.26-5.17-5.6 0-1.24.44-2.25 1.17-3.04-.12-.29-.51-1.45.11-3.02 0 0 .96-.31 3.14 1.16a10.9 10.9 0 0 1 5.72 0c2.18-1.47 3.14-1.16 3.14-1.16.62 1.57.23 2.73.11 3.02.73.79 1.17 1.8 1.17 3.04 0 4.35-2.65 5.31-5.18 5.59.41.35.77 1.05.77 2.12 0 1.53-.01 2.76-.01 3.14 0 .3.2.66.79.55 4.51-1.51 7.77-5.76 7.77-10.78C23.25 5.48 18.27.5 12 .5z" /></svg>
                </a>
              </div>
            </div>

            <div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: "#fff", marginBottom: 14 }}>Quick Links</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <button onClick={() => setTab("swap")} style={{ background: "none", border: "none", padding: 0, textAlign: "left", fontSize: 13, color: "#9CA3AF", cursor: "pointer" }}>Swap</button>
                <button onClick={() => setTab("bridge")} style={{ background: "none", border: "none", padding: 0, textAlign: "left", fontSize: 13, color: "#9CA3AF", cursor: "pointer" }}>Bridge</button>
                <button onClick={() => setTab("pools")} style={{ background: "none", border: "none", padding: 0, textAlign: "left", fontSize: 13, color: "#9CA3AF", cursor: "pointer" }}>Liquidity Pools</button>
                <a href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: "#9CA3AF", textDecoration: "none" }}>Faucet</a>
              </div>
            </div>

            <div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: "#fff", marginBottom: 14 }}>Resources</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <a href="https://github.com/sekuler/flowfi#readme" target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: "#9CA3AF", textDecoration: "none" }}>Documentation</a>
                <a href="https://testnet.arcscan.app" target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: "#9CA3AF", textDecoration: "none" }}>Block Explorer</a>
                <a href="https://github.com/sekuler/flowfi" target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: "#9CA3AF", textDecoration: "none" }}>Source Code</a>
              </div>
            </div>
          </div>
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ maxWidth: 1100, margin: "0 auto", padding: "1.1rem 2rem", display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontSize: 11.5, color: "#6B7280" }}>© 2026 FlowFi. All rights reserved.</span>
              <span style={{ fontSize: 11.5, color: "#6B7280" }}>Built on Circle & Arc Testnet</span>
            </div>
          </div>
        </footer>
      </main>

      <AiCopilot provider={wallet.provider} address={wallet.address} balances={balances} onRefresh={() => loadBalances(wallet.address)} onNavigate={(t) => setTab(t)} />
      <FeedbackWidget />
      {showOnboarding && <OnboardingModal onClose={() => setShowOnboarding(false)} />}
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
