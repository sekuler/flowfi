import EmptyState from "./EmptyState";
import { HelpCircle, ArrowUpRight, ArrowDownLeft, Repeat, Link2, ShieldCheck, Copy, ExternalLink, RefreshCw, Check, CheckCircle2, Clock, XCircle, Route as RouteIcon, ListFilter } from "lucide-react";
import { useState, useEffect, type ReactNode } from "react";
import { getCircleWallet, type CircleWalletInfo } from "../circleWalletHelpers";
import { contactNameFor } from "../contacts";
import { USDC_ADDRESS, EURC_ADDRESS } from "../contracts";
import { ARC_MAINNET_CHAIN_ID } from "../chains";

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
  "0x095ea7b3": { label: "Approve", color: "#D97706" },
  "0x74b30078": { label: "Swap", color: "#7C3AED" },
  "0x9cd441da": { label: "Swap", color: "#7C3AED" },
  "0xe334e8dd": { label: "Escrow", color: "#5B21B6" },
  "0x8e0250ee": { label: "Bridge", color: "#5B21B6" },
  "0x57ecfd28": { label: "Bridge", color: "#5B21B6" },
};

const TYPE_ICON: Record<string, ReactNode> = {
  Send: <ArrowUpRight size={12} />,
  Receive: <ArrowDownLeft size={12} />,
  Swap: <Repeat size={12} />,
  Route: <RouteIcon size={12} />,
  Bridge: <Link2 size={12} />,
  Approve: <ShieldCheck size={12} />,
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

// LI.FI's router ("diamond") contract on Arc, from LI.FI's public chain list. Used only to label
// transactions sent to it as LI.FI routes. Looked up once; if it can't be found, those stay generic.
let diamondPromise: Promise<string | null> | null = null;
function loadLifiDiamond(): Promise<string | null> {
  if (!diamondPromise) {
    diamondPromise = fetch("https://li.quest/v1/chains?chainTypes=EVM")
      .then((r) => r.json())
      .then((d) => {
        const c = (d?.chains ?? []).find((x: { id?: number; diamondAddress?: string }) => x.id === ARC_MAINNET_CHAIN_ID);
        return (c?.diamondAddress as string | undefined)?.toLowerCase() ?? null;
      })
      .catch(() => null);
  }
  return diamondPromise;
}

function timeAgo(sec: number) {
  const diff = Math.floor(Date.now() / 1000) - sec;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function shortAddr(addr: string) {
  return addr.length > 10 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

function shortHash(h: string) {
  return h.length > 12 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h;
}

// Label/color for a transaction. Plain native transfers (empty calldata) are Send or Receive depending on
// direction; only a transaction with no recipient is a contract deployment.
function metaFor(tx: Tx, me: string, diamond: string | null) {
  if (tx.input === "0x" || tx.method === "0x") {
    if (!tx.to || tx.to === "—") return { label: "Deploy", color: "#4B5563" };
    return tx.from.toLowerCase() === me.toLowerCase()
      ? { label: "Send", color: "#16A34A" }
      : { label: "Receive", color: "#0D9488" };
  }
  if (diamond && tx.to.toLowerCase() === diamond) return { label: "Route", color: "#6D5EF7" };
  return METHOD_META[tx.method] ?? { label: "Contract", color: "#6B7280" };
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

function formatAmount(n: number, max = 2): string {
  // Unlimited/near-unlimited approvals show as a word instead of a huge number.
  if (n > 1e12) return "unlimited";
  return n.toLocaleString(undefined, { maximumFractionDigits: max });
}

function nativeValue(tx: Tx): number | null {
  try { return Number(BigInt(tx.value || "0")) / 1e18; } catch { return null; }
}

const tokStyle = { color: "#6D5EF7", fontWeight: 700 } as const;
const addrStyle = { color: "#6D5EF7", fontFamily: "ui-monospace, 'JetBrains Mono', monospace", fontSize: "0.94em" } as const;
const Tok = ({ s }: { s: string }) => <span style={tokStyle}>{s}</span>;
const Addr = ({ a }: { a: string }) => {
  const name = contactNameFor(a);
  return name ? <span style={{ fontWeight: 600 }}>{name}</span> : <span style={addrStyle}>{shortAddr(a)}</span>;
};

// Plain-English description of what a transaction did, decoded from the raw calldata.
function describeTx(tx: Tx, me: string, network: "testnet" | "mainnet", diamond: string | null): ReactNode {
  const tokenSymbol = KNOWN_TOKENS[tx.to.toLowerCase()] ?? "tokens";
  const domainNames = network === "mainnet" ? DOMAIN_NAMES_MAINNET : DOMAIN_NAMES;

  // Plain native USDC transfer (Arc's gas token): no calldata, just a value.
  if (tx.input === "0x" && tx.to && tx.to !== "—") {
    const amt = nativeValue(tx);
    const amtNode = amt !== null && amt > 0 ? <>{formatAmount(amt, 4)} <Tok s="USDC" /></> : <Tok s="USDC" />;
    return tx.from.toLowerCase() !== me.toLowerCase()
      ? <>Received {amtNode} from <Addr a={tx.from} /></>
      : <>Sent {amtNode} to <Addr a={tx.to} /></>;
  }

  if (diamond && tx.to.toLowerCase() === diamond) return <>LI.FI route · contract interaction</>;

  switch (tx.method) {
    case "0xa9059cbb": { // transfer(address,uint256)
      const amount = decodeUint(tx.input, 1);
      const recipient = decodeAddress(tx.input, 0);
      if (amount === null || !recipient) return <>Sent <Tok s={tokenSymbol} /></>;
      return <>Sent {formatAmount(amount)} <Tok s={tokenSymbol} /> to <Addr a={recipient} /></>;
    }
    case "0x095ea7b3": { // approve(address,uint256)
      const amount = decodeUint(tx.input, 1);
      const spender = decodeAddress(tx.input, 0);
      const amtText = amount === null ? "" : `${formatAmount(amount)} `;
      return <>Approved {amtText}<Tok s={tokenSymbol} />{spender ? <> for spender <Addr a={spender} /></> : " for spending"}</>;
    }
    case "0x74b30078": { // swapUsdcToEurc(uint256)
      const amount = decodeUint(tx.input, 0);
      return amount === null ? <>Swapped <Tok s="USDC" /> for <Tok s="EURC" /></> : <>Swapped {formatAmount(amount)} <Tok s="USDC" /> for <Tok s="EURC" /></>;
    }
    case "0x9cd441da": { // swapEurcToUsdc(uint256)
      const amount = decodeUint(tx.input, 0);
      return amount === null ? <>Swapped <Tok s="EURC" /> for <Tok s="USDC" /></> : <>Swapped {formatAmount(amount)} <Tok s="EURC" /> for <Tok s="USDC" /></>;
    }
    case "0x8e0250ee": { // depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)
      const amount = decodeUint(tx.input, 0);
      const domainWord = decodeWord(tx.input, 1);
      const domain = domainWord ? parseInt(domainWord, 16) : null;
      const chainName = domain !== null ? domainNames[domain] : null;
      if (amount === null) return <>Bridged <Tok s="USDC" /> via CCTP</>;
      return chainName ? <>Bridged {formatAmount(amount)} <Tok s="USDC" /> to {chainName}</> : <>Bridged {formatAmount(amount)} <Tok s="USDC" /> via CCTP</>;
    }
    case "0x57ecfd28": // receiveMessage(bytes,bytes): the amount is inside a nested CCTP message body, not decodable from top-level calldata.
      return <>Received bridged <Tok s="USDC" /></>;
    case "0xe334e8dd":
      return <>Escrow transaction</>;
    case "0x":
      return <>Deployed a contract</>;
    default:
      return <>Contract interaction</>;
  }
}

// Amount column: signed for real value movements, plain for approvals, dash when it can't be decoded.
function amountCell(tx: Tx, me: string): { text: string; tone: "in" | "out" | "neutral" } | null {
  const symbol = KNOWN_TOKENS[tx.to.toLowerCase()] ?? "USDC";
  if (tx.input === "0x" && tx.to && tx.to !== "—") {
    const v = nativeValue(tx);
    if (v === null || v <= 0) return null;
    const incoming = tx.from.toLowerCase() !== me.toLowerCase();
    return { text: `${incoming ? "+" : "−"}${formatAmount(v, 4)} USDC`, tone: incoming ? "in" : "out" };
  }
  if (tx.method === "0xa9059cbb") {
    const a = decodeUint(tx.input, 1);
    return a === null ? null : { text: `−${formatAmount(a)} ${symbol}`, tone: "out" };
  }
  if (tx.method === "0x095ea7b3") {
    const a = decodeUint(tx.input, 1);
    return a === null ? null : { text: `${formatAmount(a)} ${symbol}`, tone: "neutral" };
  }
  if (tx.method === "0x74b30078" || tx.method === "0x9cd441da" || tx.method === "0x8e0250ee") {
    const a = decodeUint(tx.input, 0);
    if (a === null) return null;
    return { text: `${formatAmount(a)} ${tx.method === "0x9cd441da" ? "EURC" : "USDC"}`, tone: "neutral" };
  }
  return null;
}

const GRID = "108px minmax(220px, 1fr) 130px 108px 74px 78px";

export default function TxHistory({ address, network = "testnet" }: Props) {
  const [txs, setTxs] = useState<Tx[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const [diamond, setDiamond] = useState<string | null>(null);

  const [circleWallet, setCircleWallet] = useState<CircleWalletInfo | null>(null);
  const [useCircle, setUseCircle] = useState(false);

  useEffect(() => {
    setCircleWallet(getCircleWallet());
  }, []);

  const isMainnet = network === "mainnet";
  const explorer = isMainnet ? "https://arc.etherscan.io" : "https://testnet.arcscan.app";
  // Circle Wallet only exists on testnet.
  const effectiveAddress = !isMainnet && useCircle && circleWallet ? circleWallet.address : address;

  useEffect(() => {
    if (!isMainnet) return;
    let cancelled = false;
    loadLifiDiamond().then((d) => { if (!cancelled) setDiamond(d); });
    return () => { cancelled = true; };
  }, [isMainnet]);

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

  const filterOptions = isMainnet
    ? ["all", "Send", "Receive", "Route", "Bridge", "Approve"]
    : ["all", "Send", "Receive", "Swap", "Bridge", "Approve"];
  const filteredTxs = filter === "all" ? txs : txs.filter((tx) => metaFor(tx, effectiveAddress, diamond).label === filter);

  const statusOf = (s: string) => ({
    ok: { label: "Success", color: "#15803D", icon: <CheckCircle2 size={15} /> },
    pending: { label: "Pending", color: "#B45309", icon: <Clock size={15} /> },
    error: { label: "Failed", color: "#DC2626", icon: <XCircle size={15} /> },
  }[s] ?? { label: "Pending", color: "#B45309", icon: <Clock size={15} /> });

  const card = { background: "#ffffff", border: "1px solid #E4DDFB", borderRadius: 18, boxShadow: "0 8px 30px -12px rgba(109,94,247,0.18)" } as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
      <style>{`
        .ff-tx-row { transition: background 0.15s; }
        .ff-tx-row:hover { background: rgba(109,94,247,0.06); }
        .ff-icon-btn { transition: all 0.15s; }
        .ff-icon-btn:hover { background: #EDE9FE; border-color: #C9BDFB; }
      `}</style>

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

      <div style={{ fontSize: 12.5, color: "#6B7280" }}>
        Recent transactions on Arc{isMainnet ? " Mainnet" : " Testnet"} · sourced from{" "}
        <a href={explorer} target="_blank" rel="noopener noreferrer" style={{ color: "#6D5EF7", fontWeight: 600, textDecoration: "none" }}>{explorer.replace("https://", "")}</a>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {filterOptions.map((f) => {
            const on = filter === f;
            return (
              <button key={f} onClick={() => setFilter(f)}
                style={{
                  display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 12, fontSize: 12.5, fontWeight: 700, cursor: "pointer",
                  border: on ? "1px solid transparent" : "1px solid #E4DDFB",
                  background: on ? "linear-gradient(135deg,#4F46E5,#7C3AED)" : "#ffffff",
                  color: on ? "#ffffff" : "#4B5563",
                  boxShadow: on ? "0 6px 16px rgba(109,94,247,0.35)" : "none",
                  transition: "all 0.15s",
                }}>
                {f === "all" ? <ListFilter size={13} /> : TYPE_ICON[f]}
                {f === "all" ? "All" : f}
              </button>
            );
          })}
        </div>
        <button onClick={load} className="ff-icon-btn"
          style={{ display: "flex", alignItems: "center", gap: 6, background: "#ffffff", border: "1px solid #E4DDFB", borderRadius: 12, padding: "7px 14px", color: "#4B5563", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {loading && (
        <div style={{ ...card, overflow: "hidden" }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "1rem 1.1rem", borderTop: i > 0 ? "1px solid #F5F3FF" : "none" }}>
              <div style={{ width: 70, height: 22, borderRadius: 8, background: "#F5F3FF" }} />
              <div style={{ flex: 1, height: 12, borderRadius: 6, background: "#F5F3FF" }} />
              <div style={{ width: 60, height: 12, borderRadius: 6, background: "#F5F3FF" }} />
            </div>
          ))}
        </div>
      )}
      {!loading && error && (
        <div style={{ ...card, padding: "2.5rem 1.5rem", textAlign: "center" }}>
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
        <div style={{ ...card, overflow: "hidden" }}>
          <div style={{ overflow: "auto", maxHeight: "70vh" }}>
            <div style={{ minWidth: 720 }}>
              <div style={{ position: "sticky", top: 0, zIndex: 2, display: "grid", gridTemplateColumns: GRID, gap: 10, padding: "0.75rem 1.1rem", background: "#F8F7FF", borderBottom: "1px solid #E4DDFB", fontSize: 10.5, color: "#6B7280", fontWeight: 800, letterSpacing: "0.6px" }}>
                <span>TYPE</span>
                <span>DETAILS</span>
                <span style={{ textAlign: "right" }}>AMOUNT</span>
                <span>STATUS</span>
                <span style={{ textAlign: "right" }}>AGE</span>
                <span style={{ textAlign: "right" }}>ACTIONS</span>
              </div>
              {filteredTxs.map((tx) => {
                const meta = metaFor(tx, effectiveAddress, diamond);
                const st = statusOf(tx.status);
                const amt = amountCell(tx, effectiveAddress);
                const amtColor = amt?.tone === "in" ? "#15803D" : "#111827";
                return (
                  <div key={tx.hash} className="ff-tx-row"
                    style={{ display: "grid", gridTemplateColumns: GRID, gap: 10, alignItems: "center", padding: "0.85rem 1.1rem", borderTop: "1px solid #F5F3FF" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 800, color: meta.color, background: `${meta.color}1a`, border: `1px solid ${meta.color}33`, padding: "4px 10px", borderRadius: 8, width: "fit-content" }}>
                      {TYPE_ICON[meta.label]}{meta.label}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 13, color: "#111827", fontWeight: 500, lineHeight: 1.4 }}>{describeTx(tx, effectiveAddress, network, diamond)}</span>
                      <span style={{ display: "block", fontSize: 11.5, color: "#9CA3AF", marginTop: 2, fontFamily: "ui-monospace, 'JetBrains Mono', monospace" }}>{shortHash(tx.hash)} · {tx.age}</span>
                    </span>
                    <span style={{ textAlign: "right", fontSize: 13, fontWeight: 700, color: amt ? amtColor : "#9CA3AF", fontVariantNumeric: "tabular-nums", fontFamily: "ui-monospace, 'JetBrains Mono', monospace" }}>
                      {amt ? amt.text : "—"}
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, color: st.color }}>
                      {st.icon}{st.label}
                    </span>
                    <span style={{ textAlign: "right", fontSize: 12, color: "#6B7280" }}>{tx.age}</span>
                    <span style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                      <button onClick={(e) => copyHash(tx.hash, e)} title="Copy hash" className="ff-icon-btn"
                        style={{ width: 30, height: 30, borderRadius: 9, border: "1px solid #E4DDFB", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: copiedHash === tx.hash ? "#16A34A" : "#4B5563" }}>
                        {copiedHash === tx.hash ? <Check size={14} /> : <Copy size={14} />}
                      </button>
                      <a href={`${explorer}/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer" title="Open in explorer" className="ff-icon-btn"
                        style={{ width: 30, height: 30, borderRadius: 9, border: "1px solid #E4DDFB", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", color: "#4B5563" }}>
                        <ExternalLink size={14} />
                      </a>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {!loading && txs.length > 0 && (
        <a href={`${explorer}/address/${effectiveAddress}`} target="_blank" rel="noopener noreferrer" style={{ textAlign: "center", color: "#4B5563", fontSize: 12, textDecoration: "none", padding: "0.25rem" }}>
          View all on Explorer ↗
        </a>
      )}
      {!loading && isMainnet && (
        <div style={{ borderLeft: "3px solid #F59E0B", paddingLeft: 10, color: "#6B7280", fontSize: 12 }}>
          The source-chain leg of a bridge appears on that chain's explorer.
        </div>
      )}
    </div>
  );
}
