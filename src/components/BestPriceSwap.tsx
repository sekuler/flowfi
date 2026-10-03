import { useState, useEffect } from "react";
import { createPublicClient, createWalletClient, custom, http, erc20Abi, formatUnits, parseUnits, toHex, encodeFunctionData } from "viem";
import type { EIP1193Provider } from "viem";
import { ArrowDown, Check, ChevronDown } from "lucide-react";
import { arcMainnet, ARC_MAINNET_CHAIN_ID, ARC_MAINNET_CHAIN_ID_HEX } from "../chains";
import { TokenIcon } from "./TokenIcon";
import { loadLifiDiamond } from "./txUtils";

// Same-chain swaps on Arc Mainnet, routed to whichever source gives the most output.
// Each source is asked for a quote in parallel (KyberSwap, De¹ and LI.FI); the best one is
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
// De¹ Exchange router on Arc (returned by its own /quote as "exchange"), from docs.de1.exchange.
const DE1_ROUTER = "0x6352a56caadc4f1e25cd6c75970fa768a3304e64";
const DE1_API = "https://open-api.de1.exchange/v4/arc";
const SLIPPAGE_BPS = 50; // 0.5%
const QUOTE_ADDRESS = "0x000000000000000000000000000000000000dEaD"; // quotes before a wallet is connected

type Source = "KyberSwap" | "De¹" | "LI.FI";
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

function de1Params(from: Tok, to: Tok, amountIn: bigint, gasPrice: bigint) {
  return new URLSearchParams({
    inTokenAddress: from.address, outTokenAddress: to.address,
    amountDecimals: amountIn.toString(), gasPriceDecimals: gasPrice.toString(),
    slippage: String(SLIPPAGE_BPS / 100),
  });
}

// Gas price only tunes De¹'s route estimate; if the RPC call fails, fall back so De¹ is still asked.
const de1Gas = () => pc.getGasPrice().catch(() => 160000000000n);

