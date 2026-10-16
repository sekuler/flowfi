import { useEffect, useState } from "react";
import { createPublicClient, createWalletClient, custom, http } from "viem";
import type { EIP1193Provider } from "viem";
import { ExternalLink } from "lucide-react";
import { arcMainnet, ARC_MAINNET_CHAIN_ID_HEX } from "../chains";
import { T, glass } from "./mainnetTheme";
import { useIsMobile } from "../useIsMobile";

// Flow Pioneer badge card on the mainnet Home (contracts/FlowPioneerBadge.sol, api/badge.js).
// Every connected wallet sees "Your Flow Pioneer badge is waiting". Pressing Mint asks the server for a
// signature: wallets that already used FlowFi get one and mint; others see a short note to make their
// first transaction. After minting the card shows the wallet's badge number. When badges run out the
// card simply disappears — the total is never shown.
export const FLOW_PIONEER_ADDRESS = "0xb60134309c8bee9101f34601aa2e3d8b23102f9a" as const;
const MINT_ABI = [{ type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "signature", type: "bytes" }], outputs: [{ name: "tokenId", type: "uint256" }] }] as const;
const BADGE_OF_ABI = [{ type: "function", name: "badgeOf", stateMutability: "view", inputs: [{ name: "wallet", type: "address" }], outputs: [{ type: "uint256" }] }] as const;
const IMG = "/badge/flow-pioneer-512.webp";
const ACCENT = "#3D5AF1";

const pc = createPublicClient({ chain: arcMainnet, transport: http() });

type Status = { minted: boolean; tokenId: number | null; open: boolean };

async function switchToArc(provider: EIP1193Provider) {
  const cur = (await provider.request({ method: "eth_chainId" })) as string;
  if (cur.toLowerCase() === ARC_MAINNET_CHAIN_ID_HEX.toLowerCase()) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC_MAINNET_CHAIN_ID_HEX }] });
  } catch (e: unknown) {
    if ((e as { code?: number }).code !== 4902) throw e;
    await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: ARC_MAINNET_CHAIN_ID_HEX, chainName: "Arc", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: ["https://rpc.mainnet.arc.io"], blockExplorerUrls: ["https://arc.etherscan.io"] }] });
  }
}

export default function FlowPioneerCard({ address, provider }: { address: string; provider?: EIP1193Provider }) {
  const isMobile = useIsMobile();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [mintHash, setMintHash] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus(null); setNote(null); setMintHash(null);
    fetch(`/api/badge?address=${address}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((s: Status | null) => { if (!cancelled && s) setStatus(s); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [address]);

  async function mint() {
    if (!provider || busy) return;
    setBusy(true); setNote(null);
    try {
      const r = await fetch("/api/badge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.signature) {
        if (r.status === 410) { setStatus((s) => (s ? { ...s, open: false } : s)); return; }
        setNote(d.error || "Something went wrong. Please try again.");
        return;
      }
      await switchToArc(provider);
      const wc = createWalletClient({ account: address as `0x${string}`, chain: arcMainnet, transport: custom(provider) });
      setNote("Confirm the mint in your wallet...");
      const hash = await wc.writeContract({ address: FLOW_PIONEER_ADDRESS, abi: MINT_ABI, functionName: "mint", args: [d.signature as `0x${string}`] });
      setNote("Minting your badge...");
      const rc = await pc.waitForTransactionReceipt({ hash });
      if (rc.status === "reverted") throw new Error("The mint didn't go through. Nothing changed.");
      const id = await pc.readContract({ address: FLOW_PIONEER_ADDRESS, abi: BADGE_OF_ABI, functionName: "badgeOf", args: [address as `0x${string}`] });
      setMintHash(hash);
      setStatus({ minted: true, tokenId: Number(id), open: true });
      setNote(null);
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string };
      setNote(err.shortMessage || err.message || "Mint failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;
  if (!status.minted && !status.open) return null;

  const minted = status.minted;
  return (
    <section style={{ ...glass, display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: "center", gap: isMobile ? 16 : 28, padding: isMobile ? "1.25rem" : "1.5rem 2rem", textAlign: isMobile ? "center" : "left" }}>
      <img src={IMG} alt="Flow Pioneer badge" width={isMobile ? 120 : 112} height={isMobile ? 120 : 112}
        style={{ borderRadius: 24, flexShrink: 0, boxShadow: "0 14px 30px -16px rgba(30,60,200,0.65)" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <h3 className="ffh-display" style={{ margin: 0, fontSize: isMobile ? 22 : 25, fontWeight: 600, color: T.ink, letterSpacing: "-0.01em" }}>
          {minted ? `Flow Pioneer #${status.tokenId}` : "Your Flow Pioneer badge is waiting"}
        </h3>
        <div style={{ marginTop: 6, fontSize: 15, color: T.muted, lineHeight: 1.5 }}>
          {minted ? "Thanks for being early." : "Mint it for free. It stays in your wallet as a non-transferable badge."}
        </div>
        {note && <div style={{ marginTop: 8, fontSize: 14, fontWeight: 600, color: ACCENT }}>{note}</div>}
        {minted && mintHash && (
          <a href={`https://arc.etherscan.io/tx/${mintHash}`} target="_blank" rel="noopener noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 8, fontSize: 14, fontWeight: 600, color: ACCENT, textDecoration: "none" }}>
            View on Arcscan <ExternalLink size={14} />
          </a>
        )}
      </div>
      {!minted && (
        <button onClick={mint} disabled={busy || !provider}
          style={{ height: 52, padding: "0 28px", border: "none", borderRadius: 12, background: ACCENT, color: "#FFFFFF", fontSize: 16, fontWeight: 600, flexShrink: 0, cursor: busy ? "wait" : "pointer", opacity: busy || !provider ? 0.7 : 1, boxShadow: "0 10px 22px -12px rgba(61,90,241,0.8)", width: isMobile ? "100%" : "auto" }}>
          {busy ? "Minting..." : "Mint badge"}
        </button>
      )}
    </section>
  );
}
