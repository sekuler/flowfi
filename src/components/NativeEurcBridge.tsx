import { useState, useEffect } from "react";
import { createWalletClient, createPublicClient, custom, http, encodeFunctionData, encodePacked, parseUnits, formatUnits, formatEther, zeroAddress } from "viem";
import type { EIP1193Provider, Chain } from "viem";
import { mainnet, base, avalanche } from "viem/chains";
import { ArrowRight, Check } from "lucide-react";
import { arcMainnet, ARC_MAINNET_CHAIN_ID_HEX } from "../chains";
import { EURC_LOGO } from "./tokenLogos";
import { TokenIcon } from "./TokenIcon";

// Native EURC into Arc Mainnet via Circle's "CCTP for non-USDC" (CrossChainTokenService).
// Sources (all verified 2026-09-23 against developers.circle.com):
//  - CrossChainTokenService mainnet address, same on every listed chain incl. Arc (domain 26):
//    cctp/expanded-assets/references/contract-addresses
//  - EURC pre-registered mainnet tokenId: cctp/expanded-assets/concepts/supported-chains-and-domains
//  - Flow (approve TokenManager -> POST fee quote -> crossChainTransfer payable with signedQuote):
//    cctp/expanded-assets/quickstarts/transfer-eurc-ethereum-to-arc
// Differences from USDC CCTP: approval goes to the per-token TokenManager (resolved on-chain,
// never hard-coded), the fee is paid in the SOURCE chain's native gas token (msg.value), and the
// recipient gets the full amount. A FORWARD request in the quote makes Circle mint on Arc, so the
// user signs nothing on Arc and needs no Arc gas. Completion is confirmed via Iris + the Arc
// MessageTransmitterV2 usedNonces check; if forwarding never lands, Resume can mint manually.
const CCTS = "0x431871229103b780868f8C6BB820cd16ECf942BC" as const;
// Pre-configured mainnet token IDs from cctp/expanded-assets/concepts/supported-chains-and-domains.
// Routes into Arc per Circle's Interop on Arc page: EURC from Arc/Avalanche/Base/Ethereum/World Chain
// (World Chain has no CrossChainTokenService deployment listed yet), cirBTC from Ethereum only.
type TokenKey = "eurc" | "cirbtc";
const TOKENS: Record<TokenKey, { id: `0x${string}`; symbol: string; decimals: number; sources: string[]; shownDecimals: number }> = {
  eurc: { id: "0x6ca9e29fa53becc29becaf4a90b9ca7a995ad4d2234880da13ca38c657fb241c", symbol: "EURC", decimals: 6, sources: ["base", "ethereum", "avalanche"], shownDecimals: 2 },
  cirbtc: { id: "0x3d26699fb5d40190fc3fa0dcbc1cd24e558355043c1997572ff9fd6efbb3fdca", symbol: "cirBTC", decimals: 8, sources: ["ethereum"], shownDecimals: 8 },
};
const ARC_MESSAGE_TRANSMITTER_V2 = "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64" as const;
const ARC_DOMAIN = 26;
const IRIS_API = "https://iris-api.circle.com";
const PENDING_KEY = "flowfi-eurc-pending";

interface Source { key: string; name: string; chain: Chain; domain: number; gas: string; stdWait: string; stdMaxMin: number }
// EURC CCTP routes into Arc per Circle's Interop on Arc page, intersected with the chains that
// have a mainnet CrossChainTokenService deployment.
const SOURCES: Source[] = [
  { key: "base", name: "Base", chain: base, domain: 6, gas: "ETH", stdWait: "15–19 min", stdMaxMin: 30 },
  { key: "ethereum", name: "Ethereum", chain: mainnet, domain: 0, gas: "ETH", stdWait: "15–19 min", stdMaxMin: 30 },
  { key: "avalanche", name: "Avalanche", chain: avalanche, domain: 1, gas: "AVAX", stdWait: "~10 sec", stdMaxMin: 5 },
];

