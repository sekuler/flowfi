import { useState } from "react";
import type { EIP1193Provider } from "viem";
import { Wallet, CircleDollarSign } from "lucide-react";
import WalletConnect from "./WalletConnect";
import { saveCircleWallet, type CircleWalletInfo } from "../circleWalletHelpers";

interface Props {
  onClose: () => void;
  onConnected: (provider: EIP1193Provider, address: string, walletName: string) => void;
  onCircleConnected: (info: CircleWalletInfo) => void;
}

export default function ConnectModal({ onClose, onConnected, onCircleConnected }: Props) {
  const [tab, setTab] = useState<"browser" | "circle">("browser");
  const [creating, setCreating] = useState(false);
  const [circleError, setCircleError] = useState<string | null>(null);

  async function createCircleWallet() {
    setCreating(true);
    setCircleError(null);
    try {
      const res = await fetch("/api/circle-wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create" }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? "Failed to create wallet.");
      const info: CircleWalletInfo = { address: data.address, walletsByChain: data.walletsByChain };
      saveCircleWallet(info);
      onCircleConnected(info);
    } catch (e: unknown) {
      const err = e as { message?: string };
      setCircleError(err.message ?? "Unexpected error.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(17,24,39,0.45)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 440, background: "#ffffff", borderRadius: 24, padding: "1.75rem", boxShadow: "0 24px 60px rgba(17,24,39,0.25)", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#111827" }}>Connect to FlowFi</div>
            <div style={{ fontSize: 12.5, color: "#6B7280", marginTop: 2 }}>Pick how you want to sign in — you can only use one at a time.</div>
          </div>
          <button onClick={onClose} style={{ background: "#F3F4F6", border: "none", borderRadius: 999, width: 30, height: 30, fontSize: 15, color: "#4B5563", cursor: "pointer", flexShrink: 0 }}>×</button>
        </div>

        <div style={{ display: "flex", gap: 6, background: "#f5f3ff", borderRadius: 999, padding: 4, marginBottom: 18 }}>
          <button onClick={() => setTab("browser")}
            style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "0.55rem", borderRadius: 999, border: "none", background: tab === "browser" ? "#ffffff" : "transparent", color: tab === "browser" ? "#5B21B6" : "#6B7280", fontSize: 13, fontWeight: 700, cursor: "pointer", boxShadow: tab === "browser" ? "0 1px 3px rgba(124,58,237,0.15)" : "none" }}>
            <Wallet size={14} /> Browser Wallet
          </button>
          <button onClick={() => setTab("circle")}
            style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "0.55rem", borderRadius: 999, border: "none", background: tab === "circle" ? "#ffffff" : "transparent", color: tab === "circle" ? "#5B21B6" : "#6B7280", fontSize: 13, fontWeight: 700, cursor: "pointer", boxShadow: tab === "circle" ? "0 1px 3px rgba(124,58,237,0.15)" : "none" }}>
            <CircleDollarSign size={14} /> Circle Wallet
          </button>
        </div>

        {tab === "browser" ? (
          <div style={{ display: "flex", justifyContent: "center" }}>
            <WalletConnect onConnected={onConnected} />
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ background: "rgba(52,211,153,0.1)", borderRadius: 10, padding: "0.75rem 1rem" }}>
              <p style={{ fontSize: 12, color: "#16A34A", margin: 0 }}>
                No extension, no seed phrase. Circle creates and manages the wallet for you, in one click.
              </p>
            </div>
            {circleError && <div style={{ background: "rgba(239,68,68,0.12)", borderRadius: 10, padding: "0.75rem 1rem", color: "#DC2626", fontSize: 12, wordBreak: "break-word" }}>{circleError}</div>}
            <button onClick={createCircleWallet} disabled={creating}
              style={{ width: "100%", padding: "1rem", borderRadius: 16, border: "none", background: "#16A34A", color: "#ffffff", fontSize: 15, fontWeight: 700, boxShadow: "0 8px 24px rgba(22,163,74,0.35)", cursor: creating ? "not-allowed" : "pointer", opacity: creating ? 0.6 : 1 }}>
              {creating ? "Creating wallet..." : "Create Circle Wallet"}
            </button>
            <p style={{ fontSize: 11, color: "#9CA3AF", margin: 0, textAlign: "center" }}>
              Note: some features (AI Copilot, Token Launch, and pool actions) currently require a Browser Wallet.
            </p>
          </div>
        )}

        <div style={{ marginTop: 16, textAlign: "center" }}>
          <span style={{ color: "#4B5563", fontSize: 12.5 }}>Get test USDC: </span>
          <a href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer" style={{ color: "#5B21B6", fontSize: 12.5 }}>faucet.circle.com</a>
        </div>
      </div>
    </div>
  );
}
