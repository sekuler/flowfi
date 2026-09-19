import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import StablecoinAnalytics from "./components/StablecoinAnalytics";
import CopilotHomeMainnet from "./components/CopilotHomeMainnet";
import TokenLaunch from "./components/TokenLaunch";
import { useState, useEffect, Component, type ReactNode } from "react";
import type { EIP1193Provider } from "viem";
import { createPublicClient, http, erc20Abi, formatUnits } from "viem";
import { arcTestnet, arcMainnet, formatUsdcErc20, formatArcNative } from "./chains";
import { discoverWallets } from "./components/WalletConnect";
import ConnectModal from "./components/ConnectModal";
import OnboardingModal, { hasSeenOnboarding } from "./components/OnboardingModal";
import TransferHub from "./components/TransferHub";
import SwapForm from "./components/SwapForm";
import TxHistory from "./components/TxHistory";
import Dashboard from "./components/Dashboard";
import DashboardMainnet from "./components/DashboardMainnet";
import MainnetSwap from "./components/MainnetSwap";
import CircleWallet from "./components/CircleWallet";
import LiquidityPools from "./components/LiquidityPools";
import AiCopilot from "./components/AiCopilot";
import AiCopilotMainnet from "./components/AiCopilotMainnet";
import ToastContainer from "./components/ToastContainer";
import MarketTicker from "./components/MarketTicker";
import NotificationCenter from "./components/NotificationCenter";
import MainnetBridge from "./components/MainnetBridge";
import { getPoints, getNickname, setNickname as saveNickname, clearNickname } from "./gamification";
import { getDCAPlan, isDCADue } from "./dca";
import { getCircleWallet, forgetCircleWallet, type CircleWalletInfo } from "./circleWalletHelpers";
import { showToast } from "./toast";
import { USDC_ADDRESS, EURC_ADDRESS, USYC_ADDRESS, CIRBTC_ADDRESS } from "./contracts";
import {
  Home, Repeat, Droplet,
  Rocket, Hexagon, CircleDollarSign, LayoutDashboard, BarChart3, History as HistoryIcon,
  Sparkles, Moon, Power, Copy, Check, Lock, Mail, Zap, ShieldCheck as ShieldCheckIcon,
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
  cirbtc: string | null;
  native: string | null;
}

type Tab = "home" | "swap" | "pools" | "launch" | "analytics" | "dashboard" | "history" | "bridge" | "circlewallet" | "mainnetbridge" | "dashboardmainnet" | "mainnetswap";

const ARC_USDC = USDC_ADDRESS;
// Arc mainnet USDC -- the only mainnet stablecoin address confirmed so
// far (EURC/USYC/cirBTC mainnet addresses aren't verified yet, so
// DashboardMainnet only ever gets a real USDC figure; the rest stay 0).
const ARC_MAINNET_USDC = "0x3600000000000000000000000000000000000000" as const;
// Guest mode (browsing Pools without a connected wallet) needs *something* to pass as
// address/provider — a real zero address for read-only reserve/APR lookups, and a stub
// provider whose request() always rejects, so if a guest somehow reaches an action button,
// it fails cleanly with a clear message instead of crashing on a missing wallet.
const queryClient = new QueryClient();
const GUEST_ADDRESS = "0x0000000000000000000000000000000000000000";
const GUEST_PROVIDER = { request: async () => { throw new Error("Connect a wallet to do this."); } } as unknown as EIP1193Provider;
const ARC_EURC = EURC_ADDRESS;
const ARC_USYC = USYC_ADDRESS;
const ARC_CIRBTC = CIRBTC_ADDRESS;

const GUEST_SAFE_TABS: Tab[] = ["pools", "analytics", "mainnetbridge", "mainnetswap"];
// Bridge/Swap/History already read their own Circle Wallet from localStorage
// internally (independent of the provider/address props) — so a Circle-primary
// session can use them today. Portfolio only ever does read-only balance
// lookups (no signing), so it works for any address. Home/Dashboard/Launch and
// the AI Copilot all assume a real browser-wallet signer and don't
// have a Circle-Wallet code path yet — those stay locked until that's built.
const CIRCLE_SAFE_TABS: Tab[] = ["pools", "analytics", "bridge", "swap", "history", "circlewallet"];

const TAB_GROUPS: { group: string; variant?: "testnet" | "mainnet"; tabs: { id: Tab; label: string; Icon: any }[] }[] = [
 {
  group: "⚡ MAINNET",
  variant: "mainnet",
  tabs: [
    { id: "home", label: "Home", Icon: Home },
    { id: "mainnetbridge", label: "Bridge", Icon: Zap },
    { id: "mainnetswap", label: "Swap", Icon: Repeat },
    { id: "dashboardmainnet", label: "Dashboard", Icon: LayoutDashboard },
    // Circle Wallet on mainnet was fully removed (2026-09-18), not just
    // hidden from nav -- component file, Tab union entry, and safe-tab
    // list entries are all gone (an earlier pass only removed the nav
    // item, leaving the tab reachable via any lingering setTab() call).
    // Turkish law (7518 sayılı Kanun, SPK's 02.07.2024 announcement)
    // brings anyone managing users' private keys ("kripto varlıklara
    // ilişkin cüzdandan transfer hakkı sağlayan özel anahtarların
    // saklanması ve yönetimi") under SPK licensing, with both
    // administrative and criminal penalties for operating unlicensed.
    // Circle Developer-Controlled Wallets does exactly that (FlowFi's
    // backend holds the signing authority, not the user), so it's the
    // wrong shape for mainnet real funds -- self-custody only from here:
    // Bridge and Swap sign entirely through the user's own browser
    // wallet (LI.FI's EthereumProvider, no backend key/entity secret
    // involved), a very different, much lower-risk legal category (a
    // frontend to public infra, not a custodian). Circle Wallet stays as
    // -is on Testnet (no real funds, no risk) -- see CircleWallet.tsx,
    // untouched. Token Launch and Liquidity Pools stay Testnet-only for
    // the same reasoning -- never ported to mainnet, and won't be until
    // both a professional audit and the licensing question are settled.
  ],
},
 {
  group: "📈 TRADE",
  variant: "testnet",
  tabs: [
    { id: "swap",      label: "Swap",      Icon: Repeat },
  ],
},
{
  group: "TRANSFER",
  variant: "testnet",
  tabs: [
    { id: "bridge",       label: "Bridge",        Icon: Hexagon },
    { id: "circlewallet", label: "Circle Wallet", Icon: CircleDollarSign },
  ],
},
{
  group: "🛠️ TOOLS",
  variant: "testnet",
  tabs: [
    { id: "pools",     label: "Liquidity", Icon: Droplet },
    { id: "launch",    label: "Launch Token", Icon: Rocket },
  ],
},
 {
  group: "ANALYTICS",
  variant: "testnet",
  tabs: [
    { id: "dashboard", label: "Dashboard", Icon: LayoutDashboard },
    { id: "analytics", label: "Stablecoin Analytics", Icon: BarChart3 },
    { id: "history",   label: "History",   Icon: HistoryIcon },
  ],
},
];