const SERVICE_ABI = [
  { name: "resolveTokenManager", type: "function", stateMutability: "view", inputs: [{ name: "tokenId", type: "bytes32" }], outputs: [{ name: "tokenManager", type: "address" }] },
  { name: "resolveTokenAddress", type: "function", stateMutability: "view", inputs: [{ name: "tokenId", type: "bytes32" }], outputs: [{ name: "token", type: "address" }] },
  {
    name: "crossChainTransfer", type: "function", stateMutability: "payable",
    inputs: [
      { name: "tokenId", type: "bytes32" },
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "destinationAddress", type: "bytes" },
      { name: "destinationCaller", type: "bytes32" },
      { name: "minFinalityThreshold", type: "uint32" },
      { name: "claim", type: "tuple", components: [{ name: "signedQuote", type: "bytes" }, { name: "refundAddress", type: "address" }] },
      { name: "autoExecuteHookData", type: "bool" },
      { name: "hookData", type: "bytes" },
    ],
    outputs: [],
  },
] as const;
const ERC20_ABI = [
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "ok", type: "bool" }] },
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "balance", type: "uint256" }] },
] as const;
const RECEIVE_MESSAGE_ABI = [{ type: "function", name: "receiveMessage", stateMutability: "nonpayable", inputs: [{ name: "message", type: "bytes" }, { name: "attestation", type: "bytes" }], outputs: [{ type: "bool" }] }] as const;
const USED_NONCES_ABI = [{ type: "function", name: "usedNonces", stateMutability: "view", inputs: [{ name: "nonce", type: "bytes32" }], outputs: [{ type: "uint256" }] }] as const;
const ZERO_BYTES32 = `0x${"0".repeat(64)}` as `0x${string}`;

type Step = "idle" | "approving" | "quoting" | "sending" | "delivering" | "done" | "error";

const BLUE = "#3D5AF1";
const LINE = "#E7E4DD";
const MUTED = "#5E5B6B";
const INK = "#16151C";

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function switchTo(provider: EIP1193Provider, chain: Chain) {
  const isArc = chain.id === arcMainnet.id;
  const want = isArc ? ARC_MAINNET_CHAIN_ID_HEX : `0x${chain.id.toString(16)}`;
  const cur = (await provider.request({ method: "eth_chainId" })) as string;
  if (cur.toLowerCase() === want.toLowerCase()) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: want }] });
  } catch (e: unknown) {
    if ((e as { code?: number }).code !== 4902) throw e;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [isArc
        ? { chainId: want, chainName: "Arc", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: ["https://rpc.mainnet.arc.io"], blockExplorerUrls: ["https://arc.etherscan.io"] }
        : { chainId: want, chainName: chain.name, nativeCurrency: chain.nativeCurrency, rpcUrls: [chain.rpcUrls.default.http[0]], blockExplorerUrls: chain.blockExplorers?.default?.url ? [chain.blockExplorers.default.url] : [] }],
    });
  }
}

