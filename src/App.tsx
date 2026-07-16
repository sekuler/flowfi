import { useState, useEffect } from "react";
import type { EIP1193Provider } from "viem";
import { createPublicClient, http, erc20Abi, formatUnits } from "viem";
import { arcTestnet } from "./chains";
import WalletConnect from "./components/WalletConnect";
import BridgeForm from "./components/BridgeForm";
import SwapForm from "./components/SwapForm";
import SendForm from "./components/SendForm";

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

type Tab = "portfolio" | "bridge" | "swap" | "send";

const KIT_KEY = (import.meta as unknown as { env: Record<string, string> }).env?.VITE_KIT_KEY ?? "";
const ARC_USDC = "0x3600000000000000000000000000000000000000" as `0x${string}`;
const ARC_EURC = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" as `0x${string}`;
const ARC_USYC = "0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C" as `0x${string}`;

const TABS: { id: Tab; label: string; emoji: string }[] = [
  { id: "portfolio", label: "Portfolio", emoji: "◈" },
  { id: "send",      label: "Send",      emoji: "↗" },
  { id: "swap",      label: "Swap",      emoji: "⇄" },
  { id: "bridge",    label: "Bridge",    emoji: "⬡" },
];

export default function App() {
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [tab, setTab] = useState<Tab>("portfolio");
  const [balances, setBalances] = useState<Balances>({ usdc: null, eurc: null, usyc: null, native: null });

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
    } catch {
      setBalances({ usdc: "—", eurc: "—", usyc: "—", native: "—" });
    }
  }

  useEffect(() => {
    if (wallet) loadBalances(wallet.address);
  }, [wallet]);

  const shortAddr = wallet ? wallet.address.slice(0, 6) + "..." + wallet.address.slice(-4) : "";

  if (!wallet) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#080b14", padding: "2rem", fontFamily: "'Inter', system-ui, sans-serif" }}>
        <div style={{ position: "fixed", top: "20%", left: "30%", width: 600, height: 600, background: "radial-gradient(circle, rgba(79,70,229,0.08) 0%, transparent 70%)", pointerEvents: "none" }} />
        <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "2.5rem", maxWidth: 480, width: "100%" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: "linear-gradient(135deg, #4f46e5, #7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, boxShadow: "0 0 40px rgba(79,70,229,0.3)" }}>◈</div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: "#f8fafc", letterSpacing: "-0.5px" }}>Arc DeFi</div>
              <div style={{ fontSize: 11, color: "#4f46e5", fontWeight: 700, letterSpacing: "3px", marginTop: 2 }}>TESTNET</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
            {[
              { label: "Portfolio", color: "#6366f1" },
              { label: "Send USDC · EURC", color: "#10b981" },
              { label: "Swap via Arfi", color: "#8b5cf6" },
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
    <div style={{ minHeight: "100vh", display: "flex", background: "#080b14", fontFamily: "'Inter', system-ui, sans-serif", color: "#f8fafc" }}>
      <aside style={{ width: 220, minHeight: "100vh", background: "#0c0f1d", borderRight: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", padding: "1.5rem 0", position: "fixed", top: 0, left: 0 }}>
        <div style={{ padding: "0 1.25rem 1.5rem", borderBottom: "1px solid rgba(255,255,255,0.06)", marginBottom: "1rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: "linear-gradient(135deg, #4f46e5, #7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>◈</div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#f8fafc" }}>Arc DeFi</div>
              <div style={{ fontSize: 9, color: "#4f46e5", fontWeight: 700, letterSpacing: "2px" }}>TESTNET</div>
            </div>
          </div>
        </div>
        <nav style={{ flex: 1, padding: "0 0.75rem", display: "flex", flexDirection: "column", gap: 2 }}>
          {TABS.map(({ id, label, emoji }) => {
            const active = tab === id;
            const disabled = id === "bridge";
            return (
              <button key={id} onClick={() => !disabled && setTab(id)}
                style={{ width: "100%", padding: "0.65rem 1rem", borderRadius: 10, border: "none", background: active ? "rgba(79,70,229,0.15)" : "transparent", color: active ? "#a5b4fc" : disabled ? "#1e293b" : "#64748b", fontSize: 14, fontWeight: active ? 700 : 500, cursor: disabled ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 10, textAlign: "left", borderLeft: active ? "2px solid #4f46e5" : "2px solid transparent" }}>
                <span style={{ fontSize: 16 }}>{emoji}</span>
                <span>{label}</span>
                {disabled && <span style={{ marginLeft: "auto", fontSize: 10, color: "#1e3a5f", background: "rgba(59,130,246,0.1)", padding: "2px 6px", borderRadius: 4, fontWeight: 600 }}>SOON</span>}
              </button>
            );
          })}
        </nav>
        <div style={{ padding: "1rem 1.25rem", borderTop: "1px solid rgba(255,255,255,0.06)", marginTop: "auto" }}>
          <div style={{ fontSize: 10, color: "#334155", marginBottom: 4, fontWeight: 600, letterSpacing: "1px" }}>CONNECTED</div>
          <div style={{ fontSize: 13, color: "#475569", fontFamily: "monospace" }}>{shortAddr}</div>
          <div style={{ fontSize: 11, color: "#1e293b", marginTop: 2 }}>{wallet.walletName}</div>
          <button onClick={() => setWallet(null)} style={{ marginTop: 10, fontSize: 11, color: "#334155", background: "none", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 6, padding: "4px 10px", cursor: "pointer", width: "100%" }}>Disconnect</button>
        </div>
        <div style={{ padding: "0.75rem 1.25rem", display: "flex", flexDirection: "column", gap: 6 }}>
          {[{ label: "arc.io", href: "https://www.arc.io" }, { label: "Explorer", href: "https://testnet.arcscan.app" }, { label: "Faucet", href: "https://faucet.circle.com" }].map(({ label, href }) => (
            <a key={label} href={href} target="_blank" rel="noopener noreferrer" style={{ color: "#1e293b", fontSize: 11, textDecoration: "none" }}>{label} ↗</a>
          ))}
        </div>
      </aside>

      <main style={{ marginLeft: 220, flex: 1, padding: "2.5rem", minHeight: "100vh" }}>
        <div style={{ position: "relative", zIndex: 1, maxWidth: 520 }}>
          <div style={{ marginBottom: "2rem" }}>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: "#f8fafc", marginBottom: 4, letterSpacing: "-0.5px" }}>
              {tab === "portfolio" ? "Portfolio" : tab === "send" ? "Send" : tab === "swap" ? "Swap" : "Bridge"}
            </h1>
            <p style={{ fontSize: 13, color: "#334155" }}>
              {tab === "portfolio" ? "Arc Testnet balances" : tab === "send" ? "Send USDC or EURC on Arc" : tab === "swap" ? "Swap stablecoins via Arfi Finance" : "Bridge from Sepolia to Arc"}
            </p>
          </div>

          {tab === "portfolio" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem" }}>
                {[
                  { label: "USDC", value: balances.usdc, color: "#2563eb", bg: "rgba(37,99,235,0.08)" },
                  { label: "EURC", value: balances.eurc, color: "#7c3aed", bg: "rgba(124,58,237,0.08)" },
                  { label: "USYC", value: balances.usyc, color: "#f59e0b", bg: "rgba(245,158,11,0.08)" },
                ].map(({ label, value, color, bg }) => (
                  <div key={label} style={{ background: bg, border: `1px solid ${color}20`, borderRadius: 14, padding: "1.25rem" }}>
                    <div style={{ fontSize: 11, color: "#475569", fontWeight: 600, marginBottom: 8, letterSpacing: "1px" }}>{label}</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color }}>{value === null ? "..." : value}</div>
                    <div style={{ fontSize: 11, color: "#334155", marginTop: 4 }}>Arc Testnet</div>
                  </div>
                ))}
              </div>
              <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: "1rem 1.25rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 11, color: "#334155", fontWeight: 600, letterSpacing: "1px", marginBottom: 2 }}>NATIVE</div>
                  <div style={{ fontSize: 13, color: "#475569" }}>Gas token</div>
                </div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#64748b" }}>{balances.native === null ? "..." : balances.native}</div>
              </div>
              <button onClick={() => loadBalances(wallet.address)} style={{ background: "none", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "0.6rem", color: "#334155", fontSize: 12, cursor: "pointer" }}>Refresh balances</button>
              <div>
                <div style={{ fontSize: 11, color: "#1e293b", fontWeight: 600, letterSpacing: "1px", marginBottom: 10 }}>QUICK ACTIONS</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setTab("send")} style={{ flex: 1, padding: "0.75rem", borderRadius: 10, border: "1px solid rgba(16,185,129,0.2)", background: "rgba(16,185,129,0.06)", color: "#10b981", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>↗ Send</button>
                  <button onClick={() => setTab("swap")} style={{ flex: 1, padding: "0.75rem", borderRadius: 10, border: "1px solid rgba(139,92,246,0.2)", background: "rgba(139,92,246,0.06)", color: "#8b5cf6", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>⇄ Swap</button>
                  <a href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer" style={{ flex: 1, padding: "0.75rem", borderRadius: 10, border: "1px solid rgba(59,130,246,0.2)", background: "rgba(59,130,246,0.06)", color: "#3b82f6", fontSize: 13, fontWeight: 600, textDecoration: "none", textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center" }}>⬡ Faucet</a>
                </div>
              </div>
              <a href={`https://testnet.arcscan.app/address/${wallet.address}`} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.875rem 1rem", borderRadius: 10, border: "1px solid rgba(255,255,255,0.05)", background: "rgba(255,255,255,0.02)", color: "#334155", textDecoration: "none", fontSize: 12 }}>
                <span>View on Explorer</span>
                <span style={{ fontFamily: "monospace", fontSize: 11 }}>{shortAddr} ↗</span>
              </a>
            </div>
          )}

          {tab === "bridge" && <BridgeForm provider={wallet.provider} address={wallet.address} walletName={wallet.walletName} />}
          {tab === "swap" && <SwapForm provider={wallet.provider} address={wallet.address} kitKey={KIT_KEY} />}
          {tab === "send" && <SendForm provider={wallet.provider} address={wallet.address} balances={balances} onRefresh={() => loadBalances(wallet.address)} />}
        </div>
      </main>
    </div>
  );
}