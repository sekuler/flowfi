import EmptyState from "./EmptyState";
import { HelpCircle } from "lucide-react";
import { useState, useEffect } from "react";
import { getCircleWallet, type CircleWalletInfo } from "../circleWalletHelpers";
import { contactNameFor } from "../contacts";
import { USDC_ADDRESS, EURC_ADDRESS } from "../contracts";

interface Tx {
  hash: string;
  method: string;
  age: string;
  from: string;
  to: string;
  status: string;
  input: string;
  value: string;
}

interface Props {
  address: string;
  network?: "testnet" | "mainnet";
}

const KNOWN_TOKENS: Record<string, string> = {
  [USDC_ADDRESS.toLowerCase()]: "USDC",
  [EURC_ADDRESS.toLowerCase()]: "EURC",
  "0x3600000000000000000000000000000000000000": "USDC", // Arc Mainnet USDC
};

const METHOD_META: Record<string, { label: string; color: string }> = {
  "0xa9059cbb": { label: "Send", color: "#16A34A" },
  "0x095ea7b3": { label: "Approve", color: "#f59e0b" },
  "0x74b30078": { label: "Swap", color: "#7c3aed" },
  "0x9cd441da": { label: "Swap", color: "#7c3aed" },
  "0xe334e8dd": { label: "Escrow", color: "#5B21B6" },
  "0x8e0250ee": { label: "Bridge", color: "#5B21B6" },
  "0x57ecfd28": { label: "Bridge", color: "#5B21B6" },
  "0x": { label: "Deploy", color: "#4B5563" },
};

// CCTP domain IDs -> human-readable chain names (must match BridgeForm.tsx's CHAINS map).
const DOMAIN_NAMES: Record<number, string> = {
  0: "Ethereum Sepolia",
  3: "Arbitrum Sepolia",
  6: "Base Sepolia",
  26: "Arc Testnet",
};

// Mainnet CCTP domains (same numbering as NativeCctpBridge's source-chain list).
const DOMAIN_NAMES_MAINNET: Record<number, string> = {
  0: "Ethereum", 1: "Avalanche", 2: "Optimism", 3: "Arbitrum", 6: "Base", 7: "Polygon",
  10: "Unichain", 11: "Linea", 12: "Codex", 13: "Sonic", 14: "World Chain", 15: "Monad",
  16: "Sei", 18: "XDC", 19: "HyperEVM", 21: "Ink", 22: "Plume", 26: "Arc", 30: "Morph",
};

