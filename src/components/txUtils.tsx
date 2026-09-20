import type { ReactNode } from "react";
import { ArrowUpRight, ArrowDownLeft, Repeat, Link2, ShieldCheck, Route as RouteIcon } from "lucide-react";
import { contactNameFor } from "../contacts";
import { USDC_ADDRESS, EURC_ADDRESS } from "../contracts";
import { ARC_MAINNET_CHAIN_ID } from "../chains";

// One token movement in or out of the user's address, from the explorer's token-transfer list.
export interface Transfer {
  symbol: string;
  amount: number;
  dir: "in" | "out";
  counterparty: string;
}

export interface Tx {
  hash: string;
  method: string;
  age: string;
  ts: number;
  from: string;
  to: string;
  status: string;
  input: string;
  value: string;
  transfers?: Transfer[];
}

// Adds up a transaction's token movements per token and direction (a swap can be split across several transfers).
function summarize(tx: Tx) {
  const groups = new Map<string, Transfer>();
  for (const t of tx.transfers ?? []) {
    const key = t.dir + t.symbol;
    const g = groups.get(key);
    if (g) g.amount += t.amount;
    else groups.set(key, { ...t });
  }
  const all = [...groups.values()];
  return { ins: all.filter((g) => g.dir === "in"), outs: all.filter((g) => g.dir === "out") };
}
const BRIDGE_METHODS = ["0x57ecfd28", "0x8e0250ee"];


