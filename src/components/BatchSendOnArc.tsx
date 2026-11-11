import { useState, useEffect, useRef } from "react";
import { useTxFeature } from "../txTracking";
import { createPublicClient, createWalletClient, custom, http, erc20Abi, formatUnits, parseUnits, isAddress, getAddress } from "viem";
import type { EIP1193Provider } from "viem";
import { Check, AlertTriangle, Upload } from "lucide-react";
import { arcMainnet, ARC_MAINNET_CHAIN_ID_HEX } from "../chains";
import { TokenIcon } from "./TokenIcon";

// Batch payment on Arc Mainnet: send USDC, EURC or cirBTC to up to 200 addresses in one transaction.
// Uses FlowFiMultiSend (contracts/mainnet/FlowFiMultiSend.sol): tokens move straight from the user's wallet
// to each recipient, the contract never holds funds, has no owner and charges no fee. The user approves
// exactly the batch total, so no allowance is left behind.

export const MULTISEND = "0xE1aec7Af5dA3b981a8e627FFaDC9b980C499b761" as const;
const MAX_RECIPIENTS = 200;
const USDC_GAS_BUFFER = 0.05; // USDC also pays gas on Arc; a large batch costs more gas than a single transfer
const LINE = "#E7E4DD";
const MUTED = "#6B7280";
const INK = "#111827";
const BLUE = "#3D5AF1";

type Tok = { symbol: "USDC" | "EURC" | "cirBTC"; address: `0x${string}`; decimals: number };
const TOKENS: Tok[] = [
  { symbol: "USDC", address: "0x3600000000000000000000000000000000000000", decimals: 6 },
  { symbol: "EURC", address: "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1", decimals: 6 },
  { symbol: "cirBTC", address: "0x171A4217b86A807A64eB94757Db6849fb4bDbAA0", decimals: 8 },
];

const multiSendAbi = [
  {
    type: "function", name: "multiSend", stateMutability: "nonpayable",
    inputs: [{ name: "token", type: "address" }, { name: "recipients", type: "address[]" }, { name: "amounts", type: "uint256[]" }],
    outputs: [],
  },
] as const;

const pc = createPublicClient({ chain: arcMainnet, transport: http() });

async function switchToArc(provider: EIP1193Provider) {
  const cur = (await provider.request({ method: "eth_chainId" })) as string;
  if (cur.toLowerCase() === ARC_MAINNET_CHAIN_ID_HEX.toLowerCase()) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC_MAINNET_CHAIN_ID_HEX }] });
  } catch (e: unknown) {
    if ((e as { code?: number }).code !== 4902) throw e;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{ chainId: ARC_MAINNET_CHAIN_ID_HEX, chainName: "Arc", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: ["https://rpc.mainnet.arc.io"], blockExplorerUrls: ["https://arc.etherscan.io"] }],
    });
  }
}

type Row = { line: number; address?: `0x${string}`; amount?: bigint; error?: string };

function parseAmount(v: string, decimals: number): bigint | null {
  const t = v.trim().replace(",", ".");
  if (!t) return null;
  try { return parseUnits(t, decimals); } catch { return null; }
}

function checkAddr(a: string, self: string): { addr?: `0x${string}`; error?: string } {
  if (!isAddress(a)) return { error: "Not a valid address" };
  const addr = getAddress(a);
  if (addr.toLowerCase() === self.toLowerCase()) return { error: "This is your own address" };
  if (TOKENS.some((t) => t.address.toLowerCase() === addr.toLowerCase())) return { error: "This is a token contract, not a wallet" };
  return { addr };
}

// Same amount for everyone: paste addresses in any layout (one per line, or separated by commas/spaces).
function parseEqual(text: string, amount: bigint | null, self: string): Row[] {
  const rows: Row[] = [];
  text.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean).forEach((a, i) => {
    const row: Row = { line: i + 1 };
    const { addr, error } = checkAddr(a, self);
    if (error) { row.error = `"${a.length > 14 ? a.slice(0, 12) + "…" : a}": ${error}`; rows.push(row); return; }
    row.address = addr;
    if (amount !== null && amount > 0n) row.amount = amount;
    rows.push(row);
  });
  return rows;
}