export default function NativeEurcBridge({ address, provider }: { address: string; provider?: EIP1193Provider }) {
  const [tokenKey, setTokenKey] = useState<TokenKey>("eurc");
  const [srcIdx, setSrcIdx] = useState(0);
  const [amount, setAmount] = useState("");
  const [balance, setBalance] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [feeText, setFeeText] = useState<string | null>(null);
  const [fast, setFast] = useState<boolean | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [mintHash, setMintHash] = useState<string | null>(null);
  const [pendingSrc, setPendingSrc] = useState<number | null>(null);

  const tok = TOKENS[tokenKey];
  const src = SOURCES[pendingSrc ?? srcIdx];
  const busy = step === "approving" || step === "quoting" || step === "sending" || step === "delivering";
  const unfinished = step === "error" && !!txHash;

  function savePending(hash: string, idx: number, amt: string) {
    try { localStorage.setItem(PENDING_KEY, JSON.stringify({ hash, srcIdx: idx, address, amount: amt, token: tokenKey })); } catch { /* ignore */ }
  }
  function clearPending() { try { localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ } }

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PENDING_KEY);
      if (!raw) return;
      const p = JSON.parse(raw) as { hash?: string; srcIdx?: number; address?: string; amount?: string; token?: TokenKey };
      if (!p.hash || typeof p.srcIdx !== "number" || !SOURCES[p.srcIdx] || p.address?.toLowerCase() !== address.toLowerCase()) return;
      setTxHash(p.hash); setPendingSrc(p.srcIdx); setSrcIdx(p.srcIdx); setAmount(p.amount ?? "");
      if (p.token && TOKENS[p.token]) setTokenKey(p.token);
      setStep("error");
      setError("You have an unfinished transfer: it was sent, but we haven't confirmed delivery on Arc yet.");
    } catch { /* ignore */ }
  }, [address]);

  // EURC balance on the selected source chain (token address resolved from Circle's service).
  useEffect(() => {
    let cancelled = false;
    setBalance(null);
    (async () => {
      try {
        const pc = createPublicClient({ chain: SOURCES[srcIdx].chain, transport: http() });
        const token = await pc.readContract({ address: CCTS, abi: SERVICE_ABI, functionName: "resolveTokenAddress", args: [TOKENS[tokenKey].id] });
        const raw = await pc.readContract({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [address as `0x${string}`] });
        if (!cancelled) setBalance(formatUnits(raw, TOKENS[tokenKey].decimals));
      } catch { if (!cancelled) setBalance(null); }
    })();
    return () => { cancelled = true; };
  }, [srcIdx, tokenKey, address, step === "done"]);

  async function getQuote(amountRaw: bigint, s: Source): Promise<{ signedQuote: `0x${string}`; fee: bigint; fast: boolean }> {
    const forward = { type: "FORWARD", params: { msgType: "TransferMessage", destinationAddress: address } };
    const attempt = async (withFast: boolean) => {
      const res = await fetch(`${IRIS_API}/v2/quote/cctpx/${tok.id}/${s.domain}/${ARC_DOMAIN}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: amountRaw.toString(), feeToken: zeroAddress, requests: withFast ? [{ type: "PRE_FINALITY" }, forward] : [forward] }),
      });
      if (!res.ok) throw new Error(await res.text());
      const q = await res.json();
      if (!q?.signedQuote || q?.feeTotalAmount == null) throw new Error("Circle returned an incomplete fee quote.");
      return { signedQuote: q.signedQuote as `0x${string}`, fee: BigInt(q.feeTotalAmount), fast: withFast };
    };
    try { return await attempt(true); } catch { return await attempt(false); } // fast needs FX config + allowance; fall back to standard
  }

  // Delivered = Iris has the message AND Arc's MessageTransmitterV2 marks its nonce used.
  async function waitDelivered(hash: string, s: Source, maxMin: number): Promise<{ delivered: boolean; message?: string; attestation?: string; fwd?: string }> {
    const arc = createPublicClient({ chain: arcMainnet, transport: http() });
    const attempts = Math.ceil((maxMin * 60) / 5);
    let last: { message?: string; attestation?: string; fwd?: string } = {};
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await fetch(`${IRIS_API}/v2/messages/${s.domain}?transactionHash=${hash}`);
        if (res.ok) {
          const msg = (await res.json())?.messages?.[0];
          if (msg?.status === "complete" && msg.message) {
            last = { message: msg.message, attestation: msg.attestation, fwd: msg.forwardTxHash };
            const nonce = `0x${(msg.message as string).slice(26, 90)}` as `0x${string}`;
            const used = await arc.readContract({ address: ARC_MESSAGE_TRANSMITTER_V2, abi: USED_NONCES_ABI, functionName: "usedNonces", args: [nonce] });
            if (Number(used) > 0) return { delivered: true, ...last };
          }
        }
      } catch { /* retry */ }
      await sleep(5000);
    }
    return { delivered: false, ...last };
  }

  async function send() {
    if (!provider || !amount.trim()) return;
    setError(null); setTxHash(null); setMintHash(null); setPendingSrc(null);
    const s = SOURCES[srcIdx];
    try {
      await switchTo(provider, s.chain);
      const wc = createWalletClient({ account: address as `0x${string}`, chain: s.chain, transport: custom(provider) });
      const pc = createPublicClient({ chain: s.chain, transport: http() });
      const amountRaw = parseUnits(amount.trim(), tok.decimals);
      const tokenManager = await pc.readContract({ address: CCTS, abi: SERVICE_ABI, functionName: "resolveTokenManager", args: [tok.id] });
      const token = await pc.readContract({ address: CCTS, abi: SERVICE_ABI, functionName: "resolveTokenAddress", args: [tok.id] });

      setStep("approving");
      const approveHash = await wc.sendTransaction({ to: token, data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [tokenManager, amountRaw] }) });
      const ar = await pc.waitForTransactionReceipt({ hash: approveHash });
      if (ar.status === "reverted") throw new Error("The approval reverted. Nothing was sent.");

      setStep("quoting");
      const q = await getQuote(amountRaw, s);
      setFast(q.fast);
      setFeeText(`${Number(formatEther(q.fee)).toPrecision(3)} ${s.gas}`);

      setStep("sending");
      const hash = await wc.sendTransaction({
        to: CCTS,
        value: q.fee,
        data: encodeFunctionData({
          abi: SERVICE_ABI, functionName: "crossChainTransfer",
          args: [tok.id, amountRaw, ARC_DOMAIN, encodePacked(["address"], [address as `0x${string}`]), ZERO_BYTES32, q.fast ? 1000 : 2000, { signedQuote: q.signedQuote, refundAddress: zeroAddress }, false, "0x"],
        }),
      });
      setTxHash(hash); setPendingSrc(srcIdx); savePending(hash, srcIdx, amount.trim());
      const r = await pc.waitForTransactionReceipt({ hash });
      if (r.status === "reverted") { clearPending(); setTxHash(null); setPendingSrc(null); throw new Error("The transfer reverted on the source chain. Nothing was sent."); }

      setStep("delivering");
      const out = await waitDelivered(hash, s, q.fast ? 5 : s.stdMaxMin);
      if (out.fwd) setMintHash(out.fwd);
      if (!out.delivered) throw new Error(`Circle hasn't delivered on Arc yet. Your ${tok.symbol} was sent, so don't send again. Use Resume to check again.`);
      clearPending(); setStep("done");
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string };
      setError(err.shortMessage || err.message || "Something went wrong.");
      setStep("error");
    }
  }

  // Resume: check delivery again; if Circle attested but never delivered, mint on Arc manually
  // (needs a little USDC on Arc for gas). usedNonces prevents any double mint.
  async function resume() {
    if (!provider || !txHash) return;
    setError(null);
    const s = SOURCES[pendingSrc ?? srcIdx];
    try {
      setStep("delivering");
      const out = await waitDelivered(txHash, s, 1);
      if (out.fwd) setMintHash(out.fwd);
      if (out.delivered) { clearPending(); setStep("done"); return; }
      if (!out.message || !out.attestation) throw new Error("Circle is still confirming this transfer. Try Resume again in a few minutes.");
      await switchTo(provider, arcMainnet);
      const arcWc = createWalletClient({ account: address as `0x${string}`, chain: arcMainnet, transport: custom(provider) });
      const arcPc = createPublicClient({ chain: arcMainnet, transport: http() });
      const h = await arcWc.sendTransaction({ to: ARC_MESSAGE_TRANSMITTER_V2, data: encodeFunctionData({ abi: RECEIVE_MESSAGE_ABI, functionName: "receiveMessage", args: [out.message as `0x${string}`, out.attestation as `0x${string}`] }) });
      setMintHash(h);
      const rr = await arcPc.waitForTransactionReceipt({ hash: h });
      if (rr.status === "reverted") throw new Error("The mint on Arc reverted. If this transfer was already delivered, use Dismiss.");
      clearPending(); setStep("done");
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string };
      setError(err.shortMessage || err.message || "Something went wrong.");
      setStep("error");
    }
  }

  function reset() { setStep("idle"); setAmount(""); setTxHash(null); setMintHash(null); setPendingSrc(null); setError(null); setFeeText(null); setFast(null); }

  const balNum = balance != null ? Number(balance) : null;
  const amt = parseFloat(amount);
  const validAmt = Number.isFinite(amt) && amt > 0;
  const insufficient = validAmt && balNum !== null && amt > balNum;

  let cta = `Send ${tok.symbol} to Arc`; let ctaOn = !!provider && validAmt && !insufficient && step === "idle"; let ctaFn: () => void = send;
  if (!provider) cta = "Connect wallet";
  else if (step === "idle" && !validAmt) cta = "Enter an amount";
  else if (step === "idle" && insufficient) cta = `Insufficient ${tok.symbol} balance`;
  if (busy) { cta = "Processing..."; ctaOn = false; }
  if (step === "done") { cta = "Send another"; ctaOn = true; ctaFn = reset; }
  if (unfinished) { cta = "Resume"; ctaOn = !!provider; ctaFn = resume; }
  else if (step === "error") { cta = "Try again"; ctaOn = !!provider; ctaFn = () => { setStep("idle"); setError(null); }; }

  const statusText = {
    idle: "", approving: `Approving ${tok.symbol} on ${src.name}...`, quoting: "Getting Circle's fee quote...", sending: `Sending from ${src.name}...`,
    delivering: `Circle is delivering your ${tok.symbol} on Arc (${fast ? "about 10–20 sec" : `about ${src.stdWait}`})...`, done: `Your ${tok.symbol} is now on Arc.`, error: error ?? "Failed",
  }[step];

  const pane = { background: "#F5F7FF", borderRadius: 20, padding: "14px 16px" } as const;
  const label = { fontSize: 11, color: MUTED, fontWeight: 600, letterSpacing: 0.3 } as const;
  const rows: { k: string; v: string; good?: boolean }[] = [
    { k: "Route", v: `Circle CCTP (native ${tok.symbol})` },
    { k: "Circle fee", v: feeText ? `${feeText} (paid in ${src.gas})` : `Paid in ${src.gas} on ${src.name}` },
    { k: "You receive", v: validAmt ? `${amt.toLocaleString("en-US", { maximumFractionDigits: tok.decimals })} ${tok.symbol}` : "—" },
    { k: "Gas on Arc", v: "Not needed", good: true },
    { k: "Signatures", v: `2 on ${src.name}` },
  ];

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", background: "#FFFFFF", border: `1px solid ${LINE}`, borderRadius: 28, padding: "1.1rem", boxShadow: "0 24px 60px -16px rgba(61,90,241,0.18)" }}>
      <style>{`.ff-eurc-amt, .ff-eurc-amt:focus { outline: none !important; box-shadow: none !important; border: none !important; background: transparent !important; }`}</style>

      <div style={{ ...label, marginBottom: 8 }}>TOKEN</div>
      <div role="group" aria-label="Token" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6, marginBottom: 12 }}>
        {(Object.keys(TOKENS) as TokenKey[]).map((k) => {
          const on = k === tokenKey;
          return (
            <button key={k} type="button" disabled={busy || unfinished} aria-pressed={on}
              onClick={() => {
                setTokenKey(k); setAmount("");
                if (!TOKENS[k].sources.includes(SOURCES[srcIdx].key)) setSrcIdx(SOURCES.findIndex((s) => s.key === TOKENS[k].sources[0]));
              }}
              style={{ height: 44, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, border: on ? `1.5px solid ${BLUE}` : `1px solid ${LINE}`, background: on ? "#EEF1FE" : "#FFFFFF", color: on ? BLUE : INK, fontSize: 14, fontWeight: 600, cursor: busy || unfinished ? "not-allowed" : "pointer" }}>
              {k === "eurc"
                ? <img src={EURC_LOGO} alt="" width={20} height={20} style={{ borderRadius: "50%" }} />
                : <TokenIcon symbol="cirBTC" size={20} />}
              {TOKENS[k].symbol}
            </button>
          );
        })}
      </div>

      <div style={{ ...label, marginBottom: 8 }}>FROM</div>
      <div role="group" aria-label="Source network" style={{ display: "grid", gridTemplateColumns: `repeat(${tok.sources.length}, minmax(0, 1fr))`, gap: 6, marginBottom: 10 }}>
        {SOURCES.map((s, i) => {
          if (!tok.sources.includes(s.key)) return null;
          const on = i === srcIdx;
          return (
            <button key={s.key} type="button" disabled={busy || unfinished} onClick={() => setSrcIdx(i)} aria-pressed={on}
              style={{ height: 44, borderRadius: 12, border: on ? `1.5px solid ${BLUE}` : `1px solid ${LINE}`, background: on ? "#EEF1FE" : "#FFFFFF", color: on ? BLUE : INK, fontSize: 14, fontWeight: 600, cursor: busy || unfinished ? "not-allowed" : "pointer" }}>
              {s.name}
            </button>
          );
        })}
      </div>

      <div style={pane}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={label}>YOU SEND</span>
          {balNum !== null && (
            <span style={{ fontSize: 11.5, color: MUTED }}>
              Balance: {balNum.toLocaleString("en-US", { maximumFractionDigits: tok.shownDecimals })} {tok.symbol}
              <button type="button" onClick={() => balance && setAmount(balance)} disabled={busy}
                style={{ border: "none", background: "#E3E8FD", color: BLUE, fontSize: 10.5, fontWeight: 800, padding: "2px 8px", borderRadius: 999, cursor: "pointer", marginLeft: 6 }}>MAX</button>
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input className="ff-eurc-amt" type="text" inputMode="decimal" value={amount} placeholder="0.00" disabled={busy || unfinished} aria-label={`${tok.symbol} amount`}
            onChange={(e) => { if (/^\d*\.?\d*$/.test(e.target.value)) setAmount(e.target.value); }}
            style={{ flex: 1, minWidth: 0, fontSize: 30, fontWeight: 700, color: INK, padding: 0 }} />
          <span style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff", borderRadius: 999, padding: "5px 12px 5px 6px", fontSize: 13, fontWeight: 700, color: INK, boxShadow: "0 1px 3px rgba(17,24,39,0.06)" }}>
            {tokenKey === "eurc"
              ? <img src={EURC_LOGO} alt="" width={24} height={24} style={{ borderRadius: "50%" }} />
              : <TokenIcon symbol="cirBTC" size={24} />} {tok.symbol}
          </span>
        </div>
      </div>

      <div style={{ marginTop: 10, border: `1px solid ${LINE}`, borderRadius: 18, padding: "6px 14px" }}>
        {rows.map((r, i) => (
          <div key={r.k} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0", borderBottom: i < rows.length - 1 ? `1px solid ${LINE}` : "none", fontSize: 12.5 }}>
            <span style={{ color: MUTED }}>{r.k}</span>
            <span style={{ color: r.good ? "#0E9F6E" : INK, fontWeight: 600, textAlign: "right" }}>{r.v}</span>
          </div>
        ))}
      </div>

      {step !== "idle" && (
        <div style={{ marginTop: 12, display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 14px", borderRadius: 16, background: step === "done" ? "#E7F7EF" : step === "error" && !unfinished ? "#FDECEC" : "#FFF8EC", fontSize: 12.5, lineHeight: 1.5, color: step === "done" ? "#0B7A53" : step === "error" && !unfinished ? "#B91C1C" : "#6A4308" }}>
          {step === "done" && <Check size={16} style={{ flexShrink: 0, marginTop: 2 }} />}
          <span>
            {statusText}
            {unfinished && <><br />Your {tok.symbol} was sent. Use Resume below and don't start a new transfer.</>}
          </span>
        </div>
      )}

      {(txHash || mintHash) && (
        <div style={{ display: "flex", gap: 14, marginTop: 10, fontSize: 12 }}>
          {txHash && <a href={`${src.chain.blockExplorers?.default?.url ?? "#"}/tx/${txHash}`} target="_blank" rel="noopener noreferrer" style={{ color: BLUE, fontWeight: 600 }}>Send tx ↗</a>}
          {mintHash && <a href={`https://arc.etherscan.io/tx/${mintHash}`} target="_blank" rel="noopener noreferrer" style={{ color: BLUE, fontWeight: 600 }}>Receive tx ↗</a>}
        </div>
      )}

      <button type="button" onClick={ctaFn} disabled={!ctaOn}
        style={{ width: "100%", marginTop: 14, height: 52, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 999, border: "none", background: ctaOn ? BLUE : "#EEEDF5", color: ctaOn ? "#FFFFFF" : "#8A8798", fontSize: 16, fontWeight: 700, cursor: ctaOn ? "pointer" : "not-allowed" }}>
        {cta} {ctaOn && <ArrowRight size={18} />}
      </button>

      {unfinished && (
        <div style={{ textAlign: "center", marginTop: 10 }}>
          <button type="button" onClick={() => { clearPending(); reset(); }}
            style={{ background: "none", border: "none", color: MUTED, fontSize: 11.5, cursor: "pointer", textDecoration: "underline" }}>
            Already arrived, or don't need this? Dismiss
          </button>
        </div>
      )}

      <p style={{ margin: "12px 0 0", fontSize: 11.5, color: MUTED, lineHeight: 1.5, textAlign: "center" }}>
        Self-custody: you sign every step in your own wallet. Circle's fee is paid in {src.gas}, so you receive the full {tok.symbol} amount.
      </p>
    </div>
  );
}
