import { useState, useEffect } from "react";
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

type Tab = "portfolio" | "send" | "receive" | "swap" | "dashboard" | "history" | "bridge" | "circlewallet";

const ARC_USDC = "0x3600000000000000000000000000000000000000" as `0x${string}`;
const ARC_EURC = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" as `0x${string}`;
const ARC_USYC = "0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C" as `0x${string}`;

const TABS: { id: Tab; label: string; emoji: string }[] = [
  { id: "portfolio", label: "Portfolio", emoji: "◈" },
  { id: "send",      label: "Send",      emoji: "↗" },
  { id: "bridge",    label: "Bridge",    emoji: "⬡" },
  { id: "swap",      label: "Swap",      emoji: "⇄" },
  { id: "receive",   label: "Receive",   emoji: "↙" },
  { id: "circlewallet", label: "Circle Wallet", emoji: "◎" },
  { id: "dashboard", label: "Dashboard", emoji: "▤" },
  { id: "history",   label: "History",   emoji: "↺" },
];

function timeAgo(sec: number) {
  const diff = Math.floor(Date.now() / 1000) - sec;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function App() {
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [tab, setTab] = useState<Tab>("portfolio");
  const [balances, setBalances] = useState<Balances>({ usdc: null, eurc: null, usyc: null, native: null });
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [recentTxs, setRecentTxs] = useState<RecentTx[]>([]);
  const [eurUsdRate, setEurUsdRate] = useState<number | null>(null);

  function handleConnected(provider: EIP1193Provider, address: string, walletName: string) {
    setWallet({ provider, address, walletName });
    setTab("portfolio");
  }

  async function loadBalances(address: string) {
    try {
      const client = createPublicClient({ chain: arcTestnet, transport: http() });
      const usdc = await client.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: "balanceOf", args: [address as `0x${string}`] }).catch(() => 0n);
      await new Promise(r => setTimeout(r, 1500));
      const eurc = await client.readContract({ address: ARC_EURC, abi: erc20Abi, functionName: "balanceOf", args: [address as `0x${string}`] }).catch(() => 0n);
      await new Promise(r => setTimeout(r, 1500));
      const usyc = await client.readContract({ address: ARC_USYC, abi: erc20Abi, functionName: "balanceOf", args: [address as `0x${string}`] }).catch(() => 0n);
      await new Promise(r => setTimeout(r, 1500));
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
    setTimeout(() => setCopied(false), 1500);
  }

  const shortAddr = wallet ? wallet.address.slice(0, 6) + "..." + wallet.address.slice(-4) : "";

  const TOKEN_META: Record<string, { icon: string; color: string; bg: string }> = {
    USDC: { icon: "$", color: "#2563eb", bg: "rgba(37,99,235,0.08)" },
    EURC: { icon: "€", color: "#7c3aed", bg: "rgba(124,58,237,0.08)" },
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

  if (!wallet) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "linear-gradient(180deg, #0a1a2f 0%, #0d2847 100%)", padding: "2rem", fontFamily: "'Inter', system-ui, sans-serif" }}>
        <div style={{ position: "fixed", top: "20%", left: "30%", width: 600, height: 600, background: "radial-gradient(circle, rgba(79,70,229,0.08) 0%, transparent 70%)", pointerEvents: "none" }} />
        <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "2.5rem", maxWidth: 480, width: "100%" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: "linear-gradient(135deg, #4f46e5, #7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, boxShadow: "0 0 40px rgba(79,70,229,0.3)" }}>◈</div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: "#f8fafc", letterSpacing: "-0.5px" }}>FlowFi</div>
              <div style={{ fontSize: 11, color: "#4f46e5", fontWeight: 700, letterSpacing: "3px", marginTop: 2 }}>TESTNET</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
            {[
              { label: "Portfolio", color: "#6366f1" },
              { label: "Send", color: "#10b981" },
              { label: "Swap", color: "#8b5cf6" },
              { label: "Bridge", color: "#3b82f6" },
            ].map(({ label, color }) => (
              <div key={label} style={{ padding: "4px 12px", borderRadius: 20, fontSize: 12, color, background: `${color}18`, border: `1px solid ${color}30`, fontWeight: 600 }}>{label}</div>
            ))}
          </div>
          <WalletConnect onConnected={handleConnected} />
          <div style={{ display: "flex", gap: 20 }}>
            {[
              { label: "Faucet", href: "https://faucet.circle.com" },
              { label: "Explorer", href: "https://testnet.arcscan.app" },
              { label: "Docs", href: "https://docs.arc.io" },
            ].map(({ label, href }) => (
              <a key={label} href={href} target="_blank" rel="noopener noreferrer" style={{ color: "#334155", fontSize: 12, textDecoration: "none" }}>{label}</a>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", background: "linear-gradient(180deg, #0a1a2f 0%, #0d2847 100%)", fontFamily: "'Inter', system-ui, sans-serif", color: "#f8fafc" }}>
      <aside style={{ width: 220, minHeight: "100vh", background: "#0a1a2f", borderRight: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", padding: "1.5rem 0", position: "fixed", top: 0, left: 0 }}>
        <div style={{ padding: "0 1.25rem 1.5rem", borderBottom: "1px solid rgba(255,255,255,0.06)", marginBottom: "1rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: "linear-gradient(135deg, #4f46e5, #7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>◈</div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#f8fafc" }}>FlowFi</div>
              <div style={{ fontSize: 9, color: "#4f46e5", fontWeight: 700, letterSpacing: "2px" }}>TESTNET</div>
            </div>
          </div>
        </div>
        <nav style={{ flex: 1, padding: "0 0.75rem", display: "flex", flexDirection: "column", gap: 2, overflowY: "auto" }}>
          {TABS.map(({ id, label, emoji }) => {
            const active = tab === id;
            return (
              <button key={id} onClick={() => setTab(id)}
                style={{ width: "100%", padding: "0.65rem 1rem", borderRadius: 10, border: "none", background: active ? "rgba(79,70,229,0.15)" : "transparent", color: active ? "#a5b4fc" : "#64748b", fontSize: 13, fontWeight: active ? 700 : 500, cursor: "pointer", display: "flex", alignItems: "center", gap: 10, textAlign: "left", borderLeft: active ? "2px solid #4f46e5" : "2px solid transparent" }}>
                <span style={{ fontSize: 16 }}>{emoji}</span>
                <span>{label}</span>
              </button>
            );
          })}
        </nav>
        <div style={{ padding: "1rem 1.25rem", borderTop: "1px solid rgba(255,255,255,0.06)", marginTop: "auto" }}>
          <div style={{ fontSize: 10, color: "#334155", marginBottom: 4, fontWeight: 600, letterSpacing: "1px" }}>CONNECTED</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ fontSize: 13, color: "#475569", fontFamily: "monospace" }}>{shortAddr}</div>
            <button onClick={copyAddress} title="Copy address"
              style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: copied ? "#6ee7b7" : "#475569", fontSize: 12 }}>
              {copied ? "✓" : "⧉"}
            </button>
          </div>
          <div style={{ fontSize: 11, color: "#1e293b", marginTop: 2 }}>{wallet.walletName}</div>
          <button onClick={() => setWallet(null)} style={{ marginTop: 10, fontSize: 11, color: "#334155", background: "none", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 6, padding: "4px 10px", cursor: "pointer", width: "100%" }}>Disconnect</button>
        </div>
        <div style={{ padding: "0.75rem 1.25rem", display: "flex", flexDirection: "column", gap: 6 }}>
          {[
            { label: "arc.io", href: "https://www.arc.io", color: "#818cf8" },
            { label: "Explorer", href: "https://testnet.arcscan.app", color: "#60a5fa" },
            { label: "Faucet", href: "https://faucet.circle.com", color: "#6ee7b7" },
          ].map(({ label, href, color }) => (
            <a key={label} href={href} target="_blank" rel="noopener noreferrer" style={{ color, fontSize: 12, fontWeight: 600, textDecoration: "none" }}>{label} ↗</a>
          ))}
        </div>
      </aside>

      <main style={{ marginLeft: 220, flex: 1, padding: "2.5rem", minHeight: "100vh" }}>
        <div style={{ position: "relative", zIndex: 1, maxWidth: 520, margin: "0 auto" }}>
          <div style={{ marginBottom: "2rem" }}>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: "#f8fafc", marginBottom: 4, letterSpacing: "-0.5px" }}>
              {tab === "portfolio" ? "Portfolio" : tab === "dashboard" ? "Dashboard" : tab === "send" ? "Send" : tab === "receive" ? "Receive" : tab === "swap" ? "Swap" : tab === "history" ? "History" : tab === "circlewallet" ? "Circle Wallet" : "Bridge"}
            </h1>
            <p style={{ fontSize: 13, color: "#334155" }}>
              {tab === "portfolio" ? "Arc Testnet balances" : tab === "dashboard" ? "Portfolio analytics and activity" : tab === "send" ? "Send USDC or EURC on Arc" : tab === "receive" ? "Share your address or QR code to receive funds" : tab === "swap" ? "Swap USDC and EURC instantly" : tab === "history" ? "Recent transactions on Arc Testnet" : tab === "circlewallet" ? "Create a wallet without a seed phrase" : "Bridge USDC to Arc via CCTP"}
            </p>
          </div>

          {tab === "portfolio" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem" }}>
                {(["USDC", "EURC", "USYC"] as const).map((label) => {
                  const value = label === "USDC" ? balances.usdc : label === "EURC" ? balances.eurc : balances.usyc;
                  const meta = TOKEN_META[label];
                  const usd = usdEquivalent(label, value);
                  return (
                    <div key={label} style={{ background: meta.bg, border: `1px solid ${meta.color}20`, borderRadius: 14, padding: "1.25rem" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                        <div style={{ width: 20, height: 20, borderRadius: "50%", background: meta.color, color: "#fff", fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{meta.icon}</div>
                        <div style={{ fontSize: 11, color: "#475569", fontWeight: 600, letterSpacing: "1px" }}>{label}</div>
                      </div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: meta.color }}>{value === null ? "..." : value}</div>
                      <div style={{ fontSize: 11, color: "#334155", marginTop: 4 }}>{usd ?? "Arc Testnet"}</div>
                    </div>
                  );
                })}
              </div>

              <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: "1rem 1.25rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 11, color: "#334155", fontWeight: 600, letterSpacing: "1px", marginBottom: 2 }}>ARC</div>
                  <div style={{ fontSize: 13, color: "#475569" }}>Gas Balance</div>
                </div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#64748b" }}>{balances.native === null ? "..." : `${balances.native} ARC`}</div>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <button onClick={() => loadBalances(wallet.address)} style={{ background: "none", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "0.5rem 1rem", color: "#334155", fontSize: 12, cursor: "pointer" }}>
                  ↻ Refresh
                </button>
                {lastUpdated && (
                  <span style={{ fontSize: 11, color: "#1e293b" }}>Updated {timeAgo(lastUpdated)}</span>
                )}
              </div>

              <div>
                <div style={{ fontSize: 11, color: "#1e293b", fontWeight: 600, letterSpacing: "1px", marginBottom: 10 }}>QUICK ACTIONS</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setTab("send")} style={{ flex: 1, padding: "0.75rem", borderRadius: 10, border: "1px solid rgba(16,185,129,0.2)", background: "rgba(16,185,129,0.06)", color: "#10b981", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>↗ Send</button>
                  <button onClick={() => setTab("receive")} style={{ flex: 1, padding: "0.75rem", borderRadius: 10, border: "1px solid rgba(79,70,229,0.2)", background: "rgba(79,70,229,0.06)", color: "#818cf8", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>↙ Receive</button>
                  <button onClick={() => setTab("swap")} style={{ flex: 1, padding: "0.75rem", borderRadius: 10, border: "1px solid rgba(139,92,246,0.2)", background: "rgba(139,92,246,0.06)", color: "#8b5cf6", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>⇄ Swap</button>
                </div>
              </div>

              <UnifiedBalance address={wallet.address} />

              {recentTxs.length > 0 && (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <span style={{ fontSize: 11, color: "#1e293b", fontWeight: 600, letterSpacing: "1px" }}>RECENT ACTIVITY</span>
                    <button onClick={() => setTab("history")} style={{ background: "none", border: "none", color: "#4f46e5", fontSize: 11, cursor: "pointer" }}>View all →</button>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {recentTxs.map((tx) => (
                      <a key={tx.hash} href={`https://testnet.arcscan.app/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer"
                        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.65rem 0.9rem", borderRadius: 10, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", textDecoration: "none" }}>
                        <span style={{ fontSize: 12, color: "#94a3b8" }}>{tx.method}</span>
                        <span style={{ fontSize: 11, color: "#334155" }}>{tx.age}</span>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              <a href={`https://testnet.arcscan.app/address/${wallet.address}`} target="_blank" rel="noopener noreferrer"
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.875rem 1rem", borderRadius: 10, border: "1px solid rgba(79,70,229,0.25)", background: "rgba(79,70,229,0.06)", color: "#818cf8", textDecoration: "none", fontSize: 13, fontWeight: 600 }}>
                <span>View on Explorer ↗</span>
                <span style={{ fontFamily: "monospace", fontSize: 11, color: "#4f46e5" }}>{shortAddr}</span>
              </a>
            </div>
          )}

          {tab === "dashboard" && <Dashboard address={wallet.address} balances={balances} />}
          {tab === "history" && <TxHistory address={wallet.address} />}
          {tab === "receive" && <ReceiveQR address={wallet.address} />}
          {tab === "bridge" && <BridgeForm provider={wallet.provider} address={wallet.address} walletName={wallet.walletName} />}
          {tab === "swap" && <SwapForm provider={wallet.provider} address={wallet.address} balances={balances} onRefresh={() => loadBalances(wallet.address)} />}
          {tab === "send" && <SendForm provider={wallet.provider} address={wallet.address} balances={balances} onRefresh={() => loadBalances(wallet.address)} />}
          {tab === "circlewallet" && <CircleWallet />}
        </div>
      </main>
    </div>
  );
}