// True when the list looks like "address, amount" lines (e.g. a CSV), so it belongs in Custom amounts.
function hasAmounts(text: string): boolean {
  return text.split(/\r?\n/).some((raw) => {
    const parts = raw.trim().split(/[\s,;]+/).filter(Boolean);
    return parts.length === 2 && isAddress(parts[0]) && /^\d+([.,]\d+)?$/.test(parts[1]);
  });
}

// Custom amounts: one recipient per line, "address, amount". Comma, semicolon, tab or spaces all work.
function parse(text: string, token: Tok, self: string): Row[] {
  const rows: Row[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const parts = line.split(/[\s,;]+/).filter(Boolean);
    const row: Row = { line: i + 1 };
    if (parts.length !== 2) { row.error = "Use the format: address, amount"; rows.push(row); return; }
    const [a, amt] = parts;
    const { addr, error } = checkAddr(a, self);
    if (error || !addr) { row.error = error; rows.push(row); return; }
    let v: bigint;
    try { v = parseUnits(amt.replace(",", "."), token.decimals); } catch { row.error = "Not a valid amount"; rows.push(row); return; }
    if (v <= 0n) { row.error = "Amount must be more than 0"; rows.push(row); return; }
    row.address = addr; row.amount = v;
    rows.push(row);
  });
  return rows;
}

type Step = "idle" | "confirm" | "approving" | "sending" | "done" | "error";

