import { useState } from "react";
import type { EIP1193Provider } from "viem";
import WalletConnect from "./components/WalletConnect";
import BridgeForm from "./components/BridgeForm";
import SwapForm from "./components/SwapForm";
import SendForm from "./components/SendForm";

interface WalletInfo {
  provider: EIP1193Provider;
  address: string;
  walletName: string;
}

type Tab = "bridge" | "swap" | "send";

const KIT_KEY = (import.meta as unknown as { env: Record<string, string> }).env?.VITE_KIT_KEY ?? "";

const TABS: { id: Tab; label: string; icon: string; color: string; glow: string }[] = [
  { id: "bridge", label: "Bridge",   icon: "🌉", color: "#3b82f6", glow: "rgba(59,130,246,0.35)" },
  { id: "swap",   label: "Swap",     icon: "🔄", color: "#8b5cf6", glow: "rgba(139,92,246,0.35)" },
  { id: "send",   label: "Send",     icon: "📤", color: "#10b981", glow: "rgba(16,185,129,0.35)" },
];

export default function App() {
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [tab, setTab] = useState<Tab>("bridge");

  function handleConnected(provider: EIP1193Provider, address: string, walletName: string) {
    setWallet({ provider, address, walletName });
  }

  const shortAddr = wallet ? wallet.address.slice(0, 6) + "..." + wallet.address.slice(-4) : "";
  const activeTab = TABS.find(t => t.id === tab)!;

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "linear-gradient(135deg, #06080f 0%, #0d1128 40%, #0a0d1f 100%)", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "fixed", top: -300, left: -200, width: 800, height: 800, background: "radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 65%)", pointerEvents: "none" }} />
      <div style={{ position: "fixed", bottom: -300, right: -200, width: 800, height: 800, background: "radial-gradient(circle, rgba(139,92,246,0.1) 0%, transparent 65%)", pointerEvents: "none" }} />
      <div style={{ position: "fixed", top: "40%", left: "60%", width: 400, height: 400, background: "radial-gradient(circle, rgba(6,182,212,0.06) 0%, transparent 65%)", pointerEvents: "none" }} />

      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1rem 2rem", borderBottom: "1px solid rgba(255,255,255,0.07)", backdropFilter: "blur(20px)", position: "sticky", top: 0, zIndex: 10, background: "rgba(6,8,15,0.85)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 12, background: "linear-gradient(135deg, #6366f1, #8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, boxShadow: "0 0 20px rgba(99,102,241,0.4)" }}>
            ⬡
          </div>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: "#f1f5f9", letterSpacing: "-0.5px" }}>Arc DeFi</div>
            <div style={{ fontSize: 10, color: "#6366f1", fontWeight: 700, letterSpacing: "2px" }}>TESTNET</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {[
            { label: "Faucet", href: "https://faucet.circle.com", color: "#60a5fa" },
            { label: "Explorer", href: "https://testnet.arcscan.app", color: "#94a3b8" },
            { label: "Community", href: "https://community.arc.io/home", color: "#a78bfa" },
            { label: "arc.io", href: "https://www.arc.io", color: "#94a3b8" },
          ].map(({ label, href, color }) => (
            <a key={label} href={href} target="_blank" rel="noopener noreferrer"
              style={{ padding: "5px 12px", borderRadius: 20, fontSize: 12, color, textDecoration: "none", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", fontWeight: 500 }}>
              {label}
            </a>
          ))}
          {wallet && (
            <div style={{ padding: "5px 12px", borderRadius: 20, fontSize: 12, color: "#64748b", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", fontFamily: "monospace" }}>
              {shortAddr}
            </div>
          )}
        </div>
      </header>

      <main style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "3rem 1rem", gap: "2rem" }}>
        {!wallet ? (
          <>
            <div style={{ textAlign: "center", maxWidth: 520 }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.35)", borderRadius: 20, padding: "5px 16px", fontSize: 12, color: "#818cf8", marginBottom: 24, fontWeight: 600 }}>
                Live on Arc Testnet
              </div>
              <h1 style={{ fontSize: 52, fontWeight: 800, color: "#f1f5f9", letterSpacing: "-1.5px", marginBottom: 18, lineHeight: 1.05 }}>
                {"The Arc "}
                <span style={{ background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #06b6d4 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                  DeFi Hub
                </span>
              </h1>
              <p style={{ fontSize: 16, color: "#64748b", lineHeight: 1.75, maxWidth: 420, margin: "0 auto" }}>
                Bridge USDC from Ethereum Sepolia to Arc Testnet, swap tokens via Curve Finance, and send USDC or EURC instantly.
              </p>
            </div>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center", marginBottom: 8 }}>
              {[
                { icon: "🌉", title: "Bridge", desc: "Sepolia to Arc", color: "#3b82f6" },
                { icon: "🔄", title: "Swap", desc: "Via Curve Finance", color: "#8b5cf6" },
                { icon: "📤", title: "Send", desc: "USDC & EURC", color: "#10b981" },
              ].map(({ icon, title, desc, color }) => (
                <div key={title} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: "1.25rem 1.5rem", minWidth: 150, textAlign: "center", backdropFilter: "blur(10px)" }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>{icon}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color, marginBottom: 4 }}>{title}</div>
                  <div style={{ fontSize: 12, color: "#475569" }}>{desc}</div>
                </div>
              ))}
            </div>

            <WalletConnect onConnected={handleConnected} />
          </>
        ) : (
          <>
            <div style={{ display: "flex", gap: 6, background: "rgba(255,255,255,0.04)", borderRadius: 18, padding: 6, border: "1px solid rgba(255,255,255,0.08)", backdropFilter: "blur(10px)" }}>
              {TABS.map(({ id, label, icon, color, glow }) => (
                <button key={id} onClick={() => setTab(id)}
                  style={{ padding: "0.65rem 1.5rem", borderRadius: 12, border: "none", background: tab === id ? color : "transparent", color: tab === id ? "#fff" : "#64748b", fontSize: 14, fontWeight: 700, cursor: "pointer", boxShadow: tab === id ? ("0 0 24px " + glow) : "none", display: "flex", alignItems: "center", gap: 6, transition: "all 0.2s" }}>
                  <span>{icon}</span>
                  <span>{label}</span>
                </button>
              ))}
            </div>

            <div style={{ width: "100%", maxWidth: 460, position: "relative" }}>
              <div style={{ position: "absolute", top: -60, left: "50%", transform: "translateX(-50%)", width: 400, height: 150, background: ("radial-gradient(ellipse, " + activeTab.glow + " 0%, transparent 70%)"), pointerEvents: "none", zIndex: 0 }} />
              <div style={{ position: "relative", zIndex: 1 }}>
                {tab === "bridge" && <BridgeForm provider={wallet.provider} address={wallet.address} walletName={wallet.walletName} />}
                {tab === "swap" && <SwapForm provider={wallet.provider} address={wallet.address} kitKey={KIT_KEY} />}
                {tab === "send" && <SendForm provider={wallet.provider} address={wallet.address} />}
              </div>
            </div>
          </>
        )}
      </main>

      <footer style={{ borderTop: "1px solid rgba(255,255,255,0.05)", padding: "1.5rem 2rem" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", maxWidth: 1000, margin: "0 auto" }}>
          <div style={{ fontSize: 12, color: "#1e293b" }}>Built with Circle App Kit on Arc Testnet</div>
          <div style={{ display: "flex", gap: 20 }}>
            {[
              { label: "arc.io", href: "https://www.arc.io" },
              { label: "Community", href: "https://community.arc.io/home" },
              { label: "Explorer", href: "https://testnet.arcscan.app" },
              { label: "Faucet", href: "https://faucet.circle.com" },
              { label: "Docs", href: "https://docs.arc.io" },
            ].map(({ label, href }) => (
              <a key={label} href={href} target="_blank" rel="noopener noreferrer"
                style={{ color: "#334155", fontSize: 12, textDecoration: "none" }}>
                {label}
              </a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
