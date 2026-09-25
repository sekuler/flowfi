import { useState, useEffect } from "react";
import { createPublicClient, createWalletClient, custom, http, erc20Abi, parseUnits, pad, isAddress } from "viem";
import type { Chain, EIP1193Provider } from "viem";
import { mainnet, base, arbitrum } from "viem/chains";
import { ArrowDownLeft, ArrowRight, RefreshCw, Layers } from "lucide-react";
import { arcMainnet } from "../chains";
import type { LiveCircleWallet } from "./ConnectModal";
import { ChainLogo, TokenLogo, type ChainKey } from "./AssetLogos";

// Circle Gateway on MAINNET: one USDC balance across Arc, Base, Ethereum and Arbitrum.
// Sources (developers.circle.com, checked 2026-09-25):
//  - contracts, same address on every mainnet chain: gateway/references/contract-addresses
//  - API gateway-api.circle.com (/v1/balances, /v1/estimate, /v1/transfer, /v1/transfer/{id})
//  - fees (0.5 bp + per-source gas; forwarding $0.05 + gas): gateway/references/fees
//  - EIP-712 BurnIntent types copied verbatim from Circle's gateway contracts (see gatewayTransfer.ts)
// Transfers use Circle's Forwarding Service, so Circle mints on the destination chain and the
// user needs no gas there. Works with either the connected browser wallet (user signs) or the
// Circle Wallet (signed server-side, only for Gateway burn intents from that wallet).
const GATEWAY_API = "https://gateway-api.circle.com";
const GATEWAY_WALLET = "0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE" as const;
const GATEWAY_MINTER = "0x2222222d7164433c4C09B0b0D809a9b52C04C205" as const;
const CIRCLE_API = "/api/circle-wallet-mainnet";

interface GChain { key: string; name: string; circleCode: string; domain: number; chain: Chain; usdc: `0x${string}`; explorer: string; slow: boolean }
const CHAINS: GChain[] = [
  { key: "arc", name: "Arc", circleCode: "ARC", domain: 26, chain: arcMainnet, usdc: "0x3600000000000000000000000000000000000000", explorer: "https://arc.etherscan.io", slow: false },
  { key: "base", name: "Base", circleCode: "BASE", domain: 6, chain: base, usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", explorer: "https://basescan.org", slow: true },
  { key: "ethereum", name: "Ethereum", circleCode: "ETH", domain: 0, chain: mainnet, usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", explorer: "https://etherscan.io", slow: true },
  { key: "arbitrum", name: "Arbitrum", circleCode: "ARB", domain: 3, chain: arbitrum, usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", explorer: "https://arbiscan.io", slow: true },
];

const EIP712_DOMAIN = { name: "GatewayWallet", version: "1" } as const;
const EIP712_TYPES = {
  TransferSpec: [
    { name: "version", type: "uint32" },
    { name: "sourceDomain", type: "uint32" },
    { name: "destinationDomain", type: "uint32" },
    { name: "sourceContract", type: "bytes32" },
    { name: "destinationContract", type: "bytes32" },
    { name: "sourceToken", type: "bytes32" },
    { name: "destinationToken", type: "bytes32" },
    { name: "sourceDepositor", type: "bytes32" },
    { name: "destinationRecipient", type: "bytes32" },
    { name: "sourceSigner", type: "bytes32" },
    { name: "destinationCaller", type: "bytes32" },
    { name: "value", type: "uint256" },
    { name: "salt", type: "bytes32" },
    { name: "hookData", type: "bytes" },
  ],
  BurnIntent: [
    { name: "maxBlockHeight", type: "uint256" },
    { name: "maxFee", type: "uint256" },
    { name: "spec", type: "TransferSpec" },
  ],
} as const;
const GATEWAY_DEPOSIT_ABI = [{ type: "function", name: "deposit", stateMutability: "nonpayable", inputs: [{ name: "token", type: "address" }, { name: "value", type: "uint256" }], outputs: [] }] as const;
const ZERO32 = `0x${"0".repeat(64)}` as `0x${string}`;

const BLUE = "#3D5AF1";
// Cards use the Arc navy gradient, so text/line tokens are light. PAGE_* are for text that
// sits on the light page background outside the cards.
const INK = "#FFFFFF";
const MUTED = "rgba(255,255,255,0.72)";
const LINE = "rgba(255,255,255,0.16)";
const PAGE_INK = "#16151C";
const PAGE_MUTED = "#5E5B6B";

const b32 = (a: string) => pad(a as `0x${string}`, { size: 32 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const toJSON = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

async function switchTo(provider: EIP1193Provider, chain: Chain) {
  const want = `0x${chain.id.toString(16)}`;
  const cur = (await provider.request({ method: "eth_chainId" })) as string;
  if (cur.toLowerCase() === want.toLowerCase()) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: want }] });
  } catch (e: unknown) {
    if ((e as { code?: number }).code !== 4902) throw e;
    const isArc = chain.id === arcMainnet.id;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [isArc
        ? { chainId: want, chainName: "Arc", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: ["https://rpc.mainnet.arc.io"], blockExplorerUrls: ["https://arc.etherscan.io"] }
        : { chainId: want, chainName: chain.name, nativeCurrency: chain.nativeCurrency, rpcUrls: [chain.rpcUrls.default.http[0]], blockExplorerUrls: chain.blockExplorers?.default?.url ? [chain.blockExplorers.default.url] : [] }],
    });
  }
}

