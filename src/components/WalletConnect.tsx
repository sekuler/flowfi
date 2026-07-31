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
  await new Promise((r) => setTimeout(r, 700));
  window.removeEventListener("eip6963:announceProvider", handler);

  const found = [...providers.values()];
  if (found.length > 0) return found;

  if (typeof window.ethereum !== "undefined") {
    const injected = window.ethereum.providers && window.ethereum.providers.length > 0
      ? window.ethereum.providers
      : [window.ethereum];
    return injected.map((p, i) => ({
      info: { uuid: `legacy-${i}`, name: (p as any).isMetaMask ? "MetaMask" : "Injected Wallet", icon: "", rdns: "legacy" },
      provider: p,
    }));
  }

  return [];
}

interface Props { onConnected: (provider: EIP1193Provider, address: string, walletName: string) => void; }

// Curated list of popular wallets, shown even when not installed — matches the
// pattern every major dapp uses (Uniswap, etc). Clicking an uninstalled one
// takes the user to that wallet's real download page instead of doing nothing.
const CURATED_WALLETS = [
  { match: ["io.metamask"], name: "MetaMask", color: "#F6851B", letter: "M", installUrl: "https://metamask.io/download/" },
  { match: ["io.rabby"], name: "Rabby Wallet", color: "#7084FF", letter: "R", installUrl: "https://rabby.io/" },
  { match: ["app.phantom"], name: "Phantom", color: "#AB9FF2", letter: "P", installUrl: "https://phantom.app/download" },
  { match: ["app.backpack"], name: "Backpack", color: "#E33E3E", letter: "B", installUrl: "https://backpack.app/downloads" },
  { match: ["io.magiceden.wallet", "app.magiceden"], name: "Magic Eden", color: "#111827", letter: "M", installUrl: "https://wallet.magiceden.io/download" },
  { match: ["app.keplr"], name: "Keplr", color: "#2E3148", letter: "K", installUrl: "https://www.keplr.app/download" },
];

export default function WalletConnect({ onConnected }: Props) {
  const [status, setStatus] = useState<"idle" | "detecting" | "list">("idle");
  const [detected, setDetected] = useState<EIP6963ProviderDetail[]>([]);
  const [connectingUuid, setConnectingUuid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startConnect() {
    setError(null);
    setStatus("detecting");
    const found = await discoverWallets();
    setDetected(found);
    setStatus("list");
  }

  async function connectWallet(wallet: EIP6963ProviderDetail) {
    setConnectingUuid(wallet.info.uuid); setError(null);
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
      setConnectingUuid(null);
    }
  }

  const extraDetected = detected.filter((d) => !CURATED_WALLETS.some((c) => c.match.includes(d.info.rdns)));

  return (
    <div style={{ maxWidth: 420, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: "0.85rem" }}>
      {error && <div style={{ width: "100%", background: "rgba(239,68,68,0.12)", borderRadius: 12, padding: "0.75rem 1rem", color: "#DC2626", fontSize: 13, lineHeight: 1.5 }}>{error}</div>}

      {status !== "list" && (
        <button onClick={startConnect} disabled={status === "detecting"}
          style={{ width: "100%", padding: "1rem", borderRadius: 16, border: "none", background: "#7c3aed", color: "#ffffff", fontSize: 16, fontWeight: 700, boxShadow: "0 8px 24px rgba(109,94,247,0.4)", cursor: status === "detecting" ? "not-allowed" : "pointer", opacity: status === "detecting" ? 0.7 : 1 }}>
          {status === "idle" && "Connect Wallet"}
          {status === "detecting" && "Detecting wallets..."}
        </button>
      )}

      {status === "list" && (
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
          <p style={{ fontSize: 13, color: "#4B5563", marginBottom: 2, textAlign: "center" }}>Select a wallet to connect:</p>

          {CURATED_WALLETS.map((c) => {
            const found = detected.find((d) => c.match.includes(d.info.rdns));
            const isConnecting = found && connectingUuid === found.info.uuid;
            const isInstalled = !!found;

            return (
              <button
                key={c.name}
                disabled={connectingUuid !== null}
                onClick={() => {
                  if (found) connectWallet(found);
                  else window.open(c.installUrl, "_blank", "noopener,noreferrer");
                }}
                style={{
                  width: "100%", padding: "0.85rem 1rem", borderRadius: 14, border: "1px solid #D4C9FA",
                  background: "#ffffff", cursor: connectingUuid !== null ? "not-allowed" : "pointer",
                  display: "flex", alignItems: "center", gap: 12,
                  opacity: connectingUuid !== null && !isConnecting ? 0.5 : 1,
                  boxShadow: "0 1px 3px rgba(109,94,247,0.06)",
                }}>
                {found?.info.icon ? (
                  <img src={found.info.icon} alt="" width={28} height={28} style={{ borderRadius: 8, flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: c.color, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 13, fontWeight: 800, flexShrink: 0 }}>
                    {c.letter}
                  </div>
                )}
                <span style={{ flex: 1, textAlign: "left", fontSize: 15, fontWeight: 700, color: "#111827" }}>{c.name}</span>
                {isConnecting ? (
                  <span style={{ fontSize: 12, color: "#6D5EF7", fontWeight: 600 }}>Connecting...</span>
                ) : !isInstalled ? (
                  <span style={{ fontSize: 11, color: "#6D5EF7", fontWeight: 700, background: "#f5f3ff", padding: "3px 9px", borderRadius: 999 }}>Install</span>
                ) : null}
              </button>
            );
          })}

          {extraDetected.map((w) => (
            <button key={w.info.uuid} onClick={() => connectWallet(w)} disabled={connectingUuid !== null}
              style={{ width: "100%", padding: "0.85rem 1rem", borderRadius: 14, border: "1px solid #D4C9FA", background: "#ffffff", cursor: connectingUuid !== null ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 12, opacity: connectingUuid !== null && connectingUuid !== w.info.uuid ? 0.5 : 1, boxShadow: "0 1px 3px rgba(109,94,247,0.06)" }}>
              {w.info.icon && <img src={w.info.icon} alt="" width={28} height={28} style={{ borderRadius: 8, flexShrink: 0 }} />}
              <span style={{ flex: 1, textAlign: "left", fontSize: 15, fontWeight: 700, color: "#111827" }}>{w.info.name}</span>
              {connectingUuid === w.info.uuid && <span style={{ fontSize: 12, color: "#6D5EF7", fontWeight: 600 }}>Connecting...</span>}
            </button>
          ))}
        </div>
      )}

      <div style={{ marginTop: 4 }}>
        <span style={{ color: "#4B5563", fontSize: 13 }}>Get test USDC: </span>
        <a href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer" style={{ color: "#5B21B6", fontSize: 13 }}>faucet.circle.com</a>
      </div>
    </div>
  );
}
