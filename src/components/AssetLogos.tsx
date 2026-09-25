import { useState } from "react";
import { USDC_LOGO, EURC_LOGO, ARC_LOGO } from "./tokenLogos";
import { TokenIcon } from "./TokenIcon";

// Shared chain + token logos for the mainnet wallet pages (Circle Wallet, Gateway).
// Arc/USDC/EURC logos are embedded (tokenLogos.ts); other chains use DefiLlama's public icon
// CDN (same source as NativeCctpBridge.tsx) and fall back to a colored letter if it fails.
export type ChainKey = "arc" | "base" | "ethereum" | "arbitrum";

const LLAMA: Record<Exclude<ChainKey, "arc">, string> = {
  base: "https://icons.llamao.fi/icons/chains/rsz_base.jpg",
  ethereum: "https://icons.llamao.fi/icons/chains/rsz_ethereum.jpg",
  arbitrum: "https://icons.llamao.fi/icons/chains/rsz_arbitrum.jpg",
};
const FALLBACK_COLOR: Record<ChainKey, string> = { arc: "#16151C", base: "#0052FF", ethereum: "#627EEA", arbitrum: "#28A0F0" };

export function ChainLogo({ chain, size = 20 }: { chain: ChainKey; size?: number }) {
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: size, borderRadius: "50%", flexShrink: 0, display: "block" } as const;
  if (chain === "arc") return <img src={ARC_LOGO} alt="" width={size} height={size} style={{ ...box, objectFit: "cover" }} />;
  if (failed) {
    return <span aria-hidden="true" style={{ ...box, background: FALLBACK_COLOR[chain], color: "#fff", fontSize: size * 0.45, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{chain[0].toUpperCase()}</span>;
  }
  return <img src={LLAMA[chain]} alt="" width={size} height={size} onError={() => setFailed(true)} style={{ ...box, objectFit: "cover", background: "#fff" }} />;
}

export function TokenLogo({ symbol, size = 20 }: { symbol: string; size?: number }) {
  if (symbol === "USDC" || symbol === "EURC") {
    return <img src={symbol === "USDC" ? USDC_LOGO : EURC_LOGO} alt="" width={size} height={size} style={{ width: size, height: size, borderRadius: "50%", flexShrink: 0, display: "block" }} />;
  }
  return <TokenIcon symbol={symbol} size={size} />;
}

// Token logo with a small chain badge in the corner (e.g. USDC on Base).
export function TokenOnChain({ symbol, chain, size = 32 }: { symbol: string; chain: ChainKey; size?: number }) {
  const badge = Math.round(size * 0.45);
  return (
    <span style={{ position: "relative", width: size, height: size, flexShrink: 0, display: "inline-block" }}>
      <TokenLogo symbol={symbol} size={size} />
      <span style={{ position: "absolute", right: -3, bottom: -3, borderRadius: "50%", border: "2px solid #FFFFFF", background: "#FFFFFF", display: "flex" }}>
        <ChainLogo chain={chain} size={badge} />
      </span>
    </span>
  );
}