const LANDING_FEATURE_ICONS = [Mail, Zap, Sparkles, Hexagon, Rocket, Repeat];

// Self-custody leads — genuinely rare in most bridge/swap aggregator
// frontends (many quietly route through a hosted signer or custodial
// step somewhere). Every card below describes what's actually live on
// Arc Mainnet today, nothing from the Testnet showcase.
const LANDING_FEATURES = [
  { title: "Self-Custody, Always", desc: "Every transaction is signed by your own connected wallet. FlowFi never holds a key, a balance, or signing authority over your funds." },
  { title: "Circle CCTP V2", desc: "Genuine native USDC bridging via Circle's own official burn/attest/mint protocol — not a wrapped-asset bridge." },
  { title: "LI.FI Aggregation", desc: "Bridge or swap any token across Arc and dozens of other chains, routed through the best available rate." },
  { title: "AI Copilot", desc: "Tell it what you want in plain language — it takes you straight to the right page to confirm with your own wallet." },
  { title: "Native USDC on Arc", desc: "USDC is Arc's actual gas token, not a wrapped placeholder — funds are productive the moment they land." },
  { title: "Real-Time Activity", desc: "Balances and transaction history read live from Arc's own official explorer — nothing cached or FlowFi-side." },
];

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
  const [guestMode, setGuestMode] = useState(false);
  const [circlePrimary, setCirclePrimary] = useState(false);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth <= 860);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    function onResize() { setIsMobile(window.innerWidth <= 860); }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const [tab, setTab] = useState<Tab>("home");
  const [balances, setBalances] = useState<Balances>({ usdc: null, eurc: null, usyc: null, cirbtc: null, native: null });
  const [mainnetBalances, setMainnetBalances] = useState<Balances>({ usdc: null, eurc: null, usyc: null, cirbtc: null, native: null });
  const [copied, setCopied] = useState(false);
  const [nickname, setNicknameState] = useState<string | null>(null);
  const [circleWalletInfo, setCircleWalletInfo] = useState<CircleWalletInfo | null>(null);
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

  // Silently check whether the wallet from a previous session is still authorized —
  // no popup, just a background eth_accounts check. Runs on load regardless of
  // whether the connect modal is open, so a page refresh doesn't drop the session.
  useEffect(() => {
    const lastRdns = localStorage.getItem("flowfi-last-wallet-rdns");
    if (!lastRdns) return;
    (async () => {
      const found = await discoverWallets();
      const match = found.find((w) => w.info.rdns === lastRdns);
      if (!match) return;
      try {
        const accounts = (await match.provider.request({ method: "eth_accounts", params: undefined })) as string[];
        if (accounts[0]) handleConnected(match.provider, accounts[0], match.info.name);
      } catch {
        // Silent check failed — just show the normal connect screen.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function refresh() {
      setCircleWalletInfo(getCircleWallet());
    }
    refresh();
    const interval = setInterval(refresh, 15000);
    window.addEventListener("circle-wallet-changed", refresh);
    return () => { clearInterval(interval); window.removeEventListener("circle-wallet-changed", refresh); };
  }, []);

 function handleConnected(provider: EIP1193Provider, address: string, walletName: string) {
  setWallet({ provider, address, walletName });
  setGuestMode(false);
  setCirclePrimary(false);
  setShowConnectModal(false);
  setTab("home");
  showToast("Wallet connected", "success");
  if (!hasSeenOnboarding()) setShowOnboarding(true);
}

  function handleCircleConnected(info: CircleWalletInfo) {
    setCircleWalletInfo(info);
    setCirclePrimary(true);
    setGuestMode(false);
    setShowConnectModal(false);
    setTab("pools");
    showToast("Circle Wallet connected", "success");
  }

  function goToTab(id: Tab) {
    if (!wallet && guestMode && !GUEST_SAFE_TABS.includes(id)) {
      setGuestMode(false); // bounce back to the connect screen — this tab needs a real wallet
      return;
    }
    if (!wallet && circlePrimary && !CIRCLE_SAFE_TABS.includes(id)) {
      setShowConnectModal(true); // this tab isn't wired for Circle Wallet yet — offer to add a browser wallet
      return;
    }
    if (!wallet && !guestMode && !circlePrimary) {
      setShowConnectModal(true);
      return;
    }
    setTab(id);
    if (isMobile) setMobileMenuOpen(false);
  }

  async function loadBalances(address: string) {
    try {
      const client = createPublicClient({ chain: arcTestnet, transport: http() });
      const [usdc, eurc, usyc, cirbtc, native] = await Promise.all([
        client.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: "balanceOf", args: [address as `0x${string}`] }).catch(() => 0n),
        client.readContract({ address: ARC_EURC, abi: erc20Abi, functionName: "balanceOf", args: [address as `0x${string}`] }).catch(() => 0n),
        client.readContract({ address: ARC_USYC, abi: erc20Abi, functionName: "balanceOf", args: [address as `0x${string}`] }).catch(() => 0n),
        client.readContract({ address: ARC_CIRBTC, abi: erc20Abi, functionName: "balanceOf", args: [address as `0x${string}`] }).catch(() => 0n),
        client.getBalance({ address: address as `0x${string}` }).catch(() => 0n),
      ]);
      setBalances({
        usdc: formatUsdcErc20(usdc as bigint).toFixed(2),
        eurc: Number(formatUnits(eurc as bigint, 6)).toFixed(2),
        usyc: Number(formatUnits(usyc as bigint, 6)).toFixed(2),
        cirbtc: Number(formatUnits(cirbtc as bigint, 8)).toFixed(6),
        native: formatArcNative(native as bigint).toFixed(4),
      });
    } catch {
      setBalances({ usdc: "—", eurc: "—", usyc: "—", cirbtc: "—", native: "—" });
    }
  }

  // Same EOA address works on Arc mainnet as on testnet (both are just
  // EVM chains) -- only USDC has a confirmed mainnet contract address
  // today, so that's the only real figure here; the rest are left at 0
  // rather than guessing addresses that could be wrong.
  // Arc represents USDC two separate ways: a native/protocol balance
  // (18 decimals, what a plain wallet-to-wallet "send" moves, since USDC
  // is the gas token) and a separate ERC-20 contract at 0x3600...
  // (6 decimals, what dApp/contract interactions use). A transfer showing
  // complete on arc.etherscan.io but reading as 0 here almost certainly
  // means it landed as native, not ERC-20 -- fetching both rather than
  // assuming one, so this is visible instead of guessed at.
  async function loadMainnetBalances(address: string) {
    try {
      const client = createPublicClient({ chain: arcMainnet, transport: http() });
      const [usdcErc20, nativeBal] = await Promise.all([
        client.readContract({ address: ARC_MAINNET_USDC, abi: erc20Abi, functionName: "balanceOf", args: [address as `0x${string}`] }).catch((e) => { console.error("Mainnet USDC balanceOf failed:", e); return 0n; }),
        client.getBalance({ address: address as `0x${string}` }).catch((e) => { console.error("Mainnet native getBalance failed:", e); return 0n; }),
      ]);
      setMainnetBalances({
        usdc: formatUsdcErc20(usdcErc20 as bigint).toFixed(2),
        eurc: null,
        usyc: null,
        cirbtc: null,
        native: formatArcNative(nativeBal as bigint).toFixed(2),
      });
    } catch {
      setMainnetBalances({ usdc: "—", eurc: null, usyc: null, cirbtc: null, native: "—" });
    }
  }

  useEffect(() => {
    if (wallet) {
      loadBalances(wallet.address);
      loadMainnetBalances(wallet.address);
    } else if (circlePrimary && circleWalletInfo) {
      loadBalances(circleWalletInfo.address);
      loadMainnetBalances(circleWalletInfo.address);
    }
  }, [wallet, circlePrimary, circleWalletInfo]);

  function copyAddress() {
    if (!wallet) return;
    navigator.clipboard.writeText(wallet.address);
    setCopied(true);
    showToast("Address copied", "success");
    setTimeout(() => setCopied(false), 1500);
  }

  const shortAddr = wallet ? wallet.address.slice(0, 6) + "..." + wallet.address.slice(-4) : "";

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

 if (!wallet && !guestMode && !circlePrimary) {
  return (
    <div style={{ minHeight: "100vh", color: "#111827", position: "relative" }}>
      {sharedStyle}
      <PastelBackground />

      <header style={{ position: "relative", zIndex: 1, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1.5rem 3rem", maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 12, background: "linear-gradient(135deg, #8B7CF9, #6D5EF7)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: "#fff", boxShadow: "0 4px 14px rgba(109,94,247,0.35)" }}>◈</div>
          <div className="flowfi-display" style={{ fontSize: 19, fontWeight: 700, lineHeight: 1.1, color: "#111827" }}>FlowFi</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "6px 14px", borderRadius: 999, border: "1px solid #E5DEFA", fontSize: 11.5, fontWeight: 700, color: "#374151" }}>
            <span className="flowfi-live-dot" style={{ width: 6, height: 6, borderRadius: "50%", background: "#22C55E" }} />
            ARC MAINNET LIVE
          </div>
          <a href="https://github.com/sekuler/flowfi" target="_blank" rel="noopener noreferrer" style={{ color: "#4B5563", fontSize: 14, textDecoration: "none", fontWeight: 600 }}>Explore</a>
        </div>
      </header>

      <div style={{ position: "relative", zIndex: 1, maxWidth: 1200, margin: "0 auto", padding: "3rem 3rem 2rem", display: "flex", alignItems: "center", gap: "3rem", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 460px", minWidth: 320 }}>
          <div style={{ display: "inline-flex", alignItems: "center", padding: "6px 16px", borderRadius: 30, background: "rgba(109,94,247,0.1)", fontSize: 12, fontWeight: 700, color: "#6D5EF7", marginBottom: 24, letterSpacing: "0.4px" }}>
            ON ARC MAINNET
          </div>
          <h1 className="flowfi-display" style={{ fontSize: 52, fontWeight: 800, lineHeight: 1.1, letterSpacing: "-1.5px", marginBottom: 20, color: "#111827" }}>
            Do more with USDC.<br />
            <span style={{ background: "linear-gradient(90deg, #7C3AED, #3B82F6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>All in one flow.</span>
          </h1>
          <p style={{ fontSize: 17, color: "#4B5563", lineHeight: 1.6, maxWidth: 460, marginBottom: 32 }}>
            Send, bridge, and swap your USDC on Arc Mainnet with FlowFi — manage everything from one fast, secure platform. Every transaction signed by your own wallet, never by FlowFi.
          </p>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 14, marginBottom: 28 }}>
            <button onClick={() => setShowConnectModal(true)}
              style={{ padding: "1rem 2rem", borderRadius: 16, border: "none", background: "linear-gradient(90deg, #7C3AED, #3B82F6)", color: "#ffffff", fontSize: 16, fontWeight: 700, boxShadow: "0 8px 24px rgba(109,94,247,0.4)", cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}>
              Connect Wallet <span>→</span>
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <button onClick={() => { setGuestMode(true); setTab("mainnetbridge"); }}
                style={{ background: "none", border: "none", color: "#6D5EF7", fontSize: 14, fontWeight: 600, cursor: "pointer", padding: 0 }}>
                Explore without connecting →
              </button>
              <a href="https://x.com/flowfiarc/status/2078926068485173522" target="_blank" rel="noopener noreferrer"
                style={{ display: "flex", alignItems: "center", gap: 6, color: "#6D5EF7", fontSize: 14, fontWeight: 600, textDecoration: "none" }}>
                <span style={{ fontSize: 11 }}>▶</span> Watch Demo
              </a>
            </div>
          </div>
        </div>

        <div style={{ flex: "1 1 400px", minWidth: 300, display: "flex", justifyContent: "center" }}>
          <img src="/usdc-hero.png" alt="USDC on Arc" style={{ width: "100%", maxWidth: 460, height: "auto" }} />
        </div>
      </div>

      <div style={{ position: "relative", zIndex: 1, maxWidth: 1200, margin: "0 auto", padding: "0 3rem 3.5rem" }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "2.5rem 3rem", paddingTop: 24, borderTop: "1px solid #E5DEFA" }}>
          {[
            { title: "Fast Transactions", sub: "Seconds, not minutes", Icon: Zap },
            { title: "Multi-Route Aggregation", sub: "LI.FI + Circle CCTP V2", Icon: Repeat },
            { title: "Secure & Transparent", sub: "Self-custody, always", Icon: ShieldCheckIcon },
            { title: "Easy to Use", sub: "DeFi for everyone", Icon: Sparkles },
          ].map((f) => (
            <div key={f.title} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: "rgba(109,94,247,0.08)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <f.Icon size={19} color="#6D5EF7" />
              </div>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: "#111827" }}>{f.title}</div>
                <div style={{ fontSize: 12, color: "#6B7280" }}>{f.sub}</div>
              </div>
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

      <footer style={{ position: "relative", zIndex: 1, background: "#F5F3FF", borderTop: "1px solid #E5DEFA", marginTop: 40 }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "3rem 2rem 1.5rem", display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "2.5rem" }}>
          <div style={{ maxWidth: 320 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <div style={{ width: 30, height: 30, borderRadius: 10, background: "linear-gradient(135deg, #8B7CF9, #6D5EF7)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: "#fff" }}>◈</div>
              <span className="flowfi-display" style={{ fontSize: 17, fontWeight: 700, color: "#111827" }}>FlowFi</span>
            </div>
            <p style={{ fontSize: 13.5, color: "#4B5563", lineHeight: 1.6, marginBottom: 16 }}>
              Self-custodial bridging and swapping on Arc Mainnet — routed through LI.FI and Circle's native CCTP V2, with an AI Copilot to guide you. Every transaction signed by your own wallet, never by FlowFi.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <a href="https://x.com/flowfiarc" target="_blank" rel="noopener noreferrer"
                style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(109,94,247,0.1)", border: "1px solid #D4C9FA", display: "flex", alignItems: "center", justifyContent: "center" }} aria-label="X (Twitter)">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="#6D5EF7"><path d="M18.9 2H22l-7.6 8.7L23.3 22h-6.9l-5.4-6.9L4.7 22H1.5l8.2-9.3L1 2h7.1l4.9 6.4L18.9 2zm-1.2 18h1.9L7.4 4H5.4l12.3 16z" /></svg>
              </a>
              <a href="https://github.com/sekuler/flowfi" target="_blank" rel="noopener noreferrer"
                style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(109,94,247,0.1)", border: "1px solid #D4C9FA", display: "flex", alignItems: "center", justifyContent: "center" }} aria-label="GitHub">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="#6D5EF7"><path d="M12 .5C5.73.5.75 5.48.75 11.75c0 5.02 3.26 9.28 7.78 10.78.57.1.78-.25.78-.55 0-.27-.01-1.17-.02-2.12-3.16.69-3.83-1.34-3.83-1.34-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.75 1.18 1.75 1.18 1.02 1.75 2.68 1.24 3.33.95.1-.74.4-1.24.72-1.53-2.52-.29-5.17-1.26-5.17-5.6 0-1.24.44-2.25 1.17-3.04-.12-.29-.51-1.45.11-3.02 0 0 .96-.31 3.14 1.16a10.9 10.9 0 0 1 5.72 0c2.18-1.47 3.14-1.16 3.14-1.16.62 1.57.23 2.73.11 3.02.73.79 1.17 1.8 1.17 3.04 0 4.35-2.65 5.31-5.18 5.59.41.35.77 1.05.77 2.12 0 1.53-.01 2.76-.01 3.14 0 .3.2.66.79.55 4.51-1.51 7.77-5.76 7.77-10.78C23.25 5.48 18.27.5 12 .5z" /></svg>
              </a>
            </div>
          </div>

          <div>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: "#111827", marginBottom: 14 }}>Quick Links</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              {[
                { label: "Live App", href: "#top" },
                { label: "Explorer", href: "https://arc.etherscan.io" },
                { label: "Docs", href: "https://github.com/sekuler/flowfi" },
                { label: "Watch Demo", href: "https://x.com/flowfiarc/status/2078926068485173522" },
              ].map(({ label, href }) => (
                <a key={label} href={href} target="_blank" rel="noopener noreferrer" style={{ fontSize: 14, color: "#4B5563", textDecoration: "none" }}>{label}</a>
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: "#111827", marginBottom: 14 }}>Resources</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              {[
                { label: "Documentation", href: "https://github.com/sekuler/flowfi#readme" },
                { label: "Arc Docs", href: "https://docs.arc.io" },
                { label: "Source Code", href: "https://github.com/sekuler/flowfi" },
              ].map(({ label, href }) => (
                <a key={label} href={href} target="_blank" rel="noopener noreferrer" style={{ fontSize: 14, color: "#4B5563", textDecoration: "none" }}>{label}</a>
              ))}
            </div>
          </div>
        </div>
        <div style={{ borderTop: "1px solid #E5DEFA" }}>
          <div style={{ maxWidth: 1100, margin: "0 auto", padding: "1.1rem 2rem", display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8 }}>
            <span style={{ fontSize: 12.5, color: "#6B7280" }}>© 2026 FlowFi. All rights reserved.</span>
            <span style={{ fontSize: 12.5, color: "#6B7280" }}>Built on Circle & Arc Testnet</span>
          </div>
        </div>
      </footer>
      {showConnectModal && <ConnectModal onClose={() => setShowConnectModal(false)} onConnected={handleConnected} onCircleConnected={handleCircleConnected} />}
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
        width: 220, height: "100vh", background: "rgba(255,255,255,0.98)", backdropFilter: "blur(24px)",
        boxShadow: isMobile ? "0 0 32px rgba(17,24,39,0.2)" : "1px 0 0 rgba(109,94,247,0.08)",
        display: "flex", flexDirection: "column", padding: "1.5rem 0", overflow: "hidden",
        position: isMobile ? "fixed" : "sticky", top: 0, left: isMobile && !mobileMenuOpen ? -240 : 0, zIndex: 4,
        transition: "left 0.2s ease", flexShrink: 0,
      }}>
        <div style={{ padding: "0 1.25rem 1rem", marginBottom: "0.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 11, background: "linear-gradient(135deg, #8B7CF9, #6D5EF7)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: "#fff", boxShadow: "0 4px 14px rgba(109,94,247,0.35)" }}>◈</div>
            <div>
              <div className="flowfi-display" style={{ fontSize: 15, fontWeight: 700, color: "#111827" }}>FlowFi</div>
              {(() => {
                const activeVariant = TAB_GROUPS.find((g) => g.tabs.some((t) => t.id === tab))?.variant ?? "testnet";
                return (
                  <div style={{ fontSize: 9, color: activeVariant === "mainnet" ? "#6D5EF7" : "#6D5EF7", fontWeight: 700, letterSpacing: "2px" }}>
                    {activeVariant === "mainnet" ? "MAINNET" : "TESTNET"}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
        <div style={{ flex: 1, padding: "0 0.75rem", display: "flex", flexDirection: "column", overflowY: "auto" }}>
          {TAB_GROUPS.map(({ group, variant, tabs }, groupIndex) => {
            const prevVariant = groupIndex > 0 ? TAB_GROUPS[groupIndex - 1].variant : undefined;
            const isFirstTestnetGroup = variant === "testnet" && prevVariant !== "testnet";
            return (
            <div key={group} style={{ marginBottom: 4 }}>
              {isFirstTestnetGroup && (
                <div style={{ margin: "0.9rem 1rem 0.5rem", paddingTop: "0.75rem", borderTop: "1px solid #EDE9FE" }}>
                  <div style={{ fontSize: 9.5, color: "#B45309", fontWeight: 800, letterSpacing: "1px" }}>TESTNET — DEMO, NO REAL FUNDS</div>
                </div>
              )}
              <div style={{ display: "inline-block", fontSize: 9, color: "#ffffff", background: variant === "testnet" ? "#D97706" : variant === "mainnet" ? "#6D5EF7" : "#6D5EF7", fontWeight: 800, letterSpacing: "1.5px", padding: "0.3rem 0.6rem", borderRadius: 6, margin: "0.35rem 1rem 0.2rem", opacity: variant === "testnet" ? 0.75 : 1 }}>{group}</div>
              {tabs.map(({ id, label, Icon }) => {
                const active = tab === id;
                const locked = !wallet && (circlePrimary ? !CIRCLE_SAFE_TABS.includes(id) : !GUEST_SAFE_TABS.includes(id));
                const muted = variant === "testnet" && !active;
                return (
                  <button key={id} onClick={() => goToTab(id)}
                    style={{
                      width: "100%", padding: muted ? "0.38rem 1rem" : "0.45rem 1rem", borderRadius: 999, border: "none",
                      background: active ? "linear-gradient(90deg, #ede9fe, #f5f3ff)" : "transparent",
                      color: active ? "#6D5EF7" : locked ? "#B5B0C4" : muted ? "#8B8594" : "#4B5563",
                      fontSize: muted ? 11.5 : 12.5, fontWeight: active ? 700 : 500, cursor: "pointer",
                      display: "flex", alignItems: "center", gap: 9, textAlign: "left",
                      marginBottom: 1,
                    }}>
                    <Icon size={muted ? 13 : 15} strokeWidth={2} />
                    <span style={{ flex: 1 }}>{label}</span>
                    {locked && <Lock size={11} />}
                  </button>
                );
              })}
            </div>
            );
          })}
        </div>
        <div style={{ padding: "0.5rem 1.25rem", marginTop: "auto" }}>
          {wallet ? (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
                  <div className="flowfi-mono" style={{ fontSize: 12, color: "#374151" }}>{nickname || shortAddr}</div>
                  <button onClick={copyAddress} title="Copy address"
                    style={{ background: "none", border: "none", cursor: "pointer", padding: 1, color: copied ? "#22C55E" : "#9CA3AF", display: "flex", flexShrink: 0 }}>
                    {copied ? <Check size={11} /> : <Copy size={11} />}
                  </button>
                </div>
                <button onClick={() => {
                  const next = window.prompt("Set a local nickname (only visible to you, this browser only):", nickname ?? "");
                  if (next === null) return;
                  if (next.trim()) { setNicknameState(next.trim()); saveNickname(next.trim()); }
                  else { setNicknameState(null); clearNickname(); }
                }} title="Set a local nickname" style={{ background: "none", border: "none", color: "#9CA3AF", cursor: "pointer", fontSize: 9, fontWeight: 700, flexShrink: 0 }}>
                  {nickname ? "edit" : "+nick"}
                </button>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <Sparkles size={10} color="#6D5EF7" />
                  <span className="flowfi-mono" style={{ fontSize: 10, fontWeight: 700, color: "#6D5EF7" }}>{points} pts</span>
                </div>
                <button onClick={() => { localStorage.removeItem("flowfi-last-wallet-rdns"); setWallet(null); }} style={{ fontSize: 10, color: "#9CA3AF", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Disconnect</button>
              </div>
            </>
          ) : circlePrimary && circleWalletInfo ? (
            <>
              <div style={{ fontSize: 10, color: "#8B7CF9", fontWeight: 700, letterSpacing: "1px", marginBottom: 4 }}>CIRCLE WALLET</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div className="flowfi-mono" style={{ fontSize: 13, color: "#374151" }}>{circleWalletInfo.address.slice(0, 6)}...{circleWalletInfo.address.slice(-4)}</div>
              </div>
              <div style={{ fontSize: 11, color: "#6B7280", marginTop: 2, marginBottom: 8 }}>No seed phrase — some features need a Browser Wallet</div>
              <button onClick={() => setShowConnectModal(true)} style={{ fontSize: 11, color: "#6D5EF7", background: "rgba(109,94,247,0.08)", border: "none", borderRadius: 999, padding: "5px 12px", cursor: "pointer", width: "100%" }}>Add Browser Wallet</button>
              <button onClick={() => { setCirclePrimary(false); forgetCircleWallet(); setTab("home"); }} style={{ marginTop: 6, fontSize: 11, color: "#9CA3AF", background: "none", border: "none", cursor: "pointer", width: "100%" }}>Disconnect</button>
            </>
          ) : (
            <>
              <div style={{ fontSize: 10, color: "#8B7CF9", fontWeight: 700, letterSpacing: "1px", marginBottom: 4 }}>GUEST MODE</div>
              <p style={{ fontSize: 11.5, color: "#6B7280", margin: "0 0 10px 0", lineHeight: 1.5 }}>Browsing read-only. Connect a wallet to swap, bridge, and manage your own funds.</p>
              <button onClick={() => setShowConnectModal(true)} style={{ fontSize: 12, color: "#fff", background: "#6D5EF7", border: "none", borderRadius: 999, padding: "7px 12px", cursor: "pointer", width: "100%", fontWeight: 700 }}>Connect Wallet</button>
            </>
          )}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 10px", padding: "0.6rem 0.9rem 0", justifyContent: "center" }}>
          {[
            { label: "Terms", file: "TERMS.md" },
            { label: "Privacy", file: "PRIVACY.md" },
            { label: "Risk", file: "RISK.md" },
            { label: "Security", file: "SECURITY.md" },
          ].map((doc) => (
            <a key={doc.file} href={`https://github.com/sekuler/flowfi/blob/main/${doc.file}`} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 9.5, color: "#9CA3AF", textDecoration: "none" }}>
              {doc.label}
            </a>
          ))}
        </div>
      </aside>

      <main style={{ flex: 1, minHeight: "100vh", position: "relative", zIndex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{ flex: 1 }}>
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
        {tab !== "pools" && tab !== "history" && <MarketTicker />}
        <header style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, padding: isMobile ? "0.85rem 1rem" : "1rem 1.75rem" }}>
          <NotificationCenter />
          <button disabled title="Coming soon"
            style={{ position: "relative", background: "rgba(109,94,247,0.08)", border: "none", borderRadius: 10, width: 32, height: 32, cursor: "not-allowed", display: "flex", alignItems: "center", justifyContent: "center", color: "#6D5EF7" }}>
            <Moon size={15} />
            <span style={{ position: "absolute", top: -7, right: -9, fontSize: 7, fontWeight: 800, background: "linear-gradient(135deg, #f59e0b, #f97316)", color: "#fff", padding: "2px 4px", borderRadius: 6, boxShadow: "0 0 8px rgba(245,158,11,0.5)" }}>SOON</span>
          </button>
          <div style={{ width: 1, height: 18, background: "rgba(109,94,247,0.12)" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 10px", borderRadius: 999, background: (TAB_GROUPS.find((g) => g.tabs.some((t) => t.id === tab))?.variant ?? "testnet") === "mainnet" ? "rgba(109,94,247,0.1)" : "rgba(34,197,94,0.1)" }}>
            <span className="flowfi-live-dot" style={{ width: 6, height: 6, borderRadius: "50%", background: (TAB_GROUPS.find((g) => g.tabs.some((t) => t.id === tab))?.variant ?? "testnet") === "mainnet" ? "#6D5EF7" : "#22C55E" }} />
            <span style={{ fontSize: 11, fontWeight: 800, color: (TAB_GROUPS.find((g) => g.tabs.some((t) => t.id === tab))?.variant ?? "testnet") === "mainnet" ? "#6D5EF7" : "#16A34A" }}>
              {(TAB_GROUPS.find((g) => g.tabs.some((t) => t.id === tab))?.variant ?? "testnet") === "mainnet" ? "Arc Mainnet" : "Arc Testnet"}
            </span>
          </div>
          {wallet ? (
            <>
              <a href={`${(TAB_GROUPS.find((g) => g.tabs.some((t) => t.id === tab))?.variant ?? "testnet") === "mainnet" ? "https://arc.etherscan.io" : "https://testnet.arcscan.app"}/address/${wallet.address}`} target="_blank" rel="noopener noreferrer"
                className="flowfi-mono"
                style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 10px", borderRadius: 999, background: "rgba(109,94,247,0.1)", color: "#6D5EF7", fontSize: 11, fontWeight: 700, textDecoration: "none" }}>
                {shortAddr}
              </a>
              <button onClick={() => { localStorage.removeItem("flowfi-last-wallet-rdns"); setWallet(null); }} title="Disconnect wallet"
                style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, borderRadius: 10, border: "none", background: "rgba(239,68,68,0.1)", color: "#EF4444", cursor: "pointer" }}>
                <Power size={14} />
              </button>
            </>
          ) : circlePrimary && circleWalletInfo ? (
            <>
              <a href={`https://testnet.arcscan.app/address/${circleWalletInfo.address}`} target="_blank" rel="noopener noreferrer"
                className="flowfi-mono"
                style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 10px", borderRadius: 999, background: "rgba(109,94,247,0.1)", color: "#6D5EF7", fontSize: 11, fontWeight: 700, textDecoration: "none" }}>
                {circleWalletInfo.address.slice(0, 6)}...{circleWalletInfo.address.slice(-4)}
              </a>
              <button onClick={() => { setCirclePrimary(false); forgetCircleWallet(); setTab("home"); }} title="Disconnect"
                style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, borderRadius: 10, border: "none", background: "rgba(239,68,68,0.1)", color: "#EF4444", cursor: "pointer" }}>
                <Power size={14} />
              </button>
            </>
          ) : (
            <button onClick={() => setShowConnectModal(true)}
              style={{ padding: "8px 16px", borderRadius: 999, border: "none", background: "#6D5EF7", color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
              Connect Wallet
            </button>
          )}
        </header>

        <div style={{ padding: isMobile ? "1rem" : "2.5rem" }}>
          <div key={tab} className="flowfi-page" style={{ maxWidth: isMobile ? "100%" : (tab === "home" || tab === "bridge" ? 1200 : tab === "pools" || tab === "swap" || tab === "dashboard" || tab === "dashboardmainnet" || tab === "mainnetswap" ? 900 : 520), margin: "0 auto" }}>
            <div style={{ marginBottom: "2rem" }}>
              <h1 className="flowfi-display" style={{ fontSize: 28, fontWeight: 800, color: "#111827", marginBottom: 4, letterSpacing: "-0.5px" }}>
                {tab === "home" ? "Home" : tab === "dashboard" ? "Dashboard" : tab === "dashboardmainnet" ? "Dashboard" : tab === "analytics" ? "Stablecoin Analytics" : tab === "swap" ? "Swap" : tab === "mainnetswap" ? "Swap" : tab === "pools" ? "Liquidity Pools" : tab === "launch" ? "Launch Token" : tab === "history" ? "History" : tab === "circlewallet" ? "Circle Wallet" : "Bridge"}
              </h1>
              <p style={{ fontSize: 13, color: "#6B7280" }}>
               {tab === "home" ? "Your Arc Mainnet overview" : tab === "dashboard" ? "Asset allocation and activity broken down by type" : tab === "dashboardmainnet" ? "Arc Mainnet balances and activity" : tab === "analytics" ? "Platform-wide stablecoin TVL and distribution" : tab === "swap" ? "Swap USDC and EURC instantly" : tab === "mainnetswap" ? "Swap tokens on Arc instantly — real funds, real fees" : tab === "pools" ? "Add or remove liquidity in any FlowFi-curated pool" : tab === "launch" ? "Deploy your own ERC20 token on Arc" : tab === "history" ? "Recent transactions on Arc Testnet" : tab === "circlewallet" ? "Create a wallet without a seed phrase" : "Move USDC across chains — one-off bridge or instant Gateway transfer"}
              </p>
            </div>
{tab === "home" && wallet && <CopilotHomeMainnet address={wallet.address} balances={mainnetBalances} onNavigate={(t) => setTab(t)} provider={wallet.provider} />}

            {tab === "mainnetbridge" && <MainnetBridge address={wallet?.address} provider={wallet?.provider} />}
            {tab === "mainnetswap" && <MainnetSwap provider={wallet?.provider} />}
            {tab === "dashboard" && wallet && <Dashboard address={wallet.address} balances={balances} />}
            {tab === "dashboardmainnet" && wallet && <DashboardMainnet address={wallet.address} balances={mainnetBalances} provider={wallet.provider} />}
            {tab === "analytics" && <StablecoinAnalytics onNavigate={(t) => setTab(t)} />}
            {tab === "history" && (wallet || (circlePrimary && circleWalletInfo)) && <TxHistory address={wallet ? wallet.address : circleWalletInfo!.address} />}
            {tab === "bridge" && (wallet || (circlePrimary && circleWalletInfo)) && (
              <TransferHub
                provider={wallet ? wallet.provider : GUEST_PROVIDER}
                address={wallet ? wallet.address : circleWalletInfo!.address}
                walletName={wallet ? wallet.walletName : "Circle Wallet"}
                onNavigate={(t) => setTab(t)}
              />
            )}
            {tab === "swap" && (wallet || (circlePrimary && circleWalletInfo)) && (
              <SwapForm
                provider={wallet ? wallet.provider : GUEST_PROVIDER}
                address={wallet ? wallet.address : circleWalletInfo!.address}
                balances={balances}
                onRefresh={() => loadBalances(wallet ? wallet.address : circleWalletInfo!.address)}
              />
            )}
            {tab === "circlewallet" && <CircleWallet />}
            {tab === "pools" && (
              <LiquidityPools
                provider={wallet ? wallet.provider : GUEST_PROVIDER}
                address={wallet ? wallet.address : (circlePrimary && circleWalletInfo ? circleWalletInfo.address : GUEST_ADDRESS)}
                balances={wallet ? balances : { usdc: null, eurc: null, usyc: null, native: null }}
                onRefresh={() => wallet && loadBalances(wallet.address)}
              />
            )}
          {tab === "launch" && wallet && <TokenLaunch provider={wallet.provider} address={wallet.address} />}
          </div>
        </div>
        </div>

        {tab !== "pools" && tab !== "history" && (
        <footer style={{ background: "#F5F3FF", borderTop: "1px solid #E5DEFA" }}>
          <div style={{ maxWidth: 1100, margin: "0 auto", padding: "3rem 2rem 1.5rem", display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "2.5rem" }}>
            <div style={{ maxWidth: 320 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <div style={{ width: 30, height: 30, borderRadius: 10, background: "linear-gradient(135deg, #8B7CF9, #6D5EF7)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: "#fff" }}>◈</div>
                <span className="flowfi-display" style={{ fontSize: 17, fontWeight: 700, color: "#111827" }}>FlowFi</span>
              </div>
              <p style={{ fontSize: 13.5, color: "#4B5563", lineHeight: 1.6, marginBottom: 16 }}>
                An AI-powered DeFi platform built on Arc Testnet, Circle's stablecoin-native Layer-1. Swap, bridge, and provide liquidity through one intelligent Copilot.
              </p>
              <div style={{ display: "flex", gap: 10 }}>
                <a href="https://x.com/flowfiarc" target="_blank" rel="noopener noreferrer"
                  style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(109,94,247,0.1)", border: "1px solid #D4C9FA", display: "flex", alignItems: "center", justifyContent: "center" }} aria-label="X (Twitter)">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="#6D5EF7"><path d="M18.9 2H22l-7.6 8.7L23.3 22h-6.9l-5.4-6.9L4.7 22H1.5l8.2-9.3L1 2h7.1l4.9 6.4L18.9 2zm-1.2 18h1.9L7.4 4H5.4l12.3 16z" /></svg>
                </a>
                <a href="https://github.com/sekuler/flowfi" target="_blank" rel="noopener noreferrer"
                  style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(109,94,247,0.1)", border: "1px solid #D4C9FA", display: "flex", alignItems: "center", justifyContent: "center" }} aria-label="GitHub">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="#6D5EF7"><path d="M12 .5C5.73.5.75 5.48.75 11.75c0 5.02 3.26 9.28 7.78 10.78.57.1.78-.25.78-.55 0-.27-.01-1.17-.02-2.12-3.16.69-3.83-1.34-3.83-1.34-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.75 1.18 1.75 1.18 1.02 1.75 2.68 1.24 3.33.95.1-.74.4-1.24.72-1.53-2.52-.29-5.17-1.26-5.17-5.6 0-1.24.44-2.25 1.17-3.04-.12-.29-.51-1.45.11-3.02 0 0 .96-.31 3.14 1.16a10.9 10.9 0 0 1 5.72 0c2.18-1.47 3.14-1.16 3.14-1.16.62 1.57.23 2.73.11 3.02.73.79 1.17 1.8 1.17 3.04 0 4.35-2.65 5.31-5.18 5.59.41.35.77 1.05.77 2.12 0 1.53-.01 2.76-.01 3.14 0 .3.2.66.79.55 4.51-1.51 7.77-5.76 7.77-10.78C23.25 5.48 18.27.5 12 .5z" /></svg>
                </a>
              </div>
            </div>

            <div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: "#111827", marginBottom: 14 }}>Quick Links</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                <button onClick={() => setTab("swap")} style={{ background: "none", border: "none", padding: 0, textAlign: "left", fontSize: 14, color: "#4B5563", cursor: "pointer" }}>Swap</button>
                <button onClick={() => setTab("bridge")} style={{ background: "none", border: "none", padding: 0, textAlign: "left", fontSize: 14, color: "#4B5563", cursor: "pointer" }}>Bridge</button>
                <button onClick={() => setTab("pools")} style={{ background: "none", border: "none", padding: 0, textAlign: "left", fontSize: 14, color: "#4B5563", cursor: "pointer" }}>Liquidity Pools</button>
                <a href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer" style={{ fontSize: 14, color: "#4B5563", textDecoration: "none" }}>Faucet</a>
              </div>
            </div>

            <div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: "#111827", marginBottom: 14 }}>Resources</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                <a href="https://github.com/sekuler/flowfi#readme" target="_blank" rel="noopener noreferrer" style={{ fontSize: 14, color: "#4B5563", textDecoration: "none" }}>Documentation</a>
                <a href="https://testnet.arcscan.app" target="_blank" rel="noopener noreferrer" style={{ fontSize: 14, color: "#4B5563", textDecoration: "none" }}>Block Explorer</a>
                <a href="https://github.com/sekuler/flowfi" target="_blank" rel="noopener noreferrer" style={{ fontSize: 14, color: "#4B5563", textDecoration: "none" }}>Source Code</a>
              </div>
            </div>
          </div>
          <div style={{ borderTop: "1px solid #E5DEFA" }}>
            <div style={{ maxWidth: 1100, margin: "0 auto", padding: "1.1rem 2rem", display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontSize: 12.5, color: "#6B7280" }}>© 2026 FlowFi. All rights reserved.</span>
              <span style={{ fontSize: 12.5, color: "#6B7280" }}>Built on Circle & Arc Testnet</span>
            </div>
          </div>
        </footer>
        )}
      </main>

      {wallet && (tab === "mainnetbridge" || tab === "mainnetswap" || tab === "dashboardmainnet") ? (
        <AiCopilotMainnet onNavigate={(t) => setTab(t)} />
      ) : (
        wallet && <AiCopilot provider={wallet.provider} address={wallet.address} balances={balances} onRefresh={() => loadBalances(wallet.address)} onNavigate={(t) => setTab(t)} />
      )}
      {showOnboarding && <OnboardingModal onClose={() => setShowOnboarding(false)} />}
      {showConnectModal && <ConnectModal onClose={() => setShowConnectModal(false)} onConnected={handleConnected} onCircleConnected={handleCircleConnected} />}
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppErrorBoundary>
        <AppInner />
      </AppErrorBoundary>
    </QueryClientProvider>
  );
}
