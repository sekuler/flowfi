import { useState, useEffect } from "react";
import { createPublicClient, createWalletClient, custom, http, erc20Abi, formatUnits, parseUnits } from "viem";
import type { EIP1193Provider } from "viem";
import { ArrowDown, Check } from "lucide-react";
import { arcMainnet, ARC_MAINNET_CHAIN_ID, ARC_MAINNET_CHAIN_ID_HEX } from "../chains";
import { TokenIcon } from "./TokenIcon";
import { loadLifiDiamond } from "./txUtils";

// Same-chain swaps on Arc Mainnet, routed to whichever source gives the most output.
// Each source is asked for a quote in parallel (KyberSwap's aggregator and LI.FI); the best one is
// shown and used. The swap is signed by the user's own connected wallet; FlowFi holds nothing.
// Safety: the transaction target must be the known router of the chosen source, or nothing is sent.

const TOKENS = [
  { symbol: "USDC", address: "0x3600000000000000000000000000000000000000", decimals: 6 },
  { symbol: "EURC", address: "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1", decimals: 6 },
  { symbol: "cirBTC", address: "0x171A4217b86A807A64eB94757Db6849fb4bDbAA0", decimals: 8 },
  { symbol: "USYC", address: "0x8a5D989Bbb96929F689B0200f435f53dA42bF490", decimals: 6 },
] as const;
type Tok = (typeof TOKENS)[number];

// KyberSwap MetaAggregationRouterV2 on Arc, from docs.kyberswap.com (Contracts & Addresses).
const KYBER_ROUTER = "0x6131b5fae19ea4f9d964eac0408e4408b66337b5";
const KYBER_API = "https://aggregator-api.kyberswap.com/arc/api/v1";
const LIFI_API = "https://li.quest/v1";
const SLIPPAGE_BPS = 50; // 0.5%
const QUOTE_ADDRESS = "0x000000000000000000000000000000000000dEaD"; // quotes before a wallet is connected

type Source = "KyberSwap" | "LI.FI";
interface Quote { source: Source; out: bigint; raw: unknown }

const BLUE = "#3D5AF1";
const INK = "#16151C";
const MUTED = "#5E5B6B";
const LINE = "#E7E4DD";

const pc = createPublicClient({ chain: arcMainnet, transport: http() });

async function kyberQuote(from: Tok, to: Tok, amountIn: bigint): Promise<Quote | null> {
  try {
    const r = await fetch(`${KYBER_API}/routes?tokenIn=${from.address}&tokenOut=${to.address}&amountIn=${amountIn}&gasInclude=true&excludeRFQSources=true`, { headers: { "x-client-id": "flowfi" } });
    const d = await r.json();
    const rs = d?.data?.routeSummary;
    if (!r.ok || !rs?.amountOut) return null;
    if (String(d.data.routerAddress).toLowerCase() !== KYBER_ROUTER) return null;
    return { source: "KyberSwap", out: BigInt(rs.amountOut), raw: rs };
  } catch { return null; }
}

async function lifiQuote(from: Tok, to: Tok, amountIn: bigint, fromAddress: string): Promise<Quote | null> {
  try {
    const q = new URLSearchParams({
      fromChain: String(ARC_MAINNET_CHAIN_ID), toChain: String(ARC_MAINNET_CHAIN_ID),
      fromToken: from.address, toToken: to.address, fromAmount: amountIn.toString(),
      fromAddress, integrator: "flowfi", slippage: String(SLIPPAGE_BPS / 10000),
    });
    const key = import.meta.env.VITE_LIFI_API_KEY as string | undefined;
    const r = await fetch(`${LIFI_API}/quote?${q}`, { headers: key ? { "x-lifi-api-key": key } : {} });
    const d = await r.json();
    if (!r.ok || !d?.estimate?.toAmount || !d?.transactionRequest) return null;
    return { source: "LI.FI", out: BigInt(d.estimate.toAmount), raw: d };
  } catch { return null; }
}

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

const fmt = (v: bigint, t: Tok) => Number(formatUnits(v, t.decimals)).toLocaleString("en-US", { maximumFractionDigits: t.decimals === 8 ? 8 : 4 });

