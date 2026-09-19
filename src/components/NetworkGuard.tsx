import { useState, useEffect } from "react";
import type { EIP1193Provider } from "viem";

// Shared "wrong network" warning + one-click "Add/Switch to Arc Mainnet"
// bar, used across every mainnet page (Bridge, Swap, Dashboard, Home).
// Built once here instead of copy-pasted per page. Uses the same
// wallet_switchEthereumChain / wallet_addEthereumChain pattern already
// proven in AiCopilot.tsx's switchToArc() (for Arc Testnet) -- this is
// the mainnet equivalent.
const ARC_MAINNET_CHAIN_ID_HEX = "0x13B2"; // 5042
const ARC_MAINNET_PARAMS = {
  chainId: ARC_MAINNET_CHAIN_ID_HEX,
  chainName: "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: ["https://rpc.mainnet.arc.io"],
  blockExplorerUrls: ["https://arc.etherscan.io"],
};

export default function NetworkGuard({ provider }: { provider: EIP1193Provider | undefined }) {
  const [chainId, setChainId] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    if (!provider) return;
    let cancelled = false;
    async function check() {
      try {
        const id = await provider!.request({ method: "eth_chainId" });
        if (!cancelled) setChainId(id as string);
      } catch {
        /* ignore */
      }
    }
    check();
    const onChainChanged = (id: unknown) => setChainId(id as string);
    (provider as any)?.on?.("chainChanged", onChainChanged);
    return () => {
      cancelled = true;
      (provider as any)?.removeListener?.("chainChanged", onChainChanged);
    };
  }, [provider]);

  async function switchToArcMainnet() {
    if (!provider) return;
    setSwitching(true);
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC_MAINNET_CHAIN_ID_HEX }] });
    } catch (e: unknown) {
      const err = e as { code?: number };
      if (err.code === 4902) {
        try {
          await provider.request({ method: "wallet_addEthereumChain", params: [ARC_MAINNET_PARAMS] });
        } catch {
          /* user rejected the add prompt */
        }
      }
    } finally {
      setSwitching(false);
    }
  }

  if (!provider || chainId === null || chainId.toLowerCase() === ARC_MAINNET_CHAIN_ID_HEX.toLowerCase()) {
    return null;
  }

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: 12, padding: "0.7rem 1rem", marginBottom: 14, flexWrap: "wrap" }}>
      <span style={{ fontSize: 12.5, color: "#991B1B", fontWeight: 600 }}>
        ⚠ Your wallet isn't on Arc Mainnet — switch networks before continuing.
      </span>
      <button onClick={switchToArcMainnet} disabled={switching}
        style={{ padding: "0.45rem 0.9rem", borderRadius: 10, border: "none", background: "#DC2626", color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: switching ? "not-allowed" : "pointer", opacity: switching ? 0.6 : 1, whiteSpace: "nowrap" }}>
        {switching ? "Switching..." : "Switch to Arc Mainnet"}
      </button>
    </div>
  );
}