async function de1Quote(from: Tok, to: Tok, amountIn: bigint): Promise<Quote | null> {
  try {
    const gp = await de1Gas();
    const r = await fetch(`${DE1_API}/quote?${de1Params(from, to, amountIn, gp)}`);
    const d = await r.json();
    if (!r.ok || d?.code !== 200 || !d?.data?.outAmount) return null;
    if (String(d.data.exchange).toLowerCase() !== DE1_ROUTER) return null;
    return { source: "De¹", out: BigInt(d.data.outAmount), raw: d.data };
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

const LOGOS: Record<Source, string> = { "KyberSwap": "/logos/kyberswap.svg", "De¹": "/logos/de1.png", "LI.FI": "/logos/lifi.svg" };

const fmt = (v: bigint, t: Tok) => Number(formatUnits(v, t.decimals)).toLocaleString("en-US", { maximumFractionDigits: t.decimals === 8 ? 8 : 4 });
// Short form for small extras (the "+gain" chip): 3 significant digits.
const fmtShort = (v: bigint, t: Tok) => Number(formatUnits(v, t.decimals)).toLocaleString("en-US", { maximumSignificantDigits: 3 });

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
  const [picker, setPicker] = useState<"from" | "to" | null>(null);
  const [bals, setBals] = useState<Record<string, bigint>>({});
  // USD prices by token address, taken from De¹'s quotes (it returns them); kept so they don't flicker.
  const [px, setPx] = useState<Record<string, number>>({});
  // Sources whose real on-chain output was worse than their quote; left out until the pair or amount changes.
  const [off, setOff] = useState<Source[]>([]);
  useEffect(() => { setOff([]); }, [amount, fromIdx, toIdx]);

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

  // Balances of every listed token, for the token picker and the "Receive" side.
  useEffect(() => {
    if (!address) { setBals({}); return; }
    let cancelled = false;
    Promise.all(TOKENS.map((t) => pc.readContract({ address: t.address, abi: erc20Abi, functionName: "balanceOf", args: [address as `0x${string}`] }).catch(() => null)))
      .then((res) => { if (cancelled) return; const m: Record<string, bigint> = {}; res.forEach((b, i) => { if (b !== null) m[TOKENS[i].symbol] = b; }); setBals(m); });
    return () => { cancelled = true; };
  }, [address, tick]);

  // Quotes from every source, in parallel, shortly after typing stops.
  useEffect(() => {
    setQuotes([]);
    if (amountIn <= 0n || fromIdx === toIdx || step === "busy") return;
    let cancelled = false;
    setQuoting(true);
    const t = setTimeout(async () => {
      const res = await Promise.all([
        off.includes("KyberSwap") ? Promise.resolve(null) : kyberQuote(from, to, amountIn),
        off.includes("De¹") ? Promise.resolve(null) : de1Quote(from, to, amountIn),
        lifiQuote(from, to, amountIn, address ?? QUOTE_ADDRESS),
      ]);
      if (cancelled) return;
      setQuotes(res.filter((q): q is Quote => !!q).sort((a, b) => (b.out > a.out ? 1 : b.out < a.out ? -1 : 0)));
      const d1 = res[1]?.raw as { inToken?: { address?: string; usd?: string }; outToken?: { address?: string; usd?: string } } | undefined;
      if (d1) setPx((m) => {
        const n = { ...m };
        for (const t of [d1.inToken, d1.outToken]) if (t?.address && Number(t.usd) > 0) n[t.address.toLowerCase()] = Number(t.usd);
        return n;
      });
      setQuoting(false);
    }, 600);
    return () => { cancelled = true; clearTimeout(t); setQuoting(false); };
  }, [amount, fromIdx, toIdx, address, tick, off]);

  const best = quotes[0];
  // "≈ $" value of an amount of a token, when De¹ has given us its price.
  const usdOf = (v: bigint, t: Tok) => { const p = px[t.address.toLowerCase()]; return p ? `≈ $${(Number(formatUnits(v, t.decimals)) * p).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null; };
  const usd = (v: bigint) => usdOf(v, to);
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
      } else if (best.source === "De¹") {
        setMsg("Preparing the De¹ route...");
        const q = de1Params(from, to, amountIn, await de1Gas());
        q.set("account", me);
        const r = await fetch(`${DE1_API}/swap?${q}`);
        const d = await r.json();
        if (!r.ok || d?.code !== 200 || !d?.data?.data) throw new Error("De¹ couldn't build this route. Please try again.");
        txTo = String(d.data.to).toLowerCase();
        data = d.data.data;
        value = BigInt(d.data.value || 0);
        spender = txTo;
        if (txTo !== DE1_ROUTER) throw new Error("Unexpected De¹ router address. Nothing was sent.");
        const builtOut = BigInt(d.data.outAmount ?? 0);
        if (builtOut < (best.out * BigInt(10000 - SLIPPAGE_BPS)) / 10000n) {
          setTick((t) => t + 1);
          throw new Error(`De¹'s price changed to ${fmt(builtOut, to)} ${to.symbol}. Nothing was sent. Prices are refreshed, please check them and try again.`);
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

      // Aggregator numbers on Arc (even a router's return value) can be higher than what really arrives.
      // So dry-run the exact transaction and measure the user's real balance change of the token they receive.
      // If it is worse than the shown price (or can't be checked), stop, drop that source and use the next best one.
      if (best.source !== "LI.FI") {
        setMsg("Checking the real output on-chain...");
        let realOut: bigint | null = null;
        try {
          const bal = { from: me, to: to.address, data: encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [me] }) };
          const res = await pc.request({
            method: "eth_simulateV1" as never,
            params: [{ blockStateCalls: [{ calls: [bal, { from: me, to: txTo, data, value: toHex(value) }, bal] }] }, "latest"] as never,
          }) as { calls: { status: string; returnData: `0x${string}` }[] }[];
          const c = res?.[0]?.calls;
          if (c && c.length === 3 && c.every((x) => x.status === "0x1")) realOut = BigInt(c[2].returnData) - BigInt(c[0].returnData);
        } catch { realOut = null; }
        // Arc's RPC may not support eth_simulateV1. Fall back to a plain dry run of the same transaction and
        // read the router's own return value (first word = amount received). A revert here means a bad route.
        if (realOut === null) {
          try {
            const sim = await pc.call({ account: me, to: txTo as `0x${string}`, data, value });
            if (sim.data && sim.data.length >= 66) realOut = BigInt(sim.data.slice(0, 66));
          } catch { realOut = null; }
        }
        if (realOut === null || realOut < (best.out * BigInt(10000 - SLIPPAGE_BPS)) / 10000n) {
          const src = best.source;
          setOff((o) => [...o, src]);
          setTick((t) => t + 1);
          throw new Error(realOut === null
            ? `${src}'s route couldn't be verified on-chain, so we switched to the next best price. Nothing was sent. Check the new price and press Swap again.`
            : `${src} would really give ${fmt(realOut, to)} ${to.symbol}, less than shown, so we switched to the next best price. Nothing was sent. Check the new price and press Swap again.`);
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

  // Choosing the token already on the other side swaps the two sides, like most swap apps.
  function pick(side: "from" | "to", i: number) {
    if (side === "from") { if (i === toIdx) setToIdx(fromIdx); setFromIdx(i); }
    else { if (i === fromIdx) setFromIdx(toIdx); setToIdx(i); }
    setPicker(null); setStep("idle"); setMsg(null);
  }

  const panel = (side: "from" | "to") => {
    const t = side === "from" ? from : to;
    const bal = side === "from" ? balance : (bals[to.symbol] ?? null);
    const value = side === "from" ? amountIn : (best?.out ?? 0n);
    const usdText = value > 0n ? usdOf(value, t) : null;
    const chip = { border: "none", background: "#E3E8FD", color: BLUE, fontSize: 10.5, fontWeight: 800, padding: "2px 8px", borderRadius: 999, cursor: "pointer" } as const;
    return (
      <div style={{ background: "#F5F7FF", borderRadius: 20, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8, position: "relative" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, color: MUTED, fontWeight: 600 }}>
          <span>{side === "from" ? "Sell" : "Receive"}</span>
          {bal !== null && (
            <span style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
              {fmt(bal, t)} {t.symbol}
              {side === "from" && bal > 0n && <>
                <button type="button" onClick={() => setAmount(formatUnits(bal / 2n, t.decimals))} style={chip}>50%</button>
                <button type="button" onClick={() => setAmount(formatUnits(bal, t.decimals))} style={chip}>MAX</button>
              </>}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <button type="button" disabled={step === "busy"} onClick={() => setPicker(picker === side ? null : side)}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px 7px 7px", borderRadius: 999, border: `1px solid ${LINE}`, background: "#FFFFFF", color: INK, fontSize: 15, fontWeight: 700, cursor: "pointer", flexShrink: 0, boxShadow: "0 2px 8px -4px rgba(22,21,28,0.15)" }}>
            <TokenIcon symbol={t.symbol} size={26} /> {t.symbol} <ChevronDown size={16} color={MUTED} />
          </button>
          {side === "from" ? (
            <input className="ff-bps-amt" type="text" inputMode="decimal" placeholder="0.00" value={amount} disabled={step === "busy"} aria-label={`${from.symbol} amount`}
              onChange={(e) => { if (/^\d*\.?\d*$/.test(e.target.value)) { setAmount(e.target.value); setStep("idle"); setMsg(null); } }}
              style={{ fontSize: 30, fontWeight: 700, color: INK, padding: 0, minWidth: 0, width: "100%", textAlign: "right" }} />
          ) : (
            <div style={{ fontSize: 30, fontWeight: 700, color: best ? INK : "#B5B3BE", textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
              {best ? fmt(best.out, to) : quoting ? "…" : "0.00"}
            </div>
          )}
        </div>
        <div style={{ textAlign: "right", fontSize: 12, color: MUTED, minHeight: 15 }}>{usdText ?? ""}</div>

        {picker === side && (
          <>
            <div onClick={() => setPicker(null)} style={{ position: "fixed", inset: 0, zIndex: 20 }} />
            <div style={{ position: "absolute", top: 76, left: 12, width: 240, zIndex: 21, background: "#FFFFFF", border: `1px solid ${LINE}`, borderRadius: 16, boxShadow: "0 18px 40px -12px rgba(22,21,28,0.25)", padding: 6 }}>
              {TOKENS.map((o, i) => {
                const sel = (side === "from" ? fromIdx : toIdx) === i;
                return (
                  <button key={o.symbol} type="button" onClick={() => pick(side, i)}
                    style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 12, border: "none", background: sel ? "#EEF1FE" : "transparent", cursor: "pointer", color: INK, fontSize: 14, fontWeight: 600, textAlign: "left" }}>
                    <TokenIcon symbol={o.symbol} size={26} />
                    <span style={{ flex: 1 }}>{o.symbol}</span>
                    {bals[o.symbol] !== undefined && <span style={{ fontSize: 12, color: MUTED, fontWeight: 500 }}>{fmt(bals[o.symbol], o)}</span>}
                    {sel && <Check size={14} color={BLUE} />}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", background: "#FFFFFF", border: `1px solid ${LINE}`, borderRadius: 28, padding: "1.1rem", boxShadow: "0 24px 60px -16px rgba(61,90,241,0.18)", display: "flex", flexDirection: "column", gap: 12 }}>
      <style>{`.ff-bps-amt, .ff-bps-amt:focus { outline: none !important; box-shadow: none !important; border: none !important; background: transparent !important; }`}</style>

      {panel("from")}

      <button type="button" onClick={flip} aria-label="Switch tokens" disabled={step === "busy"}
        style={{ alignSelf: "center", width: 38, height: 38, borderRadius: 12, border: "4px solid #FFFFFF", background: "#E3E8FD", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", margin: "-23px 0", zIndex: 2 }}>
        <ArrowDown size={16} color={BLUE} />
      </button>

      {panel("to")}

      {quotes.length > 0 && (
        <div style={{ border: "1px solid #C9D3FB", borderRadius: 18, padding: 8, background: "linear-gradient(135deg, #F3F6FF 0%, #E6ECFF 100%)", display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "2px 12px 4px", fontSize: 12, fontWeight: 700, color: INK }}>
            <span>Quotes</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: BLUE, background: "#FFFFFF", padding: "2px 9px", borderRadius: 999, border: "1px solid #C9D3FB" }}>{quotes.length} {quotes.length === 1 ? "source" : "sources"}</span>
          </div>
          {quotes.map((q, i) => {
            const win = i === 0;
            const gain = win && quotes.length > 1 ? q.out - quotes[quotes.length - 1].out : 0n;
            return (
              <div key={q.source} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: win ? "10px 12px" : "7px 12px", borderRadius: 12, fontSize: 12.5,
                background: win ? "#FFFFFF" : "transparent", borderLeft: win ? `4px solid ${BLUE}` : "4px solid transparent", boxShadow: win ? "0 6px 18px -8px rgba(61,90,241,0.45)" : "none" }}>
                <span style={{ color: win ? INK : "#8A8798", fontWeight: win ? 700 : 500, display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap", minWidth: 0 }}>
                  <img src={LOGOS[q.source]} alt="" width={22} height={22} style={{ borderRadius: 999, flexShrink: 0, opacity: win ? 1 : 0.75 }} />
                  {q.source}
                  {win && quotes.length > 1 && <span style={{ fontSize: 10.5, fontWeight: 700, color: "#FFFFFF", background: "#10B981", padding: "2px 8px", borderRadius: 999, whiteSpace: "nowrap" }}>Best price</span>}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
                  {gain > 0n && <span style={{ fontSize: 10.5, fontWeight: 700, color: "#0E9F6E", background: "#E7F7EF", padding: "2px 7px", borderRadius: 999 }}>+{fmtShort(gain, to)}</span>}
                  <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", lineHeight: 1.25 }}>
                    <span style={{ color: win ? BLUE : "#8A8798", fontWeight: win ? 800 : 500, fontSize: win ? 14.5 : 12.5 }}>{fmt(q.out, to)} {to.symbol}</span>
                    {usd(q.out) && <span style={{ fontSize: 10.5, color: "#8A8798", fontWeight: 500 }}>{usd(q.out)}</span>}
                  </span>
                </span>
              </div>
            );
          })}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px 4px", fontSize: 12, color: MUTED, borderTop: "1px solid #C9D3FB" }}>
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
        Best price across KyberSwap, De¹ and LI.FI on Arc. You sign every step in your own wallet.
      </p>
    </div>
  );
}
