import { useState, useEffect, useMemo } from "react";
import { useTxFeature } from "../txTracking";
import { createPublicClient, createWalletClient, custom, http, erc20Abi, formatUnits, parseUnits, isAddress, getAddress, encodeFunctionData } from "viem";
import type { EIP1193Provider, Chain } from "viem";
import { mainnet, base, arbitrum, avalanche, worldchain } from "viem/chains";
import { Check, ChevronDown, Search, AlertTriangle } from "lucide-react";
import { arcMainnet, ARC_MAINNET_CHAIN_ID_HEX } from "../chains";
import { TokenIcon } from "./TokenIcon";
import { receiptOrUnknown, TxOutcomeUnknown, useUnconfirmedTx, UnconfirmedTxNotice } from "./UnconfirmedTx";

// Direct transfer of any ERC-20 to another address on the same network. Signed by the user's own
// wallet; FlowFi holds nothing and adds no fee (only the network's own gas). Token list = LI.FI's
// public list for that network (same source as the bridge token strip), plus any token the user
// pastes by contract address (symbol/decimals read onchain).
// Networks: Arc plus the ones the private stats counter can verify (api/_lib/flowStats.js CHAINS).

const ARC_USDC = "0x3600000000000000000000000000000000000000";
const ZERO = "0x0000000000000000000000000000000000000000";
const LINE = "#E7E4DD";
const MUTED = "#6B7280";
const INK = "#111827";
const BLUE = "#3D5AF1";
const MAX_LISTED = 60; // one batched RPC request (proxy allows up to 64 calls per batch)
const USDC_GAS_BUFFER = 0.01; // USDC is also Arc's gas token

type Tok = { address: `0x${string}`; symbol: string; decimals: number; logoURI?: string };

// usdc: the official USDC on that network (lowercase), listed first. gas: the coin that pays its fees.
type Net = { key: string; name: string; chain: Chain; usdc: string; gas: string };
const NETS: Net[] = [
  { key: "arc", name: "Arc", chain: arcMainnet, usdc: ARC_USDC, gas: "USDC" },
  { key: "ethereum", name: "Ethereum", chain: mainnet, usdc: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", gas: "ETH" },
  { key: "base", name: "Base", chain: base, usdc: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", gas: "ETH" },
  { key: "arbitrum", name: "Arbitrum", chain: arbitrum, usdc: "0xaf88d065e77c8cc2239327c5edb3a432268e5831", gas: "ETH" },
  { key: "avalanche", name: "Avalanche", chain: avalanche, usdc: "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e", gas: "AVAX" },
  { key: "worldchain", name: "World Chain", chain: worldchain, usdc: "0x79a02482a880bce3f13e09da970dc34db4cd24d1", gas: "ETH" },
];

// One read client per network. Arc goes through FlowFi's rpc-proxy (batched JSON-RPC); the others
// use the network's public RPC with multicall, so reading ~60 balances is one or two requests.
function makeClient(net: Net) {
  return net.key === "arc"
    ? createPublicClient({ chain: arcMainnet, transport: http(undefined, { batch: { batchSize: 64 } }) })
    : createPublicClient({ chain: net.chain, transport: http(), batch: { multicall: true } });
}
const clients = new Map<string, ReturnType<typeof makeClient>>();
function clientFor(net: Net) {
  let c = clients.get(net.key);
  if (!c) { c = makeClient(net); clients.set(net.key, c); }
  return c;
}

const listPromises = new Map<string, Promise<Tok[]>>();
function loadList(net: Net): Promise<Tok[]> {
  let listPromise = listPromises.get(net.key);
  if (!listPromise) {
    const id = net.chain.id;
    listPromise = fetch(`https://li.quest/v1/tokens?chains=${id}`)
      .then((r) => r.json())
      .then((d) => {
        const raw: Tok[] = d?.tokens?.[id] ?? d?.tokens?.[String(id)] ?? [];
        const seen = new Set<string>();
        const list = raw.filter((t) => {
          const a = t?.address?.toLowerCase();
          if (!a || !t.symbol || typeof t.decimals !== "number" || a === ZERO || seen.has(a)) return false;
          seen.add(a);
          return true;
        });
        const rank = (t: Tok) => (t.address.toLowerCase() === net.usdc ? 0 : t.symbol === "EURC" ? 1 : t.symbol === "cirBTC" ? 2 : 3);
        list.sort((a, b) => rank(a) - rank(b));
        return list.slice(0, MAX_LISTED);
      })
      .catch(() => { listPromises.delete(net.key); return []; });
    listPromises.set(net.key, listPromise);
  }
  return listPromise;
}

async function switchTo(provider: EIP1193Provider, net: Net) {
  const want = net.key === "arc" ? ARC_MAINNET_CHAIN_ID_HEX : `0x${net.chain.id.toString(16)}`;
  const cur = (await provider.request({ method: "eth_chainId" })) as string;
  if (cur.toLowerCase() === want.toLowerCase()) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: want }] });
  } catch (e: unknown) {
    if ((e as { code?: number }).code !== 4902) throw e;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [net.key === "arc"
        ? { chainId: want, chainName: "Arc", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: ["https://rpc.mainnet.arc.io"], blockExplorerUrls: ["https://arc.etherscan.io"] }
        : { chainId: want, chainName: net.chain.name, nativeCurrency: net.chain.nativeCurrency, rpcUrls: [net.chain.rpcUrls.default.http[0]], blockExplorerUrls: net.chain.blockExplorers?.default?.url ? [net.chain.blockExplorers.default.url] : [] }],
    });
  }
}

