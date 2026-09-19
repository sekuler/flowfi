import { useState, useEffect, type ReactNode } from "react";
import type { EIP1193Provider } from "viem";
import { ARC_MAINNET_CHAIN_ID_HEX } from "../chains";

// Shared "wrong network" guard used across every mainnet page that can
// SIGN something (Bridge, Swap) -- Dashboard/Home are read-only and don't
// wrap their content with this, since there's nothing to block there.
//
// Wraps its children rather than just showing a banner above them: an
// earlier version only warned and left the underlying widget fully
// interactive, so a user could dismiss the banner and still sign a
// transaction while genuinely on the wrong chain. Now, when a wallet is
// connected but on the wrong network, children render behind a
// pointer-events-none, dimmed overlay -- the widget is visually present
// (so nothing looks broken) but not clickable until the user switches.
// With no wallet connected at all (guest browsing before connecting
// inside the widget itself), there's nothing to check yet, so children
// render normally -- LI.FI's own widget handles that first connection.
const ARC_MAINNET_PARAMS = {
  chainId: ARC_MAINNET_CHAIN_ID_HEX,
  chainName: "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: ["https://rpc.mainnet.arc.io"],
  blockExplorerUrls: ["https://arc.etherscan.io"],
};

export default function NetworkGuard({ provider, children }: { provider: EIP1193Provider | undefined; children?: ReactNode }) {
  const [chainId, setChainId] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    if (!provider) { setChainId(null); return; }
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

  const wrongNetwork = !!provider && chainId !== null && chainId.toLowerCase() !== ARC_MAINNET_CHAIN_ID_HEX.toLowerCase();

  if (!wrongNetwork) {
    return <>{children}</>;
  }

  return (
    <div style={{ position: "relative" }}>
      <div style={{ pointerEvents: "none", opacity: 0.35, filter: "blur(1px)" }}>
        {children}
      </div>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, background: "rgba(255,255,255,0.55)", borderRadius: 16 }}>
        <div style={{ background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: 14, padding: "1.1rem 1.4rem", textAlign: "center", maxWidth: 320 }}>
          <div style={{ fontSize: 13.5, color: "#991B1B", fontWeight: 700, marginBottom: 10 }}>
            ⚠ Your wallet isn't on Arc Mainnet
          </div>
          <button onClick={switchToArcMainnet} disabled={switching}
            style={{ padding: "0.55rem 1.1rem", borderRadius: 10, border: "none", background: "#DC2626", color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: switching ? "not-allowed" : "pointer", opacity: switching ? 0.6 : 1 }}>
            {switching ? "Switching..." : "Switch to Arc Mainnet"}
          </button>
        </div>
      </div>
    </div>
  );
}
