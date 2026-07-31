import { useState } from "react";
import type { EIP1193Provider } from "viem";


type EIP6963ProviderInfo = { uuid: string; name: string; icon: string; rdns: string; };
type EIP6963ProviderDetail = { info: EIP6963ProviderInfo; provider: EIP1193Provider; };

declare global {
  interface Window { ethereum?: EIP1193Provider & { isMetaMask?: boolean; providers?: EIP1193Provider[] }; }
  interface WindowEventMap { "eip6963:announceProvider": CustomEvent<EIP6963ProviderDetail>; }
}

async function discoverWallets(): Promise<EIP6963ProviderDetail[]> {
  const providers = new Map<string, EIP6963ProviderDetail>();
  const handler = (e: CustomEvent<EIP6963ProviderDetail>) => { providers.set(e.detail.info.uuid, e.detail); };
  window.addEventListener("eip6963:announceProvider", handler);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  // Give slower extensions (and mobile in-app browsers) more time to announce themselves.
  await new Promise((r) => setTimeout(r, 700));
  window.removeEventListener("eip6963:announceProvider", handler);

  const found = [...providers.values()];
  if (found.length > 0) return found;

  // Legacy fallback: some wallets (or older versions) only expose window.ethereum
  // without emitting an EIP-6963 announcement. Without this, users on those
  // wallets would see "No wallet found" and never get a connect popup at all.
  if (typeof window.ethereum !== "undefined") {
    const injected = window.ethereum.providers && window.ethereum.providers.length > 0
      ? window.ethereum.providers
      : [window.ethereum];
    return injected.map((p, i) => ({
      info: {
        uuid: `legacy-${i}`,
        name: (p as any).isMetaMask ? "MetaMask" : "Injected Wallet",
        icon: "",
        rdns: "legacy",
      },
      provider: p,
    }));
  }

  return [];
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
      const err = e as { message?: string; code?: number };
      if (err.code === -32002) {
        setError("Your wallet already has a connection request open. Open the extension and check for a pending popup.");
      } else if (err.code === 4001) {
        setError("Connection request was rejected.");
      } else {
        setError(err.message ?? "An error occurred.");
      }
      setStatus("idle");
    }
  }

  return (
    <div style={{ maxWidth: 420, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem" }}>
      {error && <div style={{ width: "100%", background: "rgba(239,68,68,0.12)", borderRadius: 10, padding: "0.75rem 1rem", color: "#DC2626", fontSize: 13, lineHeight: 1.5 }}>{error}</div>}
      {status === "selecting" ? (
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
          <p style={{ fontSize: 13, color: "#4B5563", marginBottom: 4 }}>Select a wallet to connect:</p>
          {wallets.map((w) => (
            <button key={w.info.uuid} onClick={() => connectWallet(w)}
              style={{ width: "100%", padding: "0.75rem 1rem", borderRadius: 12, border: "none", background: "#f5f3ff", color: "#111827", fontSize: 15, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}>
              {w.info.icon && <img src={w.info.icon} alt="" width={24} height={24} style={{ borderRadius: 6 }} />}
              {w.info.name}
            </button>
          ))}
        </div>
      ) : (
        <button onClick={detect} disabled={status !== "idle"}
          style={{ width: "100%", padding: "1rem", borderRadius: 16, border: "none", background: "#7c3aed", color: "#ffffff", fontSize: 16, fontWeight: 700, cursor: status !== "idle" ? "not-allowed" : "pointer", opacity: status !== "idle" ? 0.6 : 1 }}>
          {status === "idle" && "Connect Wallet"}
          {status === "detecting" && "Detecting wallets..."}
          {status === "connecting" && "Connecting..."}
        </button>
      )}
      <div style={{ marginTop: 4 }}>
        <span style={{ color: "#4B5563", fontSize: 13 }}>Get test USDC: </span>
        <a href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer" style={{ color: "#a855f7", fontSize: 13 }}>faucet.circle.com</a>
      </div>
    </div>
  );
}