function short(a: string) { return `${a.slice(0, 6)}…${a.slice(-4)}`; }

function Logo({ t, size }: { t: Tok; size: number }) {
  const [failed, setFailed] = useState(false);
  if (t.logoURI && !failed) {
    return <img src={t.logoURI} alt={t.symbol} width={size} height={size} onError={() => setFailed(true)} style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0, background: "#fff" }} />;
  }
  return <TokenIcon symbol={t.symbol} size={size} />;
}

type Step = "idle" | "confirm" | "sending" | "done" | "error";

export default function SendOnArc({ address, provider }: { address: string; provider?: EIP1193Provider }) {
  useTxFeature("send");
  const [netKey, setNetKey] = useState("arc");
  const net = NETS.find((n) => n.key === netKey) ?? NETS[0];
  const pc = useMemo(() => clientFor(net), [net]);
  const explorer = net.chain.blockExplorers?.default?.url ?? "";
  const explorerName = net.chain.blockExplorers?.default?.name ?? "explorer";
  const [nativeBal, setNativeBal] = useState<bigint | null>(null);
  const [list, setList] = useState<Tok[]>([]);
  const [balances, setBalances] = useState<Record<string, bigint>>({});
  const [custom_, setCustom] = useState<Tok | null>(null);
  const [token, setToken] = useState<Tok | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [lookup, setLookup] = useState<"idle" | "loading" | "fail">("idle");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const unconfirmed = useUnconfirmedTx(net.key === "arc" ? `send-${address}` : `send-${net.key}-${address}`);
  const [refresh, setRefresh] = useState(0);

  // Token list + balances (one batched request), tokens the wallet holds first.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const l = await loadList(net);
      if (cancelled) return;
      setList(l);
      setToken((cur) => cur ?? l[0] ?? null);
      const res = await Promise.allSettled(l.map((t) => pc.readContract({ address: t.address, abi: erc20Abi, functionName: "balanceOf", args: [address as `0x${string}`] })));
      if (cancelled) return;
      const b: Record<string, bigint> = {};
      res.forEach((r, i) => { if (r.status === "fulfilled") b[l[i].address.toLowerCase()] = r.value; });
      setBalances((prev) => ({ ...prev, ...b }));
    })();
    return () => { cancelled = true; };
  }, [address, refresh, net, pc]);

  // Outside Arc the fee is paid in the network's own coin (ETH, AVAX), so check the wallet has some.
  useEffect(() => {
    setNativeBal(null);
    if (net.key === "arc") return;
    let cancelled = false;
    pc.getBalance({ address: address as `0x${string}` }).then((v) => { if (!cancelled) setNativeBal(v); }).catch(() => {});
    return () => { cancelled = true; };
  }, [address, refresh, net, pc]);

  function pickNet(key: string) {
    if (key === netKey) return;
    setNetKey(key);
    setList([]); setBalances({}); setToken(null); setCustom(null); setQuery(""); setLookup("idle"); setPickerOpen(false);
    setAmount(""); setError(null); setTxHash(null); setStep("idle");
  }

  // Balance of the selected token (also covers a pasted custom token).
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    pc.readContract({ address: token.address, abi: erc20Abi, functionName: "balanceOf", args: [address as `0x${string}`] })
      .then((v) => { if (!cancelled) setBalances((p) => ({ ...p, [token.address.toLowerCase()]: v })); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [token, address, refresh, pc]);

  // Pasted contract address in the search box → read the token onchain.
  useEffect(() => {
    const q = query.trim();
    if (!isAddress(q)) { setCustom(null); setLookup("idle"); return; }
    if (list.some((t) => t.address.toLowerCase() === q.toLowerCase())) { setCustom(null); setLookup("idle"); return; }
    let cancelled = false;
    setLookup("loading");
    (async () => {
      try {
        const a = getAddress(q);
        const [symbol, decimals] = await Promise.all([
          pc.readContract({ address: a, abi: erc20Abi, functionName: "symbol" }),
          pc.readContract({ address: a, abi: erc20Abi, functionName: "decimals" }),
        ]);
        if (!cancelled) { setCustom({ address: a, symbol, decimals }); setLookup("idle"); }
      } catch { if (!cancelled) { setCustom(null); setLookup("fail"); } }
    })();
    return () => { cancelled = true; };
  }, [query, list, pc]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const f = q && !isAddress(q) ? list.filter((t) => t.symbol.toLowerCase().includes(q)) : isAddress(q) ? list.filter((t) => t.address.toLowerCase() === q) : list;
    return [...f].sort((a, b) => {
      const ha = (balances[a.address.toLowerCase()] ?? 0n) > 0n ? 0 : 1;
      const hb = (balances[b.address.toLowerCase()] ?? 0n) > 0n ? 0 : 1;
      return ha - hb;
    });
  }, [list, query, balances]);

  const balRaw = token ? balances[token.address.toLowerCase()] : undefined;
  const balNum = token && balRaw !== undefined ? Number(formatUnits(balRaw, token.decimals)) : null;

  let amtRaw: bigint | null = null;
  try { amtRaw = token && amount.trim() ? parseUnits(amount.trim(), token.decimals) : null; } catch { amtRaw = null; }
  const toTrim = to.trim();
  const toValid = isAddress(toTrim);
  const isSelf = toValid && toTrim.toLowerCase() === address.toLowerCase();
  const isTokenContract = toValid && token && toTrim.toLowerCase() === token.address.toLowerCase();
  const tooMuch = amtRaw !== null && balRaw !== undefined && amtRaw > balRaw;
  const isUsdc = net.key === "arc" && token?.address.toLowerCase() === ARC_USDC;
  const noGas = net.key !== "arc" && nativeBal === 0n;
  const gasLow = isUsdc && amtRaw !== null && balRaw !== undefined && !tooMuch && Number(formatUnits(balRaw - amtRaw, token!.decimals)) < USDC_GAS_BUFFER;

  let problem: string | null = null;
  if (toTrim && !toValid) problem = "This isn't a valid address.";
  else if (isSelf) problem = "This is your own address.";
  else if (isTokenContract) problem = "This is the token's contract address, not a wallet. Tokens sent there are lost.";
  else if (amount.trim() && (amtRaw === null || amtRaw === 0n)) problem = "Enter a valid amount.";
  else if (tooMuch) problem = `Not enough ${token?.symbol}.`;
  const ready = !!token && toValid && !isSelf && !isTokenContract && amtRaw !== null && amtRaw > 0n && !tooMuch && !unconfirmed.hash;

  async function send() {
    if (!provider || !token || !ready || amtRaw === null) return;
    setError(null); setStep("sending");
    try {
      await switchTo(provider, net);
      const wc = createWalletClient({ account: address as `0x${string}`, chain: net.chain, transport: custom(provider) });
      const h = await wc.sendTransaction({ to: token.address, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [getAddress(toTrim), amtRaw] }) });
      setTxHash(h);
      const r = await receiptOrUnknown(pc, h);
      if (r.status === "reverted") throw new Error("The transfer reverted onchain. Nothing was sent.");
      setStep("done");
      setRefresh((n) => n + 1);
    } catch (e: unknown) {
      if (e instanceof TxOutcomeUnknown) { unconfirmed.set(e.hash); setStep("idle"); return; }
      const err = e as { shortMessage?: string; message?: string };
      setError(err.shortMessage || err.message || "Something went wrong.");
      setStep("error");
    }
  }

  function onUnconfirmedResolved(status: string) {
    unconfirmed.set(null);
    setRefresh((n) => n + 1);
    if (status === "reverted") { setError("The transfer reverted onchain. Nothing was sent."); setStep("error"); }
    else if (token && amount.trim() && to.trim()) setStep("done");
    else reset();
  }

  function reset() { setStep("idle"); setAmount(""); setTo(""); setTxHash(null); setError(null); }

  const card: React.CSSProperties = { maxWidth: 480, margin: "0 auto", background: "#fff", border: `1px solid ${LINE}`, borderRadius: 28, padding: "1.25rem", boxShadow: "0 24px 60px -16px rgba(61,90,241,0.18)" };
  const box: React.CSSProperties = { background: "#F7F8FF", border: `1px solid ${LINE}`, borderRadius: 18, padding: "0.85rem 1rem" };
  const amtShown = amtRaw !== null && token ? Number(formatUnits(amtRaw, token.decimals)).toLocaleString("en-US", { maximumFractionDigits: token.decimals }) : "";

  if (step === "done" && token) {
    return (
      <div style={{ ...card, textAlign: "center", padding: "2rem 1.25rem" }}>
        <div style={{ width: 52, height: 52, borderRadius: "50%", background: "#DCFCE7", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}><Check size={26} color="#16A34A" /></div>
        <div style={{ fontSize: 18, fontWeight: 800, color: INK }}>Sent</div>
        <div style={{ fontSize: 13.5, color: MUTED, margin: "6px 0 16px" }}>{amtShown} {token.symbol} to {short(toTrim)} on {net.name}</div>
        {txHash && explorer && <a href={`${explorer}/tx/${txHash}`} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: BLUE, fontWeight: 700 }}>View on {explorerName} ↗</a>}
        <button onClick={reset} style={{ display: "block", width: "100%", marginTop: 18, padding: "0.85rem", borderRadius: 16, border: "none", background: BLUE, color: "#fff", fontWeight: 800, fontSize: 14, cursor: "pointer" }}>Send again</button>
      </div>
    );
  }

  return (
    <div style={card}>
      <style>{`.ff-send-in, .ff-send-in:focus { outline: none !important; box-shadow: none !important; border: none !important; background: transparent !important; }`}</style>
      <div style={{ fontSize: 16, fontWeight: 800, color: INK, marginBottom: 2 }}>Send on {net.name}</div>
      <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 12 }}>Send any token on {net.name} straight to another address. Only the network fee applies.</div>

      {/* Network */}
      <div role="tablist" aria-label="Network" style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
        {NETS.map((n) => {
          const on = n.key === net.key;
          return (
            <button key={n.key} role="tab" aria-selected={on} onClick={() => pickNet(n.key)} disabled={step === "sending" || !!unconfirmed.hash}
              style={{ padding: "0.4rem 0.8rem", borderRadius: 999, border: `1px solid ${on ? BLUE : LINE}`, background: on ? BLUE : "#fff", color: on ? "#fff" : INK, fontWeight: 700, fontSize: 12.5, cursor: on ? "default" : "pointer" }}>
              {n.name}
            </button>
          );
        })}
      </div>

      {/* Token */}
      <div style={{ ...box, position: "relative", marginBottom: 10 }}>
        <div style={{ fontSize: 11.5, color: MUTED, fontWeight: 700, marginBottom: 6 }}>Token</div>
        <button onClick={() => setPickerOpen((o) => !o)} disabled={step === "sending"} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
          {token ? <Logo t={token} size={26} /> : <div style={{ width: 26, height: 26, borderRadius: "50%", background: LINE }} />}
          <span style={{ fontSize: 16, fontWeight: 800, color: INK }}>{token?.symbol ?? "Loading…"}</span>
          <ChevronDown size={16} color={MUTED} style={{ marginLeft: "auto" }} />
        </button>
        {pickerOpen && (
          <div style={{ position: "absolute", zIndex: 20, left: 0, right: 0, top: "calc(100% + 6px)", background: "#fff", border: `1px solid ${LINE}`, borderRadius: 18, boxShadow: "0 20px 40px -18px rgba(0,0,0,0.3)", padding: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, border: `1px solid ${LINE}`, borderRadius: 12, padding: "0.5rem 0.7rem", marginBottom: 6 }}>
              <Search size={15} color={MUTED} />
              <input className="ff-send-in" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or paste token address" style={{ flex: 1, fontSize: 13.5, color: INK }} />
            </div>
            <div style={{ maxHeight: 260, overflowY: "auto" }}>
              {custom_ && (
                <TokenRow t={custom_} bal={balances[custom_.address.toLowerCase()]} note="Custom token" onPick={() => { setToken(custom_); setPickerOpen(false); setQuery(""); }} />
              )}
              {lookup === "loading" && <div style={{ fontSize: 12.5, color: MUTED, padding: "0.6rem" }}>Looking up token…</div>}
              {lookup === "fail" && <div style={{ fontSize: 12.5, color: "#B91C1C", padding: "0.6rem" }}>No token found at this address on {net.name}.</div>}
              {shown.map((t) => (
                <TokenRow key={t.address} t={t} bal={balances[t.address.toLowerCase()]} onPick={() => { setToken(t); setPickerOpen(false); setQuery(""); }} />
              ))}
              {!custom_ && lookup === "idle" && shown.length === 0 && <div style={{ fontSize: 12.5, color: MUTED, padding: "0.6rem" }}>No match. Paste the token's contract address.</div>}
            </div>
          </div>
        )}
      </div>

      {/* Recipient */}
      <div style={{ ...box, marginBottom: 10 }}>
        <div style={{ fontSize: 11.5, color: MUTED, fontWeight: 700, marginBottom: 6 }}>To</div>
        <input className="ff-send-in" value={to} onChange={(e) => { setTo(e.target.value); if (step === "confirm") setStep("idle"); }} placeholder="0x… recipient address" spellCheck={false} disabled={step === "sending"}
          style={{ width: "100%", fontSize: 14, color: INK, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }} />
      </div>

      {/* Amount */}
      <div style={{ ...box, marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: MUTED, fontWeight: 700, marginBottom: 6 }}>
          <span>Amount</span>
          {token && balNum !== null && <span>Balance: {balNum.toLocaleString("en-US", { maximumFractionDigits: Math.min(token.decimals, 6) })} {token.symbol}</span>}
        </div>
        <input className="ff-send-in" value={amount} inputMode="decimal" onChange={(e) => { setAmount(e.target.value.replace(",", ".")); if (step === "confirm") setStep("idle"); }} placeholder="0.00" disabled={step === "sending"}
          style={{ width: "100%", fontSize: 24, fontWeight: 800, color: INK }} />
      </div>

      {problem && <Notice tone="error">{problem}</Notice>}
      {!problem && gasLow && <Notice tone="warn">USDC also pays gas on Arc. Keep a little USDC so you can make transactions later.</Notice>}
      {!problem && noGas && <Notice tone="warn">Your wallet has no {net.gas} on {net.name}. You need a little {net.gas} there to pay the network fee.</Notice>}

      {step === "confirm" && token && (
        <div style={{ border: `1px solid ${BLUE}`, background: "#EEF1FE", borderRadius: 16, padding: "0.85rem 1rem", marginBottom: 12, fontSize: 13.5, color: INK, lineHeight: 1.5 }}>
          <b>{amtShown} {token.symbol}</b> on <b>{net.name}</b> will be sent to<br />
          <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12.5, wordBreak: "break-all" }}>{getAddress(toTrim)}</span>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 6 }}>Transfers can't be reversed. Check the address, and that the recipient accepts {token.symbol} on {net.name}, before you confirm.</div>
        </div>
      )}

      {step === "error" && error && <Notice tone="error">{error}</Notice>}
      {unconfirmed.hash && <div style={{ marginBottom: 10 }}><UnconfirmedTxNotice client={pc} hash={unconfirmed.hash} explorer={explorer} onResolved={onUnconfirmedResolved} onDismiss={() => unconfirmed.set(null)} /></div>}

      {step === "confirm" ? (
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setStep("idle")} style={{ flex: 1, padding: "0.85rem", borderRadius: 16, border: `1px solid ${LINE}`, background: "#fff", color: INK, fontWeight: 800, fontSize: 14, cursor: "pointer" }}>Back</button>
          <button onClick={send} disabled={!ready || !provider} style={{ flex: 2, padding: "0.85rem", borderRadius: 16, border: "none", background: BLUE, color: "#fff", fontWeight: 800, fontSize: 14, cursor: "pointer" }}>Confirm & send</button>
        </div>
      ) : (
        <button onClick={() => { setError(null); setStep("confirm"); }} disabled={!ready || step === "sending" || !provider}
          style={{ width: "100%", padding: "0.85rem", borderRadius: 16, border: "none", background: ready && step !== "sending" ? BLUE : "#C7CEF9", color: "#fff", fontWeight: 800, fontSize: 14, cursor: ready && step !== "sending" ? "pointer" : "not-allowed" }}>
          {step === "sending" ? "Sending…" : "Review"}
        </button>
      )}
      {step === "sending" && txHash && (
        <div style={{ textAlign: "center", marginTop: 10 }}><a href={`${explorer}/tx/${txHash}`} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: BLUE, fontWeight: 700 }}>View on {explorerName} ↗</a></div>
      )}
    </div>
  );
}

function TokenRow({ t, bal, note, onPick }: { t: Tok; bal?: bigint; note?: string; onPick: () => void }) {
  const n = bal !== undefined ? Number(formatUnits(bal, t.decimals)) : null;
  return (
    <button onClick={onPick} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "0.55rem 0.6rem", border: "none", background: "transparent", borderRadius: 12, cursor: "pointer", textAlign: "left" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "#F3F4F6")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
      <Logo t={t} size={26} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: INK }}>{t.symbol}</div>
        <div style={{ fontSize: 11, color: MUTED }}>{note ? `${note} · ` : ""}{short(t.address)}</div>
      </div>
      {n !== null && n > 0 && <div style={{ fontSize: 12.5, fontWeight: 700, color: INK }}>{n.toLocaleString("en-US", { maximumFractionDigits: 4 })}</div>}
    </button>
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