const KNOWN_TOKENS: Record<string, string> = {
  [USDC_ADDRESS.toLowerCase()]: "USDC",
  [EURC_ADDRESS.toLowerCase()]: "EURC",
  "0x3600000000000000000000000000000000000000": "USDC", // Arc Mainnet USDC
  "0xbef5f6d51cb62b58e6a8f77868681825c6fe21c1": "EURC", // Arc Mainnet EURC
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

export const TYPE_ICON: Record<string, ReactNode> = {
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
// LiFiDiamond on Arc, from LI.FI's public deployment list (lifinance/contracts, deployments/arc.json).
// Used when LI.FI's chain list doesn't include a diamondAddress for Arc.
const LIFI_DIAMOND_ARC = "0xa4072583658fae592a3506a42431cb6316a8d40b";

let diamondPromise: Promise<string | null> | null = null;
export function loadLifiDiamond(): Promise<string | null> {
  if (!diamondPromise) {
    diamondPromise = fetch("https://li.quest/v1/chains?chainTypes=EVM")
      .then((r) => r.json())
      .then((d) => {
        const c = (d?.chains ?? []).find((x: { id?: number; diamondAddress?: string }) => x.id === ARC_MAINNET_CHAIN_ID);
        return (c?.diamondAddress as string | undefined)?.toLowerCase() ?? LIFI_DIAMOND_ARC;
      })
      .catch(() => LIFI_DIAMOND_ARC);
  }
  return diamondPromise;
}

export function timeAgo(sec: number) {
  const diff = Math.floor(Date.now() / 1000) - sec;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function shortAddr(addr: string) {
  return addr.length > 10 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

export function shortHash(h: string) {
  return h.length > 12 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h;
}

// Label/color for a transaction. Plain native transfers (empty calldata) are Send or Receive depending on
// direction; only a transaction with no recipient is a contract deployment.
export function metaFor(tx: Tx, me: string, diamond: string | null) {
  if (tx.transfers?.length && !BRIDGE_METHODS.includes(tx.method)) {
    const { ins, outs } = summarize(tx);
    if (ins.length && outs.length) return { label: "Swap", color: "#7C3AED" };
    if (diamond && tx.to.toLowerCase() === diamond) return { label: "Route", color: "#6D5EF7" };
    if (ins.length) return { label: "Receive", color: "#0D9488" };
    if (outs.length) return { label: "Send", color: "#16A34A" };
  }
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

export function formatAmount(n: number, max = 2): string {
  // Unlimited/near-unlimited approvals show as a word instead of a huge number.
  if (n > 1e12) return "unlimited";
  return n.toLocaleString("en-US", { maximumFractionDigits: max });
}

export function nativeValue(tx: Tx): number | null {
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
// compact = leave the counterparty out of the text (for rows that show it on a second line).
export function describeTx(tx: Tx, me: string, network: "testnet" | "mainnet", diamond: string | null, compact = false): ReactNode {
  const tokenSymbol = KNOWN_TOKENS[tx.to.toLowerCase()] ?? "tokens";
  const domainNames = network === "mainnet" ? DOMAIN_NAMES_MAINNET : DOMAIN_NAMES;

  // Token movements from the explorer describe what actually happened (swaps, incoming tokens, bridge mints).
  if (tx.transfers?.length) {
    const { ins, outs } = summarize(tx);
    if (tx.method === "0x57ecfd28" && ins.length) return <>Received bridged {formatAmount(ins[0].amount, 4)} <Tok s={ins[0].symbol} /></>;
    if (!BRIDGE_METHODS.includes(tx.method)) {
      if (ins.length && outs.length) return <>Swapped {formatAmount(outs[0].amount, 4)} <Tok s={outs[0].symbol} /> for {formatAmount(ins[0].amount, 4)} <Tok s={ins[0].symbol} /></>;
      if (diamond && tx.to.toLowerCase() === diamond && outs.length) return <>LI.FI route · sent {formatAmount(outs[0].amount, 4)} <Tok s={outs[0].symbol} /></>;
      if (ins.length) {
        return compact
          ? <>Received {formatAmount(ins[0].amount, 4)} <Tok s={ins[0].symbol} /></>
          : <>Received {formatAmount(ins[0].amount, 4)} <Tok s={ins[0].symbol} /> from <Addr a={ins[0].counterparty} /></>;
      }
      if (outs.length) {
        return compact
          ? <>Sent {formatAmount(outs[0].amount, 4)} <Tok s={outs[0].symbol} /></>
          : <>Sent {formatAmount(outs[0].amount, 4)} <Tok s={outs[0].symbol} /> to <Addr a={outs[0].counterparty} /></>;
      }
    }
  }

  // Plain native USDC transfer (Arc's gas token): no calldata, just a value.
  if (tx.input === "0x" && tx.to && tx.to !== "—") {
    const amt = nativeValue(tx);
    const amtNode = amt !== null && amt > 0 ? <>{formatAmount(amt, 4)} <Tok s="USDC" /></> : <Tok s="USDC" />;
    const incoming = tx.from.toLowerCase() !== me.toLowerCase();
    if (compact) return incoming ? <>Received {amtNode}</> : <>Sent {amtNode}</>;
    return incoming
      ? <>Received {amtNode} from <Addr a={tx.from} /></>
      : <>Sent {amtNode} to <Addr a={tx.to} /></>;
  }

  if (diamond && tx.to.toLowerCase() === diamond) return <>LI.FI route · contract interaction</>;

  switch (tx.method) {
    case "0xa9059cbb": { // transfer(address,uint256)
      const amount = decodeUint(tx.input, 1);
      const recipient = decodeAddress(tx.input, 0);
      if (amount === null || !recipient) return <>Sent <Tok s={tokenSymbol} /></>;
      if (compact) return <>Sent {formatAmount(amount)} <Tok s={tokenSymbol} /></>;
      return <>Sent {formatAmount(amount)} <Tok s={tokenSymbol} /> to <Addr a={recipient} /></>;
    }
    case "0x095ea7b3": { // approve(address,uint256)
      const amount = decodeUint(tx.input, 1);
      const spender = decodeAddress(tx.input, 0);
      const amtText = amount === null ? "" : `${formatAmount(amount)} `;
      if (compact) return <>Approved {amtText}<Tok s={tokenSymbol} /> spend</>;
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
export function amountCell(tx: Tx, me: string): { text: string; tone: "in" | "out" | "neutral" } | null {
  if (tx.transfers?.length && tx.method !== "0x8e0250ee") {
    const { ins, outs } = summarize(tx);
    if (ins.length) return { text: `+${formatAmount(ins[0].amount, 4)} ${ins[0].symbol}`, tone: "in" };
    if (outs.length) return { text: `−${formatAmount(outs[0].amount, 4)} ${outs[0].symbol}`, tone: "out" };
  }
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



// Raw explorer item -> Tx.
export function toTx(tx: any): Tx {
  return {
    hash: tx.hash,
    method: tx.methodId ?? "0x",
    age: tx.timeStamp ? timeAgo(Number(tx.timeStamp)) : "—",
    ts: Number(tx.timeStamp ?? 0),
    from: tx.from ?? "—",
    to: tx.to ?? "—",
    status: tx.txreceipt_status === "1" ? "ok" : tx.txreceipt_status === "0" ? "error" : "pending",
    input: tx.input ?? "0x",
    value: tx.value ?? "0",
  };
}

// Token this transaction is about, for an "Asset" column (null when it can't be told).
export function assetOf(tx: Tx): string | null {
  if (tx.transfers?.length) {
    const { ins, outs } = summarize(tx);
    return (ins[0] ?? outs[0])?.symbol ?? null;
  }
  if (tx.input === "0x" && tx.to && tx.to !== "—") return nativeValue(tx) ? "USDC" : null;
  const sym = KNOWN_TOKENS[tx.to.toLowerCase()];
  return sym ?? null;
}

// Short "From 0x1a…b2c3" / "To 0x…" / "Spender 0x…" text for a table cell.
export function counterpartOf(tx: Tx, me: string): string {
  const isMe = (a: string) => a.toLowerCase() === me.toLowerCase();
  const nice = (a: string) => contactNameFor(a) ?? shortAddr(a);
  if (tx.transfers?.length && !BRIDGE_METHODS.includes(tx.method)) {
    const { ins, outs } = summarize(tx);
    if (ins.length && outs.length) return tx.to && tx.to !== "—" && !isMe(tx.to) ? `Via ${nice(tx.to)}` : "Swap";
    if (ins.length) return `From ${nice(ins[0].counterparty)}`;
    if (outs.length) return `To ${nice(outs[0].counterparty)}`;
  }
  if (tx.input === "0x" && tx.to && tx.to !== "—") return isMe(tx.from) ? `To ${nice(tx.to)}` : `From ${nice(tx.from)}`;
  if (tx.method === "0x095ea7b3") {
    const w = decodeAddress(tx.input, 0);
    return w ? `Spender ${nice(w)}` : "—";
  }
  if (tx.method === "0xa9059cbb") {
    const w = decodeAddress(tx.input, 0);
    return w ? `To ${nice(w)}` : "—";
  }
  return isMe(tx.from) ? (tx.to && tx.to !== "—" ? `To ${nice(tx.to)}` : "—") : `From ${nice(tx.from)}`;
}

const NATIVE_PSEUDO_TOKEN = "0xfffffffffffffffffffffffffffffffffffffffe";

// The user's activity on Arc: normal transactions merged with token transfers, newest first.
// A swap done through another app (Relay, for example) is often sent by that app's own address, so it only
// shows up as tokens leaving and arriving at the user's address, never as a transaction the user sent.
export async function fetchActivity(address: string, network: "testnet" | "mainnet", limit: number): Promise<Tx[]> {
  const base = `/api/arcscan-proxy?${network === "mainnet" ? "network=mainnet&" : ""}module=account`;
  const paging = `sort=desc&page=1&offset=${limit}&limit=${limit}`;
  const [txRes, tokRes] = await Promise.all([
    fetch(`${base}&action=txlist&address=${address}&${paging}`),
    fetch(`${base}&action=tokentx&address=${address}&${paging}`).catch(() => null),
  ]);
  if (!txRes.ok) throw new Error(`Arcscan returned ${txRes.status}`);
  const txData = await txRes.json();
  const rawTx: any[] = Array.isArray(txData.result) ? txData.result : [];

  let rawTok: any[] = [];
  try {
    if (tokRes && tokRes.ok) {
      const d = await tokRes.json();
      if (Array.isArray(d.result)) rawTok = d.result;
    }
  } catch { /* token transfers are an extra; the page still works without them */ }

  const me = address.toLowerCase();
  const items = new Map<string, Tx>();
  for (const raw of rawTx) items.set(raw.hash, toTx(raw));

  for (const t of rawTok) {
    const from = String(t.from ?? "").toLowerCase();
    const to = String(t.to ?? "").toLowerCase();
    if (from !== me && to !== me) continue;
    // Arc also reports native USDC movements as transfers of a pseudo-token at 0xff…fe (18 decimals, no symbol).
    // The same movement already appears as a normal USDC transfer, so this duplicate is skipped.
    if (String(t.contractAddress ?? "").toLowerCase() === NATIVE_PSEUDO_TOKEN || !t.tokenSymbol || t.tokenDecimal === undefined || t.tokenDecimal === "") continue;
    let amount: number;
    try { amount = Number(BigInt(t.value)) / 10 ** Number(t.tokenDecimal); } catch { continue; }
    const dir: "in" | "out" = to === me ? "in" : "out";
    const transfer: Transfer = { symbol: t.tokenSymbol, amount, dir, counterparty: dir === "in" ? t.from : t.to };
    let tx = items.get(t.hash);
    if (!tx) {
      tx = {
        hash: t.hash, method: "0x", age: t.timeStamp ? timeAgo(Number(t.timeStamp)) : "—", ts: Number(t.timeStamp ?? 0),
        from: t.from ?? "—", to: t.to ?? "—", status: "ok", input: "0x", value: "0",
      };
      items.set(t.hash, tx);
    }
    tx.transfers = [...(tx.transfers ?? []), transfer];
  }

  return [...items.values()].sort((a, b) => b.ts - a.ts).slice(0, limit);
}
