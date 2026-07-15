import { useState } from "react";
import type { EIP1193Provider } from "viem";


type EIP6963ProviderInfo = { uuid: string; name: string; icon: string; rdns: string; };
type EIP6963ProviderDetail = { info: EIP6963ProviderInfo; provider: EIP1193Provider; };

declare global {
  interface WindowEventMap { "eip6963:announceProvider": CustomEvent<EIP6963ProviderDetail>; }
}

async function discoverWallets(): Promise<EIP6963ProviderDetail[]> {
  const providers = new Map<string, EIP6963ProviderDetail>();
  const handler = (e: CustomEvent<EIP6963ProviderDetail>) => { providers.set(e.detail.info.uuid, e.detail); };
  window.addEventListener("eip6963:announceProvider", handler);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  await new Promise((r) => setTimeout(r, 300));
  window.removeEventListener("eip6963:announceProvider", handler);
  return [...providers.values()];
}

interface Props { onConnected: (provider: EIP1193Provider, address: string, walletName: string) => void; }

export default function WalletConnect({ onConnected }: Props) {
  const [status, setStatus] = useState<"idle" | "detecting" | "selecting" | "connecting">("idle");
  const [wallets, setWallets] = useState<EIP6963ProviderDetail[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function detect() {
    setError(null); setStatus("detecting");
    const found = await discoverWallets();
    if (found.length === 0) { setError("No wallet found. Is MetaMask or Rabby installed? Refresh and try again."); setStatus("idle"); return; }
    if (found.length === 1) { await connectWallet(found[0]); } else { setWallets(found); setStatus("selecting"); }
  }

  async function connectWallet(wallet: EIP6963ProviderDetail) {
    setStatus("connecting"); setError(null);
    try {
      await wallet.provider.request({ method: "eth_requestAccounts", params: undefined });
      const accounts = (await wallet.provider.request({ method: "eth_accounts", params: undefined })) as string[];
      if (!accounts[0]) throw new Error("No account found.");
    
      onConnected(wallet.provider, accounts[0], wallet.info.name);
    } catch (e: unknown) {
      const err = e as { message?: string };
      setError(err.message ?? "An error occurred."); setStatus("idle");
    }
  }

  return (
    <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 16, padding: "2rem", maxWidth: 420, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem", border: "1px solid rgba(255,255,255,0.07)", backdropFilter: "blur(10px)" }}>
      <div style={{ width: 52, height: 52, borderRadius: 14, background: "linear-gradient(135deg, rgba(99,102,241,0.2), rgba(139,92,246,0.2))", border: "1px solid rgba(99,102,241,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>
        🔗
      </div>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: "#f1f5f9" }}>Connect Wallet</h2>
      <p style={{ fontSize: 14, color: "#64748b", textAlign: "center", lineHeight: 1.6 }}>
        Connect your wallet to bridge USDC from Ethereum Sepolia to Arc Testnet.
      </p>
      {error && <div style={{ width: "100%", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "0.75rem 1rem", color: "#fca5a5", fontSize: 13, lineHeight: 1.5 }}>{error}</div>}
      {status === "selecting" ? (
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
          <p style={{ fontSize: 13, color: "#94a3b8", marginBottom: 4 }}>Select a wallet to connect:</p>
          {wallets.map((w) => (
            <button key={w.info.uuid} onClick={() => connectWallet(w)}
              style={{ width: "100%", padding: "0.75rem 1rem", borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)", color: "#f1f5f9", fontSize: 15, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}>
              {w.info.icon && <img src={w.info.icon} alt="" width={24} height={24} style={{ borderRadius: 6 }} />}
              {w.info.name}
            </button>
          ))}
        </div>
      ) : (
        <button onClick={detect} disabled={status !== "idle"}
          style={{ width: "100%", padding: "0.85rem", borderRadius: 10, border: "none", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", color: "#fff", fontSize: 15, fontWeight: 600, cursor: status !== "idle" ? "not-allowed" : "pointer", opacity: status !== "idle" ? 0.7 : 1, boxShadow: "0 0 24px rgba(99,102,241,0.4)" }}>
          {status === "idle" && "🔍 Detect Wallets"}
          {status === "detecting" && "⏳ Detecting wallets..."}
          {status === "connecting" && "🔄 Connecting..."}
        </button>
      )}
      <div style={{ marginTop: 4 }}>
        <span style={{ color: "#64748b", fontSize: 13 }}>Get test USDC: </span>
        <a href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer" style={{ color: "#60a5fa", fontSize: 13 }}>faucet.circle.com</a>
      </div>
    </div>
  );
}