async function circlePost(body: Record<string, unknown>) {
  const res = await fetch(CIRCLE_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: toJSON(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.success) throw new Error(d.error ?? "Circle Wallet request failed.");
  return d;
}

async function circleCallAndWait(body: Record<string, unknown>) {
  const { transactionId } = await circlePost({ action: "contractCall", ...body });
  const start = Date.now();
  while (Date.now() - start < 180000) {
    const s = await circlePost({ action: "getTransaction", transactionId });
    if (s.state === "COMPLETE") return s.txHash as string;
    if (["FAILED", "CANCELLED", "DENIED"].includes(s.state)) throw new Error(s.errorReason ?? `Transaction ${String(s.state).toLowerCase()}.`);
    await sleep(3000);
  }
  throw new Error("Still processing. Check again in a minute.");
}

export default function GatewayMainnet({ browserAddress, provider, circleLive, onOpenNativeBridge, onConnect }: { browserAddress?: string; provider?: EIP1193Provider; circleLive?: LiveCircleWallet | null; onOpenNativeBridge?: () => void; onConnect?: () => void }) {
  const [source, setSource] = useState<"browser" | "circle">(browserAddress ? "browser" : "circle");
  const hasBrowser = !!browserAddress && !!provider;
  const hasCircle = !!circleLive;
  useEffect(() => {
    if (source === "browser" && !hasBrowser && hasCircle) setSource("circle");
    if (source === "circle" && !hasCircle && hasBrowser) setSource("browser");
  }, [hasBrowser, hasCircle]);

  const owner = source === "browser" ? browserAddress : circleLive?.address;

  const [bal, setBal] = useState<Record<string, { available: number; pending: number }> | null>(null);
  // USDC sitting in the wallet itself (not yet deposited into Gateway), per chain.
  const [walletBal, setWalletBal] = useState<Record<string, number>>({});
  // A deposit Gateway hasn't credited yet. Kept in localStorage so it survives leaving the page.
  const [arriving, setArriving] = useState<{ chain: string; amount: number; eta: number; baseline: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const arrivingKey = owner ? `flowfi-gw-arriving-${owner.toLowerCase()}` : null;
  useEffect(() => {
    if (!arrivingKey) { setArriving(null); return; }
    try { const p = JSON.parse(localStorage.getItem(arrivingKey) ?? "null"); setArriving(p && p.eta + 15 * 60000 > Date.now() ? p : null); } catch { setArriving(null); }
  }, [arrivingKey]);
  function saveArriving(v: typeof arriving) {
    setArriving(v);
    try { if (arrivingKey) { if (v) localStorage.setItem(arrivingKey, JSON.stringify(v)); else localStorage.removeItem(arrivingKey); } } catch { /* ignore */ }
  }
  const [loadingBal, setLoadingBal] = useState(false);

  const [depChain, setDepChain] = useState("arc");
  const [depAmount, setDepAmount] = useState("");
  const [dStep, setDStep] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [dMsg, setDMsg] = useState<string | null>(null);

  const [fromChain, setFromChain] = useState("arc");
  const [toChain, setToChain] = useState("base");
  const [tAmount, setTAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [tStep, setTStep] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [tMsg, setTMsg] = useState<string | null>(null);

  const dep = CHAINS.find((c) => c.key === depChain)!;
  const from = CHAINS.find((c) => c.key === fromChain)!;
  const to = CHAINS.find((c) => c.key === toChain)!;

  useEffect(() => { if (owner) setRecipient(owner); }, [owner]);

  async function refresh(): Promise<Record<string, { available: number; pending: number }> | null> {
    if (!owner) return null;
    setLoadingBal(true);
    Promise.all(CHAINS.map(async (c) => {
      try {
        const pc = createPublicClient({ chain: c.chain, transport: http() });
        const raw = await pc.readContract({ address: c.usdc, abi: erc20Abi, functionName: "balanceOf", args: [owner as `0x${string}`] });
        return [c.key, Number(raw) / 1e6] as const;
      } catch { return [c.key, 0] as const; }
    })).then((e) => setWalletBal(Object.fromEntries(e)));
    try {
      const res = await fetch(`${GATEWAY_API}/v1/balances`, {
        method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ token: "USDC", sources: CHAINS.map((c) => ({ domain: c.domain, depositor: owner })) }),
      });
      const d = await res.json();
      const out: Record<string, { available: number; pending: number }> = {};
      for (const c of CHAINS) {
        const e = (d?.balances ?? []).find((b: { domain: number }) => Number(b.domain) === c.domain);
        const pending = Number(e?.pendingBatch ?? 0) || 0;
        out[c.key] = { available: Math.max(0, (Number(e?.balance ?? 0) || 0) - pending), pending };
      }
      setBal(out);
      return out;
    } catch { setBal(null); return null; }
    finally { setLoadingBal(false); }
  }

  useEffect(() => {
    setBal(null);
    refresh();
    const t = setInterval(refresh, 20000);
    return () => clearInterval(t);
  }, [owner]);

  // While a deposit is on its way, check often (Arc: every 3 s, other chains: every 15 s) and
  // clear it the moment Gateway credits it.
  useEffect(() => {
    if (!arriving) return;
    const fast = arriving.chain === "arc";
    const tick = async () => {
      setNow(Date.now());
      const out = await refresh();
      const got = out?.[arriving.chain]?.available ?? 0;
      if (got >= arriving.baseline + arriving.amount * 0.99) {
        saveArriving(null);
        setDStep("done");
        setDMsg(`${arriving.amount} USDC is now in your Gateway balance.`);
      } else if (Date.now() > arriving.eta + 15 * 60000) {
        saveArriving(null);
      }
    };
    const t = setInterval(tick, fast ? 3000 : 15000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(t); clearInterval(clock); };
  }, [arriving]);

  const total = bal ? Object.values(bal).reduce((s, x) => s + x.available, 0) : 0;

  async function deposit() {
    if (!owner) return;
    const amountRaw = parseUnits(depAmount.trim(), 6);
    setDStep("busy"); setDMsg(null);
    try {
      if (source === "browser") {
        await switchTo(provider!, dep.chain);
        const wc = createWalletClient({ account: owner as `0x${string}`, chain: dep.chain, transport: custom(provider!) });
        const pc = createPublicClient({ chain: dep.chain, transport: http() });
        setDMsg("1/2 Approve USDC in your wallet...");
        const a = await wc.writeContract({ address: dep.usdc, abi: erc20Abi, functionName: "approve", args: [GATEWAY_WALLET, amountRaw] });
        if ((await pc.waitForTransactionReceipt({ hash: a })).status === "reverted") throw new Error("Approval reverted. Nothing was sent.");
        setDMsg("2/2 Confirm the deposit...");
        const h = await wc.writeContract({ address: GATEWAY_WALLET, abi: GATEWAY_DEPOSIT_ABI, functionName: "deposit", args: [dep.usdc, amountRaw] });
        if ((await pc.waitForTransactionReceipt({ hash: h })).status === "reverted") throw new Error("Deposit reverted.");
      } else {
        const walletId = circleLive!.walletsByChain[dep.circleCode]?.walletId;
        if (!walletId) throw new Error(`No ${dep.name} Circle wallet on this account.`);
        setDMsg("1/2 Approving USDC...");
        await circleCallAndWait({ walletId, contractAddress: dep.usdc, abiFunctionSignature: "approve(address,uint256)", abiParameters: [GATEWAY_WALLET, amountRaw.toString()] });
        setDMsg("2/2 Depositing...");
        await circleCallAndWait({ walletId, contractAddress: GATEWAY_WALLET, abiFunctionSignature: "deposit(address,uint256)", abiParameters: [dep.usdc, amountRaw.toString()] });
      }
      const etaMs = Date.now() + (dep.slow ? 20 * 60000 : 60000);
      saveArriving({ chain: dep.key, amount: Number(depAmount), eta: etaMs, baseline: bal?.[dep.key]?.available ?? 0 });
      setDStep("done");
      setDMsg(dep.slow
        ? `Deposit sent. Gateway credits it once ${dep.name} finalizes (about 20 min). You can leave this page; it will appear here automatically.`
        : "Deposit sent. Gateway is crediting it, usually within a minute...");
      setDepAmount("");
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string };
      setDStep("error"); setDMsg(err.shortMessage || err.message || "Deposit failed.");
    }
  }

  async function transfer() {
    if (!owner) return;
    setTStep("busy"); setTMsg("Getting Circle's fee quote...");
    try {
      const saltBytes = crypto.getRandomValues(new Uint8Array(32));
      const salt = ("0x" + Array.from(saltBytes).map((b) => b.toString(16).padStart(2, "0")).join("")) as `0x${string}`;
      const spec = {
        version: 1,
        sourceDomain: from.domain,
        destinationDomain: to.domain,
        sourceContract: b32(GATEWAY_WALLET),
        destinationContract: b32(GATEWAY_MINTER),
        sourceToken: b32(from.usdc),
        destinationToken: b32(to.usdc),
        sourceDepositor: b32(owner),
        destinationRecipient: b32(recipient.trim()),
        sourceSigner: b32(owner),
        destinationCaller: ZERO32,
        value: parseUnits(tAmount.trim(), 6),
        salt,
        hookData: "0x" as `0x${string}`,
      };

      const estRes = await fetch(`${GATEWAY_API}/v1/estimate?enableForwarder=true`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: toJSON([{ spec }]),
      });
      const est = await estRes.json().catch(() => ({}));
      if (!estRes.ok) throw new Error(est?.message ?? `Fee quote failed (${estRes.status}).`);
      const bi = est?.body?.[0]?.burnIntent ?? est?.[0]?.burnIntent;
      if (bi?.maxFee == null || bi?.maxBlockHeight == null) throw new Error("Circle returned an incomplete fee quote.");
      const message = { maxBlockHeight: BigInt(bi.maxBlockHeight), maxFee: BigInt(bi.maxFee), spec };
      const typed = { domain: EIP712_DOMAIN, types: EIP712_TYPES, primaryType: "BurnIntent" as const, message };
      const feeUsd = Number(message.maxFee) / 1e6;

      let signature: `0x${string}`;
      if (source === "browser") {
        setTMsg(`Sign the transfer in your wallet (max fee $${feeUsd.toFixed(2)})...`);
        const wc = createWalletClient({ account: owner as `0x${string}`, chain: from.chain, transport: custom(provider!) });
        signature = await wc.signTypedData(typed);
      } else {
        setTMsg(`Signing with your Circle Wallet (max fee $${feeUsd.toFixed(2)})...`);
        const walletId = circleLive!.walletsByChain[from.circleCode]?.walletId;
        if (!walletId) throw new Error(`No ${from.name} Circle wallet on this account.`);
        const circleTyped = { ...typed, types: { EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }], ...EIP712_TYPES } };
        signature = (await circlePost({ action: "gatewaySign", walletId, data: circleTyped })).signature;
      }

      setTMsg("Sending to Circle...");
      const tRes = await fetch(`${GATEWAY_API}/v1/transfer?enableForwarder=true`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: toJSON([{ burnIntent: message, signature }]),
      });
      const tr = await tRes.json().catch(() => ({}));
      if (!tRes.ok) throw new Error(tr?.message ?? `Transfer request failed (${tRes.status}).`);
      const transferId = tr?.transferId ?? tr?.[0]?.transferId;
      if (!transferId) throw new Error("Circle did not return a transfer ID.");

      setTMsg(`Circle is delivering your USDC on ${to.name}...`);
      const start = Date.now();
      while (Date.now() - start < 300000) {
        const sRes = await fetch(`${GATEWAY_API}/v1/transfer/${transferId}`, { cache: "no-store" });
        const st = await sRes.json().catch(() => ({}));
        const status = String(st?.status ?? "").toLowerCase();
        if (status === "confirmed" || status === "finalized") {
          setTStep("done"); setTMsg(`${tAmount} USDC delivered on ${to.name}.`); setTAmount(""); setTimeout(refresh, 2000);
          return;
        }
        if (status === "failed" || status === "expired") throw new Error(`Transfer ${status}. Your Gateway balance was not spent.`);
        await sleep(3000);
      }
      setTStep("done"); setTMsg("Submitted. Delivery is taking longer than usual; check your balance in a minute.");
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string };
      setTStep("error"); setTMsg(err.shortMessage || err.message || "Transfer failed.");
    }
  }

  const card = { background: "linear-gradient(150deg, #0B1B3A 0%, #1E3A8A 45%, #3D5AF1 100%)", color: "#FFFFFF", border: "none", borderRadius: 20, padding: "1.25rem", display: "flex", flexDirection: "column" as const, gap: 12, boxShadow: "0 16px 40px -20px rgba(11,27,58,0.6)" };
  const sectionTitle = (Icon: typeof ArrowRight, text: string) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ width: 36, height: 36, borderRadius: 11, background: "linear-gradient(135deg, #3D5AF1 0%, #6C8BFF 100%)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 6px 16px -6px rgba(61,90,241,0.7)" }}>
        <Icon size={18} color="#FFFFFF" />
      </span>
      <span style={{ fontSize: 19, fontWeight: 700, color: "#FFFFFF", letterSpacing: "-0.01em" }}>{text}</span>
    </div>
  );
  const input = { width: "100%", boxSizing: "border-box" as const, height: 46, padding: "0 14px", borderRadius: 12, border: `1px solid ${LINE}`, fontSize: 14, color: INK, background: "rgba(255,255,255,0.08)" };
  const label = { fontSize: 12, fontWeight: 600, color: MUTED } as const;
  const primary = (on: boolean) => ({ width: "100%", height: 48, borderRadius: 12, border: "none", background: on ? "#FFFFFF" : "rgba(255,255,255,0.12)", color: on ? BLUE : "rgba(255,255,255,0.45)", fontSize: 15, fontWeight: 600, cursor: on ? "pointer" : "not-allowed" });
  const note = (st: string, msg: string | null) => msg && st !== "idle" && (
    <div style={{ padding: "10px 12px", borderRadius: 10, fontSize: 13, lineHeight: 1.5, background: st === "done" ? "#E7F7EF" : st === "error" ? "#FDECEC" : "rgba(255,255,255,0.1)", color: st === "done" ? "#0B7A53" : st === "error" ? "#B91C1C" : INK }}>{msg}</div>
  );

  // Chain picker: logo buttons instead of a plain <select>.
  const chainPicker = (value: string, onPick: (k: string) => void, disabled: boolean, ariaLabel: string, showBal: false | "gateway" | "wallet" = false, exclude?: string) => (
    <div role="radiogroup" aria-label={ariaLabel} style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6 }}>
      {CHAINS.map((c) => {
        const on = value === c.key;
        const off = disabled || c.key === exclude;
        return (
          <button key={c.key} type="button" role="radio" aria-checked={on} disabled={off} onClick={() => onPick(c.key)}
            style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 44, padding: "6px 10px", borderRadius: 12, textAlign: "left",
              border: on ? "1.5px solid #8FB0FF" : `1px solid ${LINE}`, background: on ? "rgba(143,176,255,0.22)" : "rgba(255,255,255,0.06)",
              opacity: c.key === exclude ? 0.35 : 1, cursor: off ? "not-allowed" : "pointer" }}>
            <ChainLogo chain={c.key as ChainKey} size={22} />
            <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: INK }}>{c.name}</span>
              {showBal === "gateway" && <span style={{ fontSize: 11, color: MUTED, fontFamily: "'Geist Mono', ui-monospace, monospace" }}>{bal ? bal[c.key].available.toFixed(2) : "…"} USDC</span>}
              {showBal === "wallet" && <span style={{ fontSize: 11, color: MUTED, fontFamily: "'Geist Mono', ui-monospace, monospace" }}>{walletBal[c.key] === undefined ? "…" : walletBal[c.key].toFixed(2)} USDC</span>}
            </span>
          </button>
        );
      })}
    </div>
  );

  if (!hasBrowser && !hasCircle) {
    return (
      <div style={{ ...card, maxWidth: 480, margin: "0 auto", textAlign: "center", color: MUTED, fontSize: 13.5 }}>
        Connect a browser wallet or sign in with Circle Wallet to use Gateway.
      </div>
    );
  }

  const depAmt = Number(depAmount);
  const canDeposit = Number.isFinite(depAmt) && depAmt > 0 && dStep !== "busy";
  const fromAvail = bal?.[fromChain]?.available ?? 0;
  const tAmt = Number(tAmount);
  const validRecipient = isAddress(recipient.trim());
  const canTransfer = Number.isFinite(tAmt) && tAmt > 0 && tAmt < fromAvail && fromChain !== toChain && validRecipient && tStep !== "busy";
  const tLabel = tStep === "busy" ? "Transferring..." : fromChain === toChain ? "Pick a different destination"
    : !tAmount ? "Enter an amount" : tAmt >= fromAvail ? `Not enough on ${from.name} (fee included)` : !validRecipient ? "Enter a valid address" : `Send ${tAmount} USDC to ${to.name}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 560, margin: "0 auto" }}>
      {(

        <div role="group" aria-label="Wallet" style={{ display: "flex", gap: 2, padding: 3, borderRadius: 12, background: "#ECEAE4" }}>
          {(["browser", "circle"] as const).map((k) => {
            const on = source === k;
            return (
              <button key={k} type="button" aria-pressed={on} onClick={() => setSource(k)}
                style={{ flex: 1, height: 38, borderRadius: 10, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, background: on ? "#FFFFFF" : "transparent", color: on ? PAGE_INK : PAGE_MUTED, boxShadow: on ? "0 1px 2px rgba(22,21,28,0.12)" : "none" }}>
                {k === "browser" ? "Browser wallet" : "Circle Wallet"}
              </button>
            );
          })}
        </div>
      )}

      {!owner ? (
        <div style={{ ...card, alignItems: "center", textAlign: "center", color: MUTED, fontSize: 13.5 }}>
          {source === "circle" ? "Sign in with Circle Wallet to use Gateway with it." : "Connect a browser wallet to use Gateway with it."}
          {onConnect && <button type="button" onClick={onConnect} style={{ ...primary(true), maxWidth: 260 }}>{source === "circle" ? "Sign in with Circle Wallet" : "Connect wallet"}</button>}
        </div>
      ) : (
      <>
      <section style={{ ...card, background: "linear-gradient(150deg, #0B1B3A 0%, #1E3A8A 45%, #3D5AF1 100%)", border: "none", color: "#FFFFFF", boxShadow: "0 16px 40px -20px rgba(11,27,58,0.6)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "rgba(255,255,255,0.85)" }}><TokenLogo symbol="USDC" size={20} /> Unified USDC balance <Layers size={14} /></span>
          <button type="button" aria-label="Refresh" onClick={() => { refresh(); }} style={{ width: 32, height: 32, borderRadius: 9, border: "1px solid rgba(255,255,255,0.35)", background: "transparent", color: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <RefreshCw size={14} />
          </button>
        </div>
        <div style={{ fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: 40, fontWeight: 500, letterSpacing: "-0.02em" }}>
          {bal === null ? (loadingBal ? "…" : "—") : `$${total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
          {CHAINS.map((c) => (
            <div key={c.key} style={{ padding: "8px 10px", borderRadius: 12, background: "rgba(8,20,90,0.22)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "rgba(255,255,255,0.85)" }}>
                <span style={{ borderRadius: "50%", background: "#FFFFFF", padding: 1, display: "flex" }}><ChainLogo chain={c.key as ChainKey} size={16} /></span>{c.name}
              </div>
              <div style={{ fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: 14 }}>{bal ? bal[c.key].available.toFixed(2) : "…"}</div>
              {arriving?.chain === c.key && <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.85)" }}>+{arriving.amount.toFixed(2)} arriving</div>}
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.8)" }}>Spend it on any of these chains in seconds. Circle delivers on the destination, so you need no gas there.</div>
      </section>

      <section style={card}>
        {sectionTitle(ArrowDownLeft, "Deposit")}
        <span style={label}>From your {source === "browser" ? "wallet" : "Circle Wallet"} on</span>
        {chainPicker(depChain, setDepChain, dStep === "busy", "Deposit from chain", "wallet")}
        <label htmlFor="gw-dep-amount" style={{ ...label, display: "flex", alignItems: "center", gap: 6 }}><TokenLogo symbol="USDC" size={16} /> Amount (USDC)</label>
        <input id="gw-dep-amount" inputMode="decimal" value={depAmount} placeholder="0.00" disabled={dStep === "busy"} style={input}
          onChange={(e) => { if (/^\d*\.?\d*$/.test(e.target.value)) setDepAmount(e.target.value); }} />
        {dep.slow && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 14px", borderRadius: 12, background: "#FFF4E0", color: "#6A4308", fontSize: 12.5, lineHeight: 1.5 }}>
            <span>Deposits from {dep.name} take about <strong>20 minutes</strong> while {dep.name} finalizes (deposits from Arc are instant). Needs a little ETH on {dep.name} for gas.</span>
            {onOpenNativeBridge && (
              <span>
                Just want your USDC on Arc now?{" "}
                <button type="button" onClick={onOpenNativeBridge}
                  style={{ border: "none", background: "none", padding: 0, color: BLUE, fontWeight: 700, fontSize: 12.5, cursor: "pointer", textDecoration: "underline" }}>
                  Use Native Bridge (10–20 sec)
                </button>
              </span>
            )}
          </div>
        )}
        {source === "circle" && <p style={{ margin: 0, fontSize: 12, color: MUTED }}>Your Gateway balance counts toward the Circle Wallet limit.</p>}
        {note(dStep, dMsg)}
        {arriving && (
          <div style={{ fontSize: 12.5, color: MUTED }}>
            {arriving.eta > now
              ? `Arriving in about ${Math.max(1, Math.ceil((arriving.eta - now) / 60000))} min (${new Date(arriving.eta).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}).`
              : "Almost there, still checking..."}
          </div>
        )}
        <button type="button" onClick={deposit} disabled={!canDeposit} style={primary(canDeposit)}>{dStep === "busy" ? "Depositing..." : !depAmount ? "Enter an amount" : `Deposit ${depAmount} USDC`}</button>
      </section>

      <section style={card}>
        {sectionTitle(ArrowRight, "Send across chains")}
        <span style={label}>From balance on</span>
        {chainPicker(fromChain, (k) => { setFromChain(k); if (k === toChain) setToChain(CHAINS.find((c) => c.key !== k)!.key); }, tStep === "busy", "Send from chain", "gateway")}
        <span style={label}>To</span>
        {chainPicker(toChain, setToChain, tStep === "busy", "Send to chain", false, fromChain)}
        <label htmlFor="gw-t-amount" style={{ ...label, display: "flex", alignItems: "center", gap: 6 }}><TokenLogo symbol="USDC" size={16} /> Amount (USDC)</label>
        <input id="gw-t-amount" inputMode="decimal" value={tAmount} placeholder="0.00" disabled={tStep === "busy"} style={input}
          onChange={(e) => { if (/^\d*\.?\d*$/.test(e.target.value)) setTAmount(e.target.value); }} />
        <label htmlFor="gw-recipient" style={label}>Recipient on {to.name}</label>
        <input id="gw-recipient" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="0x..." disabled={tStep === "busy"}
          style={{ ...input, fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: 13 }} />
        <p style={{ margin: 0, fontSize: 12, color: MUTED, lineHeight: 1.5 }}>Circle's fee (a few cents; about $1 when the balance is on Ethereum) is taken from your Gateway balance on top of the amount.</p>
        {note(tStep, tMsg)}
        <button type="button" onClick={transfer} disabled={!canTransfer} style={primary(canTransfer)}>{tLabel}</button>
      </section>
      </>
      )}
    </div>
  );
}