function timeAgo(sec: number) {
  const diff = Math.floor(Date.now() / 1000) - sec;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// Label/color for a transaction. Plain native transfers (empty calldata) are Send or Receive depending on
// direction; only a transaction with no recipient is a contract deployment.
function metaFor(tx: Tx, me: string) {
  if (tx.input === "0x" || tx.method === "0x") {
    if (!tx.to || tx.to === "—") return { label: "Deploy", color: "#4B5563" };
    return tx.from.toLowerCase() === me.toLowerCase()
      ? { label: "Send", color: "#16A34A" }
      : { label: "Receive", color: "#0EA5E9" };
  }
  return METHOD_META[tx.method] ?? { label: "Transfer", color: "#6B7280" };
}

function shortAddr(addr: string) {
  const contactName = contactNameFor(addr);
  if (contactName) return contactName;
  return addr.length > 10 ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : addr;
}

// Reads the 32-byte word at `wordIndex` (0-based, after the 4-byte selector) from raw calldata.
function decodeWord(input: string, wordIndex: number): string | null {
  const start = 10 + wordIndex * 64;
  if (input.length < start + 64) return null;
  return input.slice(start, start + 64);
}

function decodeUint(input: string, wordIndex: number, decimals = 6): number | null {
  const word = decodeWord(input, wordIndex);
  if (!word) return null;
  try {
    const value = BigInt("0x" + word);
    return Number(value) / 10 ** decimals;
  } catch {
    return null;
  }
}

function decodeAddress(input: string, wordIndex: number): string | null {
  const word = decodeWord(input, wordIndex);
  if (!word) return null;
  return "0x" + word.slice(24);
}

function formatAmount(n: number): string {
  // Unlimited/near-unlimited approvals show as a word instead of a huge number.
  if (n > 1e12) return "unlimited";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// Builds a plain-English description of what a transaction actually did,
// decoded from the raw calldata rather than just showing the tx hash.
function describeTx(tx: Tx, me: string, network: "testnet" | "mainnet"): string {
  const tokenSymbol = KNOWN_TOKENS[tx.to.toLowerCase()] ?? "tokens";
  const domainNames = network === "mainnet" ? DOMAIN_NAMES_MAINNET : DOMAIN_NAMES;

  // Plain native USDC transfer (Arc's gas token): no calldata, just a value.
  if (tx.input === "0x" && tx.to && tx.to !== "—") {
    let amt: number | null = null;
    try { amt = Number(BigInt(tx.value || "0")) / 1e18; } catch { amt = null; }
    const amtText = amt !== null && amt > 0 ? `${amt.toLocaleString(undefined, { maximumFractionDigits: 4 })} USDC ` : "USDC ";
    return tx.from.toLowerCase() !== me.toLowerCase()
      ? `Received ${amtText}from ${shortAddr(tx.from)}`
      : `Sent ${amtText}to ${shortAddr(tx.to)}`;
  }

  switch (tx.method) {
    case "0xa9059cbb": { // transfer(address,uint256)
      const amount = decodeUint(tx.input, 1);
      const recipient = decodeAddress(tx.input, 0);
      if (amount === null || !recipient) return `Sent ${tokenSymbol}`;
      return `Sent ${formatAmount(amount)} ${tokenSymbol} to ${shortAddr(recipient)}`;
    }
    case "0x095ea7b3": { // approve(address,uint256)
      const amount = decodeUint(tx.input, 1);
      if (amount === null) return `Approved ${tokenSymbol} spending`;
      return `Approved ${formatAmount(amount)} ${tokenSymbol} for spending`;
    }
    case "0x74b30078": { // swapUsdcToEurc(uint256)
      const amount = decodeUint(tx.input, 0);
      if (amount === null) return "Swapped USDC for EURC";
      return `Swapped ${formatAmount(amount)} USDC for EURC`;
    }
    case "0x9cd441da": { // swapEurcToUsdc(uint256)
      const amount = decodeUint(tx.input, 0);
      if (amount === null) return "Swapped EURC for USDC";
      return `Swapped ${formatAmount(amount)} EURC for USDC`;
    }
    case "0x8e0250ee": { // depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)
      const amount = decodeUint(tx.input, 0);
      const domainWord = decodeWord(tx.input, 1);
      const domain = domainWord ? parseInt(domainWord, 16) : null;
      const chainName = domain !== null ? domainNames[domain] : null;
      if (amount === null) return "Bridged USDC via CCTP";
      return chainName ? `Bridged ${formatAmount(amount)} USDC to ${chainName}` : `Bridged ${formatAmount(amount)} USDC via CCTP`;
    }
    case "0x57ecfd28": // receiveMessage(bytes,bytes) — the mint side; amount is inside a nested
      return "Received bridged USDC";        // CCTP message body, not decodable from top-level calldata alone.
    case "0xe334e8dd":
      return "Escrow transaction";
    case "0x":
      return "Deployed a contract";
    default:
      return "Contract interaction";
  }
}

export default function TxHistory({ address, network = "testnet" }: Props) {
  const [txs, setTxs] = useState<Tx[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  const [circleWallet, setCircleWallet] = useState<CircleWalletInfo | null>(null);
  const [useCircle, setUseCircle] = useState(false);

  useEffect(() => {
    setCircleWallet(getCircleWallet());
  }, []);

  const isMainnet = network === "mainnet";
  const explorer = isMainnet ? "https://arc.etherscan.io" : "https://testnet.arcscan.app";
  // Circle Wallet only exists on testnet.
  const effectiveAddress = !isMainnet && useCircle && circleWallet ? circleWallet.address : address;

  async function load() {
    if (!effectiveAddress) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/arcscan-proxy?${isMainnet ? "network=mainnet&" : ""}module=account&action=txlist&address=${effectiveAddress}&limit=30`);
      if (!res.ok) throw new Error(`Arcscan returned ${res.status}`);
      const data = await res.json();
      const items: Tx[] = (data.result ?? []).map((tx: any) => ({
        hash: tx.hash,
        method: tx.methodId ?? "0x",
        age: tx.timeStamp ? timeAgo(Number(tx.timeStamp)) : "—",
        from: tx.from ?? "—",
        to: tx.to ?? "—",
        status: tx.txreceipt_status === "1" ? "ok" : tx.txreceipt_status === "0" ? "error" : "pending",
        input: tx.input ?? "0x",
        value: tx.value ?? "0",
      }));
      setTxs(items);
    } catch (e: unknown) {
      const err = e as { message?: string };
      if (err.message?.includes("Arcscan returned")) {
        setError(`Explorer API error (${err.message.replace("Arcscan returned ", "")}) — try again in a moment.`);
      } else if (err.message === "Failed to fetch" || err.message?.toLowerCase().includes("network")) {
        setError("Network error reaching Arc's explorer — check your connection and try again.");
      } else {
        setError("Could not load transactions — Arc RPC or explorer may be temporarily unavailable.");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (effectiveAddress) load(); }, [effectiveAddress, network]);

  function copyHash(hash: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(hash);
    setCopiedHash(hash);
    setTimeout(() => setCopiedHash(null), 1500);
  }

  const filterOptions = ["all", "Send", "Receive", "Swap", "Bridge", "Approve"];
  const filteredTxs = filter === "all" ? txs : txs.filter(tx => metaFor(tx, effectiveAddress).label === filter);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {!isMainnet && circleWallet && (
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => setUseCircle(false)}
            style={{ flex: 1, padding: "0.55rem", borderRadius: 10, border: "none", background: !useCircle ? "#ede9fe" : "#f5f3ff", color: !useCircle ? "#5B21B6" : "#4B5563", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
            Browser Wallet
          </button>
          <button onClick={() => setUseCircle(true)}
            style={{ flex: 1, padding: "0.55rem", borderRadius: 10, border: "none", background: useCircle ? "#ede9fe" : "#f5f3ff", color: useCircle ? "#5B21B6" : "#4B5563", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
            Circle Wallet
          </button>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {filterOptions.map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              style={{
                padding: "5px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer",
                border: "none",
                background: filter === f ? "#ede9fe" : "#f5f3ff",
                color: filter === f ? "#5B21B6" : "#4B5563",
              }}>
              {f === "all" ? "All" : f}
            </button>
          ))}
        </div>
        <button onClick={load} style={{ background: "#f5f3ff", border: "none", borderRadius: 8, padding: "6px 12px", color: "#4B5563", fontSize: 12, cursor: "pointer" }}>↻ Refresh</button>
      </div>

      {loading && (
        <div style={{ background: "#ffffff", borderRadius: 16, overflow: "hidden", boxShadow: "0 1px 3px rgba(124,58,237,0.08)" }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "0.9rem 1rem", borderTop: i > 0 ? "1px solid #F5F3FF" : "none" }}>
              <div style={{ width: 60, height: 12, borderRadius: 6, background: "#F5F3FF" }} />
              <div style={{ flex: 1, height: 12, borderRadius: 6, background: "#F5F3FF" }} />
              <div style={{ width: 50, height: 12, borderRadius: 6, background: "#F5F3FF" }} />
            </div>
          ))}
        </div>
      )}
      {!loading && error && (
        <div style={{ background: "#ffffff", borderRadius: 16, padding: "2.5rem 1.5rem", textAlign: "center", boxShadow: "0 1px 3px rgba(124,58,237,0.08)" }}>
          <div style={{ width: 48, height: 48, borderRadius: "50%", background: "rgba(109,94,247,0.1)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
            <HelpCircle size={22} color="#6D5EF7" />
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", marginBottom: 4 }}>Could not load transactions</div>
          <div style={{ fontSize: 12.5, color: "#6B7280", marginBottom: 16 }}>{error}</div>
          <button onClick={load} style={{ background: "#6D5EF7", border: "none", borderRadius: 10, padding: "0.6rem 1.4rem", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", marginRight: 10 }}>↻ Try again</button>
          {effectiveAddress && (
            <a href={`${explorer}/address/${effectiveAddress}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: "#6D5EF7", fontWeight: 600, textDecoration: "none" }}>Open explorer ↗</a>
          )}
        </div>
      )}
      {!loading && !error && filteredTxs.length === 0 && (
  <EmptyState icon="📭" title="No transactions yet" subtitle="Your activity will show up here once you start using FlowFi" />
)}


      {!loading && filteredTxs.length > 0 && (
        <div style={{ background: "#ffffff", borderRadius: 16, overflow: "hidden" , boxShadow: "0 1px 3px rgba(124,58,237,0.08)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "80px 1fr 90px 60px 70px", gap: 8, padding: "0.6rem 1rem", background: "#f5f3ff", fontSize: 10, color: "#374151", fontWeight: 700, letterSpacing: "0.5px" }}>
            <span>TYPE</span>
            <span>DETAILS</span>
            <span>STATUS</span>
            <span></span>
            <span style={{ textAlign: "right" }}>AGE</span>
          </div>
          {filteredTxs.map((tx) => {
            const meta = metaFor(tx, effectiveAddress);
            const statusMeta = { ok: { label: "Success", color: "#16A34A", dot: "#16A34A" }, pending: { label: "Pending", color: "#B45309", dot: "#f59e0b" }, error: { label: "Failed", color: "#DC2626", dot: "#ef4444" } }[tx.status] ?? { label: "Pending", color: "#B45309", dot: "#f59e0b" };
            return (
              <a key={tx.hash} href={`${explorer}/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer"
                style={{
                  display: "grid", gridTemplateColumns: "80px 1fr 90px 60px 70px", gap: 8, alignItems: "center",
                  padding: "0.75rem 1rem", textDecoration: "none",
                }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: meta.color, background: `${meta.color}1a`, padding: "3px 8px", borderRadius: 6, textAlign: "center", width: "fit-content" }}>
                  {meta.label}
                </span>
                <span style={{ fontSize: 12.5, color: "#111827", fontWeight: 500 }}>{describeTx(tx, effectiveAddress, network)}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, color: statusMeta.color, background: `${statusMeta.dot}1a`, padding: "3px 8px", borderRadius: 6, width: "fit-content" }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: statusMeta.dot }} />
                  {statusMeta.label}
                </span>
                <button onClick={(e) => copyHash(tx.hash, e)} title="Copy hash"
                  style={{ background: "#f5f3ff", border: "none", borderRadius: 6, padding: "3px 8px", color: copiedHash === tx.hash ? "#16A34A" : "#4B5563", fontSize: 11, cursor: "pointer", width: "fit-content" }}>
                  {copiedHash === tx.hash ? "✓" : "⧉"}
                </button>
                <span style={{ fontSize: 11, color: "#374151", textAlign: "right" }}>{tx.age}</span>
              </a>
            );
          })}
        </div>
      )}

      {!loading && txs.length > 0 && (
        <a href={`${explorer}/address/${effectiveAddress}`} target="_blank" rel="noopener noreferrer" style={{ textAlign: "center", color: "#4B5563", fontSize: 12, textDecoration: "none", padding: "0.5rem" }}>
          View all on Explorer ↗
        </a>
      )}
      {!loading && isMainnet && (
        <div style={{ textAlign: "center", color: "#9CA3AF", fontSize: 11.5, lineHeight: 1.5, padding: "0 0.5rem" }}>
          This list shows activity on Arc. The sending half of a bridge from another chain appears on that chain's explorer. Swaps routed through aggregators show as contract interactions.
        </div>
      )}
    </div>
  );
}