export default function BestPriceSwap({ address, provider, onConnect }: { address?: string; provider?: EIP1193Provider; onConnect?: () => void }) {
  const [fromIdx, setFromIdx] = useState(0);
  const [toIdx, setToIdx] = useState(1);
  const [amount, setAmount] = useState("");
  const [balance, setBalance] = useState<bigint | null>(null);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [quoting, setQuoting] = useState(false);
  const [step, setStep] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const from = TOKENS[fromIdx];
  const to = TOKENS[toIdx];
  let amountIn = 0n;
  try { amountIn = amount ? parseUnits(amount as `${number}`, from.decimals) : 0n; } catch { amountIn = 0n; }

  // Balance of the "from" token.
  useEffect(() => {
    if (!address) { setBalance(null); return; }
    let cancelled = false;
    pc.readContract({ address: from.address, abi: erc20Abi, functionName: "balanceOf", args: [address as `0x${string}`] })
      .then((b) => { if (!cancelled) setBalance(b); }).catch(() => { if (!cancelled) setBalance(null); });
    return () => { cancelled = true; };
  }, [address, fromIdx, tick]);

  // Quotes from every source, in parallel, shortly after typing stops.
  useEffect(() => {
    setQuotes([]);
    if (amountIn <= 0n || fromIdx === toIdx || step === "busy") return;
    let cancelled = false;
    setQuoting(true);
    const t = setTimeout(async () => {
      const res = await Promise.all([kyberQuote(from, to, amountIn), lifiQuote(from, to, amountIn, address ?? QUOTE_ADDRESS)]);
      if (cancelled) return;
      setQuotes(res.filter((q): q is Quote => !!q).sort((a, b) => (b.out > a.out ? 1 : b.out < a.out ? -1 : 0)));
      setQuoting(false);
    }, 600);
    return () => { cancelled = true; clearTimeout(t); setQuoting(false); };
  }, [amount, fromIdx, toIdx, address, tick]);

  const best = quotes[0];
  const insufficient = balance !== null && amountIn > balance;
  const minOut = best ? (best.out * BigInt(10000 - SLIPPAGE_BPS)) / 10000n : 0n;

  function flip() { setFromIdx(toIdx); setToIdx(fromIdx); setAmount(""); setStep("idle"); setMsg(null); }

  async function swap() {
    if (!provider || !address || !best) return;
    setStep("busy"); setHash(null);
    try {
      await switchToArc(provider);
      const wc = createWalletClient({ account: address as `0x${string}`, chain: arcMainnet, transport: custom(provider) });
      const me = address as `0x${string}`;

      // Build the exact transaction for the chosen source, and check it goes to that source's router.
      let txTo: string; let data: `0x${string}`; let value = 0n; let spender: string;
      if (best.source === "KyberSwap") {
        setMsg("Preparing the KyberSwap route...");
        const r = await fetch(`${KYBER_API}/route/build`, {
          method: "POST", headers: { "Content-Type": "application/json", "x-client-id": "flowfi" },
          body: JSON.stringify({ routeSummary: best.raw, sender: me, recipient: me, slippageTolerance: SLIPPAGE_BPS }),
        });
        const d = await r.json();
        if (!r.ok || !d?.data?.data) throw new Error("KyberSwap couldn't build this route. Please try again.");
        txTo = String(d.data.routerAddress).toLowerCase();
        data = d.data.data;
        value = BigInt(d.data.transactionValue || 0);
        spender = txTo;
        if (txTo !== KYBER_ROUTER) throw new Error("Unexpected KyberSwap router address. Nothing was sent.");
        // The built route must still be as good as the price we showed (within slippage). If KyberSwap
        // re-priced it lower, stop before the wallet opens and refresh the quotes instead.
        const builtOut = BigInt(d.data.amountOut ?? 0);
        if (builtOut < (best.out * BigInt(10000 - SLIPPAGE_BPS)) / 10000n) {
          setTick((t) => t + 1);
          throw new Error(`KyberSwap's price changed to ${fmt(builtOut, to)} ${to.symbol}. Nothing was sent. Prices are refreshed, please check them and try again.`);
        }
      } else {
        setMsg("Getting a fresh LI.FI quote...");
        const q = await lifiQuote(from, to, amountIn, me);
        const tr = (q?.raw as { transactionRequest?: { to: string; data: `0x${string}`; value?: string }; estimate?: { approvalAddress?: string } } | undefined);
        if (!tr?.transactionRequest) throw new Error("LI.FI couldn't quote this route right now. Please try again.");
        const diamond = (await loadLifiDiamond())?.toLowerCase();
        txTo = tr.transactionRequest.to.toLowerCase();
        data = tr.transactionRequest.data;
        value = BigInt(tr.transactionRequest.value || 0);
        spender = String(tr.estimate?.approvalAddress ?? txTo).toLowerCase();
        if (!diamond || txTo !== diamond || spender !== diamond) throw new Error("Unexpected LI.FI router address. Nothing was sent.");
      }

      // Approve exactly the amount being swapped, only if needed.
      const allowance = await pc.readContract({ address: from.address, abi: erc20Abi, functionName: "allowance", args: [me, spender as `0x${string}`] });
      if (allowance < amountIn) {
        setMsg(`Approve ${from.symbol} in your wallet...`);
        const a = await wc.writeContract({ address: from.address, abi: erc20Abi, functionName: "approve", args: [spender as `0x${string}`, amountIn] });
        if ((await pc.waitForTransactionReceipt({ hash: a })).status === "reverted") throw new Error("The approval reverted. Nothing was swapped.");
      }

      // KyberSwap's own numbers can differ from what the route really returns on Arc, so run the exact
      // transaction as a dry run first and read the real output. Worse than the shown price: stop here.
      if (best.source === "KyberSwap") {
        setMsg("Checking the real output on-chain...");
        let simOut: bigint | null = null;
        try {
          const sim = await pc.call({ account: me, to: txTo as `0x${string}`, data, value });
          if (sim.data && sim.data.length >= 66) simOut = BigInt(sim.data.slice(0, 66));
        } catch {
          setTick((t) => t + 1);
          throw new Error("This KyberSwap route failed an on-chain check. Nothing was sent. Prices are refreshed, please try again.");
        }
        if (simOut !== null && simOut < (best.out * BigInt(10000 - SLIPPAGE_BPS)) / 10000n) {
          setTick((t) => t + 1);
          throw new Error(`On-chain check: KyberSwap would actually give ${fmt(simOut, to)} ${to.symbol}, less than shown. Nothing was sent. Prices are refreshed, please try again.`);
        }
      }

      setMsg(`Confirm the swap in your wallet (via ${best.source})...`);
      const h = await wc.sendTransaction({ to: txTo as `0x${string}`, data, value });
      setHash(h);
      if ((await pc.waitForTransactionReceipt({ hash: h })).status === "reverted") throw new Error("The swap reverted (price moved more than 0.5%). Nothing was swapped.");
      setStep("done"); setMsg(`Swapped ${amount} ${from.symbol} for ${to.symbol} via ${best.source}.`); setAmount(""); setTick((t) => t + 1);
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string };
      setStep("error"); setMsg(err.shortMessage || err.message || "Swap failed.");
    }
  }

  const can = !!provider && !!address && !!best && amountIn > 0n && !insufficient && step !== "busy";
  const cta = !provider || !address ? "Connect wallet"
    : step === "busy" ? "Confirm in your wallet..."
    : !amount ? "Enter an amount"
    : insufficient ? `Not enough ${from.symbol}`
    : quoting ? "Finding the best price..."
    : !best ? "No route for this pair right now"
    : `Swap via ${best.source}`;

  const tokenRow = (idx: number, set: (i: number) => void, other: number) => (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {TOKENS.map((t, i) => (
        <button key={t.symbol} type="button" disabled={i === other || step === "busy"} onClick={() => { set(i); setStep("idle"); setMsg(null); }}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px 5px 5px", borderRadius: 999, border: i === idx ? `1.5px solid ${BLUE}` : `1px solid ${LINE}`, background: i === idx ? "#EEF1FE" : "#FFFFFF", color: INK, fontSize: 13, fontWeight: 600, cursor: i === other ? "not-allowed" : "pointer", opacity: i === other ? 0.4 : 1 }}>
          <TokenIcon symbol={t.symbol} size={20} /> {t.symbol}
        </button>
      ))}
    </div>
  );

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", background: "#FFFFFF", border: `1px solid ${LINE}`, borderRadius: 28, padding: "1.1rem", boxShadow: "0 24px 60px -16px rgba(61,90,241,0.18)", display: "flex", flexDirection: "column", gap: 12 }}>
      <style>{`.ff-bps-amt, .ff-bps-amt:focus { outline: none !important; box-shadow: none !important; border: none !important; background: transparent !important; }`}</style>

      <div style={{ background: "#F5F7FF", borderRadius: 20, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: MUTED, fontWeight: 600 }}>
          <span>YOU PAY</span>
          {balance !== null && (
            <span>Balance: {fmt(balance, from)} {from.symbol}
              <button type="button" onClick={() => setAmount(formatUnits(balance, from.decimals))} style={{ border: "none", background: "#E3E8FD", color: BLUE, fontSize: 10.5, fontWeight: 800, padding: "2px 8px", borderRadius: 999, cursor: "pointer", marginLeft: 6 }}>MAX</button>
            </span>
          )}
        </div>
        <input className="ff-bps-amt" type="text" inputMode="decimal" placeholder="0.00" value={amount} disabled={step === "busy"} aria-label={`${from.symbol} amount`}
          onChange={(e) => { if (/^\d*\.?\d*$/.test(e.target.value)) { setAmount(e.target.value); setStep("idle"); setMsg(null); } }}
          style={{ fontSize: 30, fontWeight: 700, color: INK, padding: 0, minWidth: 0 }} />
        {tokenRow(fromIdx, setFromIdx, toIdx)}
      </div>

      <button type="button" onClick={flip} aria-label="Switch tokens" disabled={step === "busy"}
        style={{ alignSelf: "center", width: 36, height: 36, borderRadius: 12, border: `1px solid ${LINE}`, background: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", margin: "-6px 0" }}>
        <ArrowDown size={16} color={INK} />
      </button>

      <div style={{ background: "#F5F7FF", borderRadius: 20, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
        <span style={{ fontSize: 11, color: MUTED, fontWeight: 600 }}>YOU RECEIVE</span>
        <div style={{ fontSize: 30, fontWeight: 700, color: best ? INK : "#B5B3BE" }}>{best ? fmt(best.out, to) : quoting ? "…" : "0.00"}</div>
        {tokenRow(toIdx, setToIdx, fromIdx)}
      </div>

      {quotes.length > 0 && (
        <div style={{ border: `1px solid ${LINE}`, borderRadius: 18, padding: "6px 14px" }}>
          {quotes.map((q, i) => (
            <div key={q.source} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: i < quotes.length - 1 ? `1px solid ${LINE}` : "none", fontSize: 12.5 }}>
              <span style={{ color: MUTED, display: "flex", alignItems: "center", gap: 6 }}>
                {q.source}
                {i === 0 && quotes.length > 1 && <span style={{ fontSize: 10.5, fontWeight: 700, color: "#0E9F6E", background: "#E7F7EF", padding: "1px 7px", borderRadius: 999 }}>Best price</span>}
              </span>
              <span style={{ color: INK, fontWeight: 600 }}>{fmt(q.out, to)} {to.symbol}</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0 4px", fontSize: 12, color: MUTED, borderTop: `1px solid ${LINE}` }}>
            <span>Minimum received (0.5% slippage)</span>
            <span>{fmt(minOut, to)} {to.symbol}</span>
          </div>
        </div>
      )}

      {msg && (
        <div style={{ padding: "10px 12px", borderRadius: 12, fontSize: 12.5, lineHeight: 1.5, background: step === "done" ? "#E7F7EF" : step === "error" ? "#FDECEC" : "#FFF8EC", color: step === "done" ? "#0B7A53" : step === "error" ? "#B91C1C" : "#6A4308", display: "flex", gap: 8 }}>
          {step === "done" && <Check size={16} style={{ flexShrink: 0, marginTop: 2 }} />}
          <span>{msg}{hash && <> · <a href={`https://arc.etherscan.io/tx/${hash}`} target="_blank" rel="noopener noreferrer" style={{ color: BLUE, fontWeight: 600 }}>View tx ↗</a></>}</span>
        </div>
      )}

      <button type="button" onClick={!provider || !address ? onConnect : swap} disabled={(!provider || !address) ? !onConnect : !can}
        style={{ height: 52, borderRadius: 999, border: "none", background: (!provider || !address) || can ? BLUE : "#EEEDF5", color: (!provider || !address) || can ? "#FFFFFF" : "#8A8798", fontSize: 16, fontWeight: 700, cursor: (!provider || !address) || can ? "pointer" : "not-allowed" }}>
        {cta}
      </button>

      <p style={{ margin: 0, fontSize: 11.5, color: MUTED, textAlign: "center", lineHeight: 1.5 }}>
        Best price across KyberSwap and LI.FI on Arc. You sign every step in your own wallet.
      </p>
    </div>
  );
}
