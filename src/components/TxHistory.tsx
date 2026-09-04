import EmptyState from "./EmptyState";
import { useState, useEffect } from "react";
import { getCircleWallet, type CircleWalletInfo } from "../circleWalletHelpers";
import { contactNameFor } from "../contacts";

interface Tx {
  hash: string;
  method: string;
  age: string;
  from: string;
  to: string;
  status: string;
  input: string;
}

interface Props {
  address: string;
}

const KNOWN_TOKENS: Record<string, string> = {
  "0x3600000000000000000000000000000000000000": "USDC",
  "0x89b50855aa3be2f677cd6303cec089b5f319d72a": "EURC",
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

function timeAgo(sec: number) {
  const diff = Math.floor(Date.now() / 1000) - sec;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function methodMeta(methodId: string) {
  return METHOD_META[methodId] ?? { label: "Transfer", color: "#6B7280" };
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
function describeTx(tx: Tx): string {
  const tokenSymbol = KNOWN_TOKENS[tx.to.toLowerCase()] ?? "tokens";

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
      const chainName = domain !== null ? DOMAIN_NAMES[domain] : null;
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

export default function TxHistory({ address }: Props) {
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

  const effectiveAddress = useCircle && circleWallet ? circleWallet.address : address;

  async function load() {
    if (!effectiveAddress) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/arcscan-proxy?module=account&action=txlist&address=${effectiveAddress}&limit=30`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      const items: Tx[] = (data.result ?? []).map((tx: any) => ({
        hash: tx.hash,
        method: tx.methodId ?? "0x",
        age: tx.timeStamp ? timeAgo(Number(tx.timeStamp)) : "—",
        from: tx.from ?? "—",
        to: tx.to ?? "—",
        status: tx.txreceipt_status === "1" ? "ok" : tx.txreceipt_status === "0" ? "error" : "pending",
        input: tx.input ?? "0x",
      }));
      setTxs(items);
    } catch {
      setError("Could not load transactions.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (effectiveAddress) load(); }, [effectiveAddress]);

  function copyHash(hash: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(hash);
    setCopiedHash(hash);
    setTimeout(() => setCopiedHash(null), 1500);
  }

  const filterOptions = ["all", "Send", "Swap", "Bridge", "Approve", "Escrow"];
  const filteredTxs = filter === "all" ? txs : txs.filter(tx => methodMeta(tx.method).label === filter);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {circleWallet && (
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

      {loading && <div style={{ textAlign: "center", padding: "3rem", color: "#374151", fontSize: 13 }}>Loading transactions...</div>}
      {error && <div style={{ background: "rgba(239,68,68,0.12)", borderRadius: 10, padding: "1rem", color: "#DC2626", fontSize: 13 }}>{error}</div>}
      {!loading && !error && filteredTxs.length === 0 && (
  <EmptyState icon="📭" title="No transactions found" subtitle="Your activity will show up here once you start using FlowFi" />
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
            const meta = methodMeta(tx.method);
            const statusMeta = { ok: { label: "Success", color: "#16A34A", dot: "#16A34A" }, pending: { label: "Pending", color: "#B45309", dot: "#f59e0b" }, error: { label: "Failed", color: "#DC2626", dot: "#ef4444" } }[tx.status] ?? { label: "Pending", color: "#B45309", dot: "#f59e0b" };
            return (
              <a key={tx.hash} href={`https://testnet.arcscan.app/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer"
                style={{
                  display: "grid", gridTemplateColumns: "80px 1fr 90px 60px 70px", gap: 8, alignItems: "center",
                  padding: "0.75rem 1rem", textDecoration: "none",
                }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: meta.color, background: `${meta.color}1a`, padding: "3px 8px", borderRadius: 6, textAlign: "center", width: "fit-content" }}>
                  {meta.label}
                </span>
                <span style={{ fontSize: 12.5, color: "#111827", fontWeight: 500 }}>{describeTx(tx)}</span>
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
        <a href={`https://testnet.arcscan.app/address/${effectiveAddress}`} target="_blank" rel="noopener noreferrer" style={{ textAlign: "center", color: "#4B5563", fontSize: 12, textDecoration: "none", padding: "0.5rem" }}>
          View all on Explorer ↗
        </a>
      )}
    </div>
  );
}