export default function BatchSendOnArc({ address, provider }: { address: string; provider?: EIP1193Provider }) {
  useTxFeature("batch-send");
  const [token, setToken] = useState<Tok>(TOKENS[0]);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"equal" | "custom">("equal");
  const [each, setEach] = useState("");
  const [balance, setBalance] = useState<bigint | undefined>(undefined);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setBalance(undefined);
    pc.readContract({ address: token.address, abi: erc20Abi, functionName: "balanceOf", args: [address as `0x${string}`] })
      .then((v) => { if (!cancelled) setBalance(v); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [token, address, refresh]);

  const eachRaw = parseAmount(each, token.decimals);
  const pairsInEqual = mode === "equal" && hasAmounts(text);
  const rows = pairsInEqual ? [] : mode === "equal" ? parseEqual(text, eachRaw, address) : parse(text, token, address);
  const good = rows.filter((r) => !r.error && r.amount !== undefined) as Required<Pick<Row, "line" | "address" | "amount">>[];
  const bad = rows.filter((r) => r.error);
  const validCount = rows.length - bad.length;
  const total = good.reduce((s, r) => s + r.amount, 0n);
  const dupeSet = new Set<string>(); const seenSet = new Set<string>();
  good.forEach((r) => { const k = r.address.toLowerCase(); if (seenSet.has(k)) dupeSet.add(k); seenSet.add(k); });
  const dupes = dupeSet.size;

  const fmt = (v: bigint) => Number(formatUnits(v, token.decimals)).toLocaleString("en-US", { maximumFractionDigits: Math.min(token.decimals, 6) });
  const tooMany = good.length > MAX_RECIPIENTS;
  const tooMuch = balance !== undefined && total > balance;
  const gasLow = token.symbol === "USDC" && balance !== undefined && !tooMuch && good.length > 0 && Number(formatUnits(balance - total, 6)) < USDC_GAS_BUFFER;

  let problem: string | null = null;
  if (mode === "equal" && rows.length > 0 && (eachRaw === null || eachRaw <= 0n)) problem = "Enter the amount each person gets.";
  else if (bad.length) problem = `Fix ${bad.length} ${mode === "equal" ? "address" : "line"}${bad.length > 1 ? (mode === "equal" ? "es" : "s") : ""} below before sending.`;
  else if (tooMany) problem = `Up to ${MAX_RECIPIENTS} recipients per batch. You have ${good.length}.`;
  else if (tooMuch) problem = `Not enough ${token.symbol}. You need ${fmt(total)}, you have ${fmt(balance!)}.`;
  const ready = good.length > 0 && !bad.length && !tooMany && !tooMuch;
  const busy = step === "approving" || step === "sending";

  function downloadSample() {
    const sample = "0x1111111111111111111111111111111111111111, 25\n0x2222222222222222222222222222222222222222, 10.5\n0x3333333333333333333333333333333333333333, 3\n";
    const url = URL.createObjectURL(new Blob([sample], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = "flowfi-batch-sample.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  function onFile(f: File | undefined) {
    if (!f) return;
    f.text().then((t) => { setText(t.trim()); if (hasAmounts(t)) setMode("custom"); setStep("idle"); }).catch(() => setError("Could not read that file."));
  }

  async function send() {
    if (!provider || !ready) return;
    setError(null); setTxHash(null);
    try {
      await switchToArc(provider);
      const account = address as `0x${string}`;
      const wc = createWalletClient({ account, chain: arcMainnet, transport: custom(provider) });
      const recipients = good.map((r) => r.address);
      const amounts = good.map((r) => r.amount);

      // 1) Approve exactly the batch total (skip if an allowance already covers it).
      const allowance = await pc.readContract({ address: token.address, abi: erc20Abi, functionName: "allowance", args: [account, MULTISEND] });
      if (allowance < total) {
        setStep("approving");
        const ah = await wc.writeContract({ address: token.address, abi: erc20Abi, functionName: "approve", args: [MULTISEND, total] });
        const ar = await pc.waitForTransactionReceipt({ hash: ah });
        if (ar.status === "reverted") throw new Error("The approval failed. Nothing was sent.");
      }

      // 2) Simulate, then send the batch.
      setStep("sending");
      const { request } = await pc.simulateContract({ account, address: MULTISEND, abi: multiSendAbi, functionName: "multiSend", args: [token.address, recipients, amounts] });
      const h = await wc.writeContract(request);
      setTxHash(h);
      const r = await pc.waitForTransactionReceipt({ hash: h });
      if (r.status === "reverted") throw new Error("The batch reverted onchain. Nothing was sent.");
      setStep("done");
      setRefresh((n) => n + 1);
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string };
      const msg = err.shortMessage || err.message || "Something went wrong.";
      setError(/blacklist|blocked/i.test(msg) ? "One of the recipients can't receive this token. Remove it and try again. Nothing was sent." : msg);
      setStep("error");
    }
  }

  function reset() { setStep("idle"); setText(""); setEach(""); setTxHash(null); setError(null); }

  const card: React.CSSProperties = { maxWidth: 480, margin: "0 auto", background: "#fff", border: `1px solid ${LINE}`, borderRadius: 28, padding: "1.25rem", boxShadow: "0 24px 60px -16px rgba(61,90,241,0.18)" };
  const box: React.CSSProperties = { background: "#F7F8FF", border: `1px solid ${LINE}`, borderRadius: 18, padding: "0.85rem 1rem" };

  if (step === "done") {
    return (
      <div style={{ ...card, textAlign: "center", padding: "2rem 1.25rem" }}>
        <div style={{ width: 52, height: 52, borderRadius: "50%", background: "#DCFCE7", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}><Check size={26} color="#16A34A" /></div>
        <div style={{ fontSize: 18, fontWeight: 800, color: INK }}>Batch sent</div>
        <div style={{ fontSize: 13.5, color: MUTED, margin: "6px 0 16px" }}>{fmt(total)} {token.symbol} to {good.length} recipient{good.length > 1 ? "s" : ""} in one transaction</div>
        {txHash && <a href={`https://arc.etherscan.io/tx/${txHash}`} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: BLUE, fontWeight: 700 }}>View on ArcScan ↗</a>}
        <button onClick={reset} style={{ display: "block", width: "100%", marginTop: 18, padding: "0.85rem", borderRadius: 16, border: "none", background: BLUE, color: "#fff", fontWeight: 800, fontSize: 14, cursor: "pointer" }}>New batch</button>
      </div>
    );
  }

  return (
    <div style={card}>
      <style>{`.ff-batch-in, .ff-batch-in:focus { outline: none !important; box-shadow: none !important; border: none !important; background: transparent !important; }`}</style>
      <div style={{ fontSize: 16, fontWeight: 800, color: INK, marginBottom: 2 }}>Batch payment</div>
      <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 14 }}>Pay up to {MAX_RECIPIENTS} people in one transaction. Great for payroll, rewards and giveaway winners.</div>

      {/* Token */}
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        {TOKENS.map((t) => (
          <button key={t.symbol} onClick={() => { setToken(t); setStep("idle"); }} disabled={busy}
            style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "0.6rem", borderRadius: 14, cursor: "pointer", fontWeight: 800, fontSize: 13.5,
              border: `1px solid ${token.symbol === t.symbol ? BLUE : LINE}`, background: token.symbol === t.symbol ? "#EEF1FE" : "#fff", color: INK }}>
            <TokenIcon symbol={t.symbol} size={18} /> {t.symbol}
          </button>
        ))}
      </div>

      {/* Mode */}
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {(["equal", "custom"] as const).map((m) => (
          <button key={m} onClick={() => { setMode(m); setStep("idle"); }} disabled={busy}
            style={{ flex: 1, padding: "0.5rem", borderRadius: 12, cursor: "pointer", fontWeight: 700, fontSize: 12.5,
              border: `1px solid ${mode === m ? BLUE : LINE}`, background: mode === m ? "#EEF1FE" : "#fff", color: INK }}>
            {m === "equal" ? "Same amount for everyone" : "Custom amounts"}
          </button>
        ))}
      </div>

      {mode === "equal" && (
        <div style={{ ...box, marginBottom: 10 }}>
          <div style={{ fontSize: 11.5, color: MUTED, fontWeight: 700, marginBottom: 6 }}>Amount per person ({token.symbol})</div>
          <input className="ff-batch-in" value={each} inputMode="decimal" disabled={busy} placeholder="0.00"
            onChange={(e) => { setEach(e.target.value.replace(",", ".").replace(/[^0-9.]/g, "")); if (step === "confirm" || step === "error") setStep("idle"); }}
            style={{ width: "100%", fontSize: 22, fontWeight: 800, color: INK }} />
        </div>
      )}

      {/* Recipients */}
      <div style={{ ...box, marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11.5, color: MUTED, fontWeight: 700, marginBottom: 6 }}>
          <span>{mode === "equal" ? "Wallet addresses" : "Recipients (address, amount)"}</span>
          {mode === "custom" && <button onClick={() => fileRef.current?.click()} disabled={busy} style={{ display: "flex", alignItems: "center", gap: 4, background: "transparent", border: "none", color: BLUE, fontWeight: 700, fontSize: 11.5, cursor: "pointer", padding: 0 }}>
            <Upload size={13} /> Upload CSV
          </button>}
          <input ref={fileRef} type="file" accept=".csv,.txt,text/csv,text/plain" style={{ display: "none" }} onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
        <textarea className="ff-batch-in" value={text} onChange={(e) => { setText(e.target.value); if (hasAmounts(e.target.value)) setMode("custom"); if (step === "confirm" || step === "error") setStep("idle"); }} disabled={busy} spellCheck={false} rows={6}
          placeholder={mode === "equal" ? "Paste wallet addresses, one per line or separated by commas" : "0x1234…abcd, 25\n0x5678…ef01, 10.5\n0x9abc…2345, 3"}
          style={{ width: "100%", resize: "vertical", fontSize: 13, lineHeight: 1.6, color: INK, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }} />
        {mode === "custom" && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 6, fontSize: 11, color: MUTED }}>
            <span>CSV format: address, amount (one per line)</span>
            <button onClick={downloadSample} disabled={busy} style={{ background: "transparent", border: "none", color: BLUE, fontWeight: 700, fontSize: 11, cursor: "pointer", padding: 0, whiteSpace: "nowrap" }}>Download sample</button>
          </div>
        )}
      </div>

      {/* Summary */}
      {rows.length > 0 && (
        <div style={{ ...box, background: "#fff", marginBottom: 10, fontSize: 13, color: INK }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span style={{ color: MUTED }}>Recipients</span><b>{validCount}{bad.length ? ` (+${bad.length} with errors)` : ""}</b></div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span style={{ color: MUTED }}>Total</span><b>{fmt(total)} {token.symbol}</b></div>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: MUTED }}>Your balance</span><b>{balance === undefined ? "…" : `${fmt(balance)} ${token.symbol}`}</b></div>
          {bad.length > 0 && (
            <div style={{ marginTop: 8, borderTop: `1px solid ${LINE}`, paddingTop: 8, maxHeight: 110, overflowY: "auto" }}>
              {bad.slice(0, 20).map((r) => <div key={r.line} style={{ fontSize: 12, color: "#B91C1C" }}>{mode === "equal" ? r.error : `Line ${r.line}: ${r.error}`}</div>)}
              {bad.length > 20 && <div style={{ fontSize: 12, color: "#B91C1C" }}>…and {bad.length - 20} more</div>}
            </div>
          )}
        </div>
      )}

      {pairsInEqual && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, background: "#EEF1FE", border: `1px solid ${BLUE}`, color: INK, borderRadius: 12, padding: "0.6rem 0.8rem", fontSize: 12.5, lineHeight: 1.45, marginBottom: 12 }}>
          <span>This list includes an amount for each address.</span>
          <button onClick={() => { setMode("custom"); setStep("idle"); }} style={{ background: "transparent", border: "none", color: BLUE, fontWeight: 800, fontSize: 12.5, cursor: "pointer", padding: 0, whiteSpace: "nowrap" }}>Use Custom amounts</button>
        </div>
      )}
      {problem && <Notice tone="error">{problem}</Notice>}
      {!problem && dupes > 0 && <Notice tone="warn">{dupes} address{dupes > 1 ? "es appear" : " appears"} more than once. Each line will be paid separately.</Notice>}
      {!problem && gasLow && <Notice tone="warn">USDC also pays gas on Arc. Keep a little USDC after the batch so the transaction can go through.</Notice>}

      {step === "confirm" && (
        <div style={{ border: `1px solid ${BLUE}`, background: "#EEF1FE", borderRadius: 16, padding: "0.85rem 1rem", marginBottom: 12, fontSize: 13.5, color: INK, lineHeight: 1.5 }}>
          <b>{fmt(total)} {token.symbol}</b> will be sent to <b>{good.length}</b> recipient{good.length > 1 ? "s" : ""}.
          <div style={{ fontSize: 12, color: MUTED, marginTop: 6 }}>Your wallet will ask for two confirmations: first to approve exactly {fmt(total)} {token.symbol}, then to send the batch. Transfers can't be reversed. Check the list before you confirm.</div>
        </div>
      )}

      {step === "error" && error && <Notice tone="error">{error}</Notice>}

      {step === "confirm" ? (
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setStep("idle")} style={{ flex: 1, padding: "0.85rem", borderRadius: 16, border: `1px solid ${LINE}`, background: "#fff", color: INK, fontWeight: 800, fontSize: 14, cursor: "pointer" }}>Back</button>
          <button onClick={send} disabled={!ready || !provider} style={{ flex: 2, padding: "0.85rem", borderRadius: 16, border: "none", background: BLUE, color: "#fff", fontWeight: 800, fontSize: 14, cursor: "pointer" }}>Confirm & send</button>
        </div>
      ) : (
        <button onClick={() => { setError(null); setStep("confirm"); }} disabled={!ready || busy || !provider}
          style={{ width: "100%", padding: "0.85rem", borderRadius: 16, border: "none", background: ready && !busy ? BLUE : "#C7CEF9", color: "#fff", fontWeight: 800, fontSize: 14, cursor: ready && !busy ? "pointer" : "not-allowed" }}>
          {step === "approving" ? "Step 1 of 2: approving…" : step === "sending" ? "Step 2 of 2: sending…" : "Review"}
        </button>
      )}
      {step === "sending" && txHash && (
        <div style={{ textAlign: "center", marginTop: 10 }}><a href={`https://arc.etherscan.io/tx/${txHash}`} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: BLUE, fontWeight: 700 }}>View on ArcScan ↗</a></div>
      )}
      <div style={{ fontSize: 11, color: MUTED, marginTop: 10, textAlign: "center" }}>
        Sent from your own wallet. FlowFi never holds your funds and charges no fee.{" "}
        <a href={`https://explorer.arc.io/address/${MULTISEND}`} target="_blank" rel="noreferrer" style={{ color: BLUE, whiteSpace: "nowrap" }}>Contract ↗</a>
      </div>
    </div>
  );
}

function Notice({ tone, children }: { tone: "error" | "warn"; children: React.ReactNode }) {
  const c = tone === "error" ? { bg: "#FEF2F2", bd: "#FECACA", fg: "#B91C1C" } : { bg: "#FFFBEB", bd: "#FDE68A", fg: "#92400E" };
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", background: c.bg, border: `1px solid ${c.bd}`, color: c.fg, borderRadius: 12, padding: "0.6rem 0.8rem", fontSize: 12.5, lineHeight: 1.45, marginBottom: 12 }}>
      <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
      <span>{children}</span>
    </div>
  );
}
