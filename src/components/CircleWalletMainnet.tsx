import { useState, useEffect } from "react";
import { createPublicClient, createWalletClient, custom, http, erc20Abi, formatUnits, parseUnits, isAddress } from "viem";
import type { Chain, EIP1193Provider } from "viem";
import { mainnet, base, arbitrum } from "viem/chains";
import { Copy, Check, ShieldCheck, LogOut, RefreshCw } from "lucide-react";
import { arcMainnet } from "../chains";
import { TokenOnChain, type ChainKey } from "./AssetLogos";
import { useIsMobile } from "../useIsMobile";

// Mainnet Circle Wallet (email sign-in, no seed phrase). Talks ONLY to /api/circle-wallet-mainnet
// (LIVE key), never to the testnet endpoint, and keeps its own localStorage entry so it can't be
// confused with the testnet Circle Wallet. Withdraw is always available, even over the cap or
// once the feature is switched to withdraw-only.
const API = "/api/circle-wallet-mainnet";
const STORAGE_KEY = "flowfi_circle_wallet_live";

interface LiveWallet { address: string; walletsByChain: Record<string, { walletId: string; address: string }>; email: string }
interface Asset { key: string; chainCode: string; chainName: string; chain: Chain; symbol: string; token: `0x${string}`; decimals: number; explorer: string }

const ASSETS: Asset[] = [
  { key: "arc-usdc", chainCode: "ARC", chainName: "Arc", chain: arcMainnet, symbol: "USDC", token: "0x3600000000000000000000000000000000000000", decimals: 6, explorer: "https://arc.etherscan.io" },
  { key: "arc-eurc", chainCode: "ARC", chainName: "Arc", chain: arcMainnet, symbol: "EURC", token: "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1", decimals: 6, explorer: "https://arc.etherscan.io" },
  { key: "arc-cirbtc", chainCode: "ARC", chainName: "Arc", chain: arcMainnet, symbol: "cirBTC", token: "0x171A4217b86A807A64eB94757Db6849fb4bDbAA0", decimals: 8, explorer: "https://arc.etherscan.io" },
  { key: "base-usdc", chainCode: "BASE", chainName: "Base", chain: base, symbol: "USDC", token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6, explorer: "https://basescan.org" },
  { key: "eth-usdc", chainCode: "ETH", chainName: "Ethereum", chain: mainnet, symbol: "USDC", token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6, explorer: "https://etherscan.io" },
  { key: "arb-usdc", chainCode: "ARB", chainName: "Arbitrum", chain: arbitrum, symbol: "USDC", token: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6, explorer: "https://arbiscan.io" },
];

// Assets that can be added from the browser wallet. cirBTC counts toward the holding cap at the
// live BTC price (the backend prices it; the UI sizes deposits with the price it returns).
// Arc only: the Base/Ethereum/Arbitrum wallets are EOAs that would need ETH for gas to move funds
// back out, and ETH can't be added or withdrawn here. On Arc, gas is paid in USDC.
const DEPOSIT_KEYS = ["arc-usdc", "arc-eurc", "arc-cirbtc"];

async function switchTo(provider: EIP1193Provider, chain: Chain) {
  const isArc = chain.id === arcMainnet.id;
  const want = `0x${chain.id.toString(16)}`;
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

const BLUE = "#3D5AF1";
// Cards use the Arc navy gradient, so text/line tokens are light. PAGE_* are for text that
// sits on the light page background outside the cards.
const INK = "#16151C";
const MUTED = "#5E5B6B";
const LINE = "#DCE2F7";
const PAGE_MUTED = "#5E5B6B";
const LINK = "#3D5AF1";

async function post(body: Record<string, unknown>) {
  const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.error ?? "Something went wrong.");
  return data;
}

function loadSaved(): LiveWallet | null {
  try {
    const p = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    return p?.email && p?.address ? p : null;
  } catch { return null; }
}


export default function CircleWalletMainnet({ browserAddress, provider }: { browserAddress?: string; provider?: EIP1193Provider }) {
  const [wallet, setWallet] = useState<LiveWallet | null>(null);
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balances, setBalances] = useState<Record<string, string | null>>({});
  const [status, setStatus] = useState<{ stableTotal: number; capUsd: number; overCap: boolean; withdrawOnly: boolean; btcPrice?: number | null; priceOk?: boolean; complete?: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const isMobile = useIsMobile();
  const [tab, setTab] = useState<"add" | "withdraw">("add");

  const [assetKey, setAssetKey] = useState("arc-usdc");
  const [amount, setAmount] = useState("");
  const [dest, setDest] = useState(browserAddress ?? "");
  const [wStep, setWStep] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [wMsg, setWMsg] = useState<string | null>(null);
  const [wHash, setWHash] = useState<string | null>(null);

  const [depKey, setDepKey] = useState("arc-usdc");
  const [depAmount, setDepAmount] = useState("");
  const [depBal, setDepBal] = useState<string | null>(null);
  const [dStep, setDStep] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [dMsg, setDMsg] = useState<string | null>(null);
  const [dHash, setDHash] = useState<string | null>(null);

  const asset = ASSETS.find((a) => a.key === assetKey)!;
  const depAsset = ASSETS.find((a) => a.key === depKey)!;

  // Browser-wallet balance of the asset being deposited.
  useEffect(() => {
    let cancelled = false;
    setDepBal(null);
    if (!browserAddress) return;
    (async () => {
      try {
        const pc = createPublicClient({ chain: depAsset.chain, transport: http() });
        const raw = await pc.readContract({ address: depAsset.token, abi: erc20Abi, functionName: "balanceOf", args: [browserAddress as `0x${string}`] });
        if (!cancelled) setDepBal(formatUnits(raw, depAsset.decimals));
      } catch { if (!cancelled) setDepBal(null); }
    })();
    return () => { cancelled = true; };
  }, [depKey, browserAddress, dStep === "done"]);

  useEffect(() => { setWallet(loadSaved()); }, []);
  useEffect(() => { if (browserAddress && !dest) setDest(browserAddress); }, [browserAddress]);

  async function refresh(w: LiveWallet) {
    const entries = await Promise.all(ASSETS.map(async (a) => {
      const addr = w.walletsByChain[a.chainCode]?.address;
      if (!addr) return [a.key, null] as const;
      try {
        const pc = createPublicClient({ chain: a.chain, transport: http() });
        const raw = await pc.readContract({ address: a.token, abi: erc20Abi, functionName: "balanceOf", args: [addr as `0x${string}`] });
        return [a.key, formatUnits(raw, a.decimals)] as const;
      } catch { return [a.key, null] as const; }
    }));
    setBalances(Object.fromEntries(entries));
    try { setStatus(await post({ action: "status" })); } catch (e) {
      if (e instanceof Error && e.message.toLowerCase().includes("session")) signOut();
    }
  }

  useEffect(() => {
    if (!wallet) return;
    refresh(wallet);
    const t = setInterval(() => refresh(wallet), 20000);
    return () => clearInterval(t);
  }, [wallet]);

  async function sendCode() {
    setBusy(true); setError(null);
    try { await post({ action: "requestCode", email: email.trim() }); setStep("code"); }
    catch (e) { setError(e instanceof Error ? e.message : "Unexpected error."); }
    finally { setBusy(false); }
  }

  async function confirmCode() {
    setBusy(true); setError(null);
    try {
      const d = await post({ action: "verifyCode", email: email.trim(), code: code.trim() });
      const w: LiveWallet = { address: d.address, walletsByChain: d.walletsByChain, email: d.email };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(w));
      window.dispatchEvent(new Event("circle-live-changed"));
      setWallet(w);
    } catch (e) { setError(e instanceof Error ? e.message : "Unexpected error."); }
    finally { setBusy(false); }
  }

  function signOut() {
    localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new Event("circle-live-changed"));
    fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "logout" }) }).catch(() => {});
    setWallet(null); setStatus(null); setBalances({}); setStep("email"); setCode(""); setError(null);
  }

  async function withdraw() {
    if (!wallet) return;
    const walletId = wallet.walletsByChain[asset.chainCode]?.walletId;
    if (!walletId) { setWStep("error"); setWMsg(`No ${asset.chainName} wallet on this account.`); return; }
    setWStep("sending"); setWMsg("Sending..."); setWHash(null);
    try {
      const { transactionId } = await post({ action: "withdraw", walletId, tokenAddress: asset.token, amount: amount.trim(), destinationAddress: dest.trim() });
      const start = Date.now();
      while (Date.now() - start < 180000) {
        const s = await post({ action: "getTransaction", transactionId });
        if (s.state === "COMPLETE") { setWHash(s.txHash ?? null); setWStep("done"); setWMsg(`${amount} ${asset.symbol} sent to your wallet.`); setAmount(""); refresh(wallet); return; }
        if (["FAILED", "CANCELLED", "DENIED"].includes(s.state)) throw new Error(s.errorReason ?? `Withdrawal ${String(s.state).toLowerCase()}.`);
        await new Promise((r) => setTimeout(r, 3000));
      }
      throw new Error("Still processing. Check your balance again in a minute.");
    } catch (e) { setWStep("error"); setWMsg(e instanceof Error ? e.message : "Withdrawal failed."); }
  }

  async function deposit() {
    if (!wallet || !provider || !browserAddress) return;
    const to = wallet.walletsByChain[depAsset.chainCode]?.address;
    if (!to) { setDStep("error"); setDMsg(`No ${depAsset.chainName} wallet on this account.`); return; }
    setDStep("sending"); setDMsg(`Confirm the transfer in your wallet (${depAsset.chainName})...`); setDHash(null);
    try {
      await switchTo(provider, depAsset.chain);
      const wc = createWalletClient({ account: browserAddress as `0x${string}`, chain: depAsset.chain, transport: custom(provider) });
      const pc = createPublicClient({ chain: depAsset.chain, transport: http() });
      const hash = await wc.writeContract({ address: depAsset.token, abi: erc20Abi, functionName: "transfer", args: [to as `0x${string}`, parseUnits(depAmount.trim(), depAsset.decimals)] });
      setDHash(hash); setDMsg("Waiting for confirmation...");
      const r = await pc.waitForTransactionReceipt({ hash });
      if (r.status === "reverted") throw new Error("The transfer reverted. Nothing was sent.");
      setDStep("done"); setDMsg(`${depAmount} ${depAsset.symbol} added to your Circle Wallet.`); setDepAmount("");
      refresh(wallet);
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string };
      setDStep("error"); setDMsg(err.shortMessage || err.message || "Deposit failed.");
    }
  }

  const card = { background: "rgba(255,255,255,0.6)", backdropFilter: "blur(20px) saturate(160%)", WebkitBackdropFilter: "blur(20px) saturate(160%)", color: INK, border: "1px solid rgba(255,255,255,0.8)", borderRadius: 24, padding: "1.25rem", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.9)" } as const;
  const input = { width: "100%", boxSizing: "border-box" as const, height: 46, padding: "0 14px", borderRadius: 12, border: `1px solid ${LINE}`, fontSize: 14, color: INK, background: "rgba(255,255,255,0.85)" };
  const primary = (on: boolean) => ({ width: "100%", height: 48, borderRadius: 12, border: "none", background: on ? BLUE : "rgba(61,90,241,0.10)", color: on ? "#FFFFFF" : "#8A93B8", boxShadow: on ? "0 10px 24px -12px rgba(61,90,241,0.8)" : "none", fontSize: 15, fontWeight: 600, cursor: on ? "pointer" : "not-allowed" });

  if (!wallet) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 460, margin: "0 auto" }}>
        <div style={{ ...card, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: INK }}>Sign in with email</div>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: MUTED }}>No seed phrase, no extension. We send a 6-digit code; the same email always opens the same wallet.</p>
          {error && <div style={{ padding: "10px 12px", borderRadius: 10, background: "#FDECEC", color: "#B91C1C", fontSize: 13 }}>{error}</div>}
          {step === "email" ? (
            <>
              <label htmlFor="cw-live-email" style={{ fontSize: 12, fontWeight: 600, color: MUTED }}>Email</label>
              <input id="cw-live-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" style={input}
                onKeyDown={(e) => { if (e.key === "Enter" && email.trim() && !busy) sendCode(); }} />
              <button type="button" onClick={sendCode} disabled={busy || !email.trim()} style={primary(!busy && !!email.trim())}>{busy ? "Sending code..." : "Send code"}</button>
            </>
          ) : (
            <>
              <label htmlFor="cw-live-code" style={{ fontSize: 12, fontWeight: 600, color: MUTED }}>Code sent to {email.trim()}</label>
              <input id="cw-live-code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456"
                style={{ ...input, fontSize: 20, letterSpacing: 6, textAlign: "center" }}
                onKeyDown={(e) => { if (e.key === "Enter" && code.trim() && !busy) confirmCode(); }} />
              <button type="button" onClick={confirmCode} disabled={busy || !code.trim()} style={primary(!busy && !!code.trim())}>{busy ? "Verifying..." : "Verify & continue"}</button>
              <button type="button" onClick={() => { setStep("email"); setError(null); }} style={{ background: "none", border: "none", color: MUTED, fontSize: 13, cursor: "pointer" }}>Use a different email</button>
            </>
          )}
        </div>
        <p style={{ margin: 0, fontSize: 12, color: PAGE_MUTED, textAlign: "center", lineHeight: 1.5 }}>Real funds. Each account holds up to ${status?.capUsd ?? 100} in total, and you can withdraw to your own wallet at any time.</p>
      </div>
    );
  }

  const chainKeyOf = (a: Asset): ChainKey => ({ ARC: "arc", BASE: "base", ETH: "ethereum", ARB: "arbitrum" } as const)[a.chainCode as "ARC" | "BASE" | "ETH" | "ARB"];
  // Asset picker: token-with-chain logo buttons instead of a plain <select>.
  const assetPicker = (list: Asset[], value: string, onPick: (k: string) => void, disabled: boolean, ariaLabel: string) => (
    <div role="radiogroup" aria-label={ariaLabel} style={{ display: "grid", gridTemplateColumns: `repeat(${isMobile ? 2 : 3}, minmax(0, 1fr))`, gap: 8 }}>
      {list.map((a) => {
        const on = value === a.key;
        return (
          <button key={a.key} type="button" role="radio" aria-checked={on} disabled={disabled} onClick={() => onPick(a.key)}
            style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 54, padding: "8px 10px", borderRadius: 14, textAlign: "left",
              border: on ? `1.5px solid ${BLUE}` : "1px solid rgba(255,255,255,0.95)", background: on ? "rgba(61,90,241,0.10)" : "rgba(255,255,255,0.8)", boxShadow: on ? "none" : "0 3px 10px -6px rgba(36,58,150,0.3)", cursor: disabled ? "not-allowed" : "pointer" }}>
            <TokenOnChain symbol={a.symbol} chain={chainKeyOf(a)} size={28} />
            <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: INK }}>{a.symbol}</span>
              <span style={{ fontSize: 11.5, color: MUTED }}>on {a.chainName}</span>
            </span>
          </button>
        );
      })}
    </div>
  );

  const room = status ? Math.max(0, status.capUsd - status.stableTotal) : 0;
  const depBalNum = Number(depBal ?? 0);
  const depAmt = Number(depAmount);
  const isBtc = depAsset.symbol === "cirBTC";
  const btc = status?.btcPrice ?? null;
  const usdPerUnit = isBtc ? (btc ?? 0) : 1;
  const depUsd = depAmt * usdPerUnit;
  const unitDigits = isBtc ? 8 : 2;
  const floorTo = (n: number, d: number) => Math.floor(n * 10 ** d) / 10 ** d;
  const depMax = usdPerUnit > 0 ? floorTo(Math.min(depBalNum, room / usdPerUnit), unitDigits) : 0;
  const depValid = Number.isFinite(depAmt) && depAmt > 0 && depAmt <= depBalNum && usdPerUnit > 0 && depUsd <= room;
  const canDeposit = !!provider && !!browserAddress && !!status && status.complete !== false && !status.withdrawOnly && !status.overCap && depValid && dStep !== "sending";
  const depLabel = !provider || !browserAddress ? "Connect a browser wallet to deposit"
    : !status ? "Loading..."
    : status.withdrawOnly ? "Adding funds isn't available"
    : status.complete === false ? "Balances unavailable, try again shortly"
    : dStep === "sending" ? "Depositing..."
    : isBtc && !btc ? "BTC price unavailable, try again shortly"
    : room <= 0 ? `Limit reached ($${status.capUsd})`
    : !depAmount ? "Enter an amount"
    : depAmt > depBalNum ? "Not enough balance"
    : depUsd > room ? (isBtc ? `Max ${depMax} cirBTC (≈ $${room.toFixed(2)} limit)` : `Max $${room.toFixed(2)} (limit)`)
    : `Deposit ${depAmount} ${depAsset.symbol}`;

  const balNum = Number(balances[asset.key] ?? 0);
  const amt = Number(amount);
  const validAmt = Number.isFinite(amt) && amt > 0 && amt <= balNum;
  const validDest = isAddress(dest.trim());
  const canWithdraw = validAmt && validDest && wStep !== "sending";

  const DISPLAY = "'Bricolage Grotesque', 'Geist', system-ui, sans-serif";
  const label = { fontSize: 12.5, fontWeight: 600, color: MUTED } as const;
  const bigAmount = (id: string, value: string, set: (v: string) => void, disabled: boolean, onMax: () => void, suffix: string) => (
    <div style={{ position: "relative" }}>
      <input id={id} aria-label={`Amount in ${suffix}`} inputMode="decimal" value={value} placeholder="0.00" disabled={disabled}
        onChange={(e) => { if (/^\d*\.?\d*$/.test(e.target.value)) set(e.target.value); }}
        style={{ ...input, height: 68, fontSize: 30, fontWeight: 500, padding: "0 150px 0 18px", borderRadius: 16, border: "1px solid rgba(255,255,255,0.95)", background: "rgba(255,255,255,0.85)", boxShadow: "inset 0 1px 2px rgba(36,58,150,0.06), 0 3px 10px -6px rgba(36,58,150,0.3)" }} />
      <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: MUTED }}>{suffix}</span>
        <button type="button" onClick={onMax} disabled={disabled}
          style={{ border: "none", background: "rgba(61,90,241,0.10)", color: BLUE, fontSize: 13, fontWeight: 700, padding: "7px 12px", borderRadius: 10, cursor: "pointer" }}>MAX</button>
      </span>
    </div>
  );
  const msgBox = (st: string, msg: string | null, hash: string | null, explorer: string) => msg && st !== "idle" && (
    <div style={{ padding: "10px 12px", borderRadius: 10, fontSize: 13, background: st === "done" ? "#E7F7EF" : st === "error" ? "#FDECEC" : "rgba(61,90,241,0.08)", color: st === "done" ? "#0B7A53" : st === "error" ? "#B91C1C" : INK }}>
      {msg}{" "}
      {hash && <a href={`${explorer}/tx/${hash}`} target="_blank" rel="noopener noreferrer" style={{ color: LINK, fontWeight: 600 }}>View tx ↗</a>}
    </div>
  );
  const smallBtn = { width: 38, height: 38, borderRadius: 11, border: "1px solid rgba(255,255,255,0.95)", background: "rgba(255,255,255,0.85)", color: BLUE, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: "0 3px 10px -6px rgba(36,58,150,0.35)" } as const;

  const accountCard = (
    <div style={{ ...card, padding: "1.5rem", display: "flex", flexDirection: "column", gap: 14, position: isMobile ? "static" : "sticky", top: 24, boxShadow: "0 16px 40px -24px rgba(36,58,150,0.35), inset 0 1px 0 rgba(255,255,255,0.9)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, color: MUTED }}>Signed in as</div>
          <div style={{ fontSize: 17, fontWeight: 600, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{wallet.email}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" aria-label="Refresh balances" onClick={() => refresh(wallet)} style={smallBtn}><RefreshCw size={16} /></button>
          <button type="button" aria-label="Sign out" onClick={signOut} style={smallBtn}><LogOut size={16} /></button>
        </div>
      </div>
      <div style={{ padding: "10px 12px", borderRadius: 12, background: "rgba(255,255,255,0.8)", border: "1px solid rgba(255,255,255,0.95)", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ flex: 1, minWidth: 0, fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: 12.5, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{wallet.address}</span>
        <button type="button" aria-label="Copy address" onClick={() => { navigator.clipboard.writeText(wallet.address); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
          style={{ width: 32, height: 32, borderRadius: 8, border: "none", background: "transparent", color: copied ? "#0E9F6E" : BLUE, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
          {copied ? <Check size={15} /> : <Copy size={15} />}
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 14, fontWeight: 500, color: MUTED }}>Total value</span>
        <span style={{ fontFamily: DISPLAY, fontSize: isMobile ? 44 : 56, fontWeight: 800, color: INK, letterSpacing: "-0.03em", lineHeight: 1.05 }}>
          {status ? `$${status.stableTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "…"}
        </span>
        <span style={{ fontSize: 12.5, color: MUTED }}>Limit ${status?.capUsd ?? 100} in total · cirBTC counted at the BTC price</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
        {ASSETS.map((a) => {
          const has = Number(balances[a.key] ?? 0) > 0;
          return (
            <div key={a.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 16, background: "linear-gradient(180deg, #FFFFFF 0%, #F0F3FF 100%)", border: "1px solid #FFFFFF", boxShadow: "inset 0 1px 0 #FFFFFF, inset 0 -2px 0 rgba(61,90,241,0.06), 0 8px 18px -10px rgba(61,90,241,0.45), 0 1px 2px rgba(22,21,28,0.06)", minWidth: 0 }}>
              <TokenOnChain symbol={a.symbol} chain={chainKeyOf(a)} size={34} />
              <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: MUTED }}>{a.chainName}</span>
                <span style={{ fontFamily: DISPLAY, fontSize: 18, fontWeight: 800, color: has ? INK : "#A3A7B8", letterSpacing: "-0.01em", lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {balances[a.key] === undefined ? "…" : balances[a.key] === null ? "—" : Number(balances[a.key]).toLocaleString("en-US", { maximumFractionDigits: a.decimals === 8 ? 8 : 2 })}{" "}
                  <span style={{ color: has ? BLUE : "#A3A7B8" }}>{a.symbol}</span>
                </span>
              </span>
            </div>
          );
        })}
      </div>
      <p style={{ margin: 0, fontSize: 12, color: MUTED, lineHeight: 1.5 }}>Same address on Arc, Base, Ethereum and Arbitrum.</p>
    </div>
  );

  const addPane = (
    <>
      <p style={{ margin: 0, fontSize: 13, color: MUTED, lineHeight: 1.5 }}>
        From your connected wallet. {status ? `You can add up to $${room.toFixed(2)} more (limit $${status.capUsd}).` : ""}
      </p>
      <span style={label}>Asset</span>
      {assetPicker(ASSETS.filter((a) => DEPOSIT_KEYS.includes(a.key)), depKey, (k) => { setDepKey(k); setDepAmount(""); }, dStep === "sending", "Asset to add")}
      <span style={label}>
        Amount{depBal !== null ? ` · in your wallet: ${depBalNum.toLocaleString("en-US", { maximumFractionDigits: unitDigits })} ${depAsset.symbol}` : ""}{isBtc && btc && depAmt > 0 ? ` · ≈ $${depUsd.toFixed(2)}` : ""}
      </span>
      {bigAmount("cw-live-dep-amount", depAmount, setDepAmount, dStep === "sending", () => setDepAmount(depMax > 0 ? String(depMax) : ""), depAsset.symbol)}
      <p style={{ margin: 0, fontSize: 12, color: MUTED }}>Funds are added on Arc, where gas is paid in USDC.</p>
      {msgBox(dStep, dMsg, dHash, depAsset.explorer)}
      <button type="button" onClick={deposit} disabled={!canDeposit} style={primary(canDeposit)}>{depLabel}</button>
    </>
  );

  const withdrawPane = (
    <>
      <span style={label}>Asset</span>
      {assetPicker(ASSETS, assetKey, (k) => { setAssetKey(k); setAmount(""); }, wStep === "sending", "Asset to withdraw")}
      <span style={label}>Amount · available {Number(balances[asset.key] ?? 0).toLocaleString("en-US", { maximumFractionDigits: asset.decimals === 8 ? 8 : 2 })} {asset.symbol}</span>
      {bigAmount("cw-live-amount", amount, setAmount, wStep === "sending", () => setAmount(balances[asset.key] ?? ""), asset.symbol)}
      <label htmlFor="cw-live-dest" style={label}>Your wallet address on {asset.chainName}</label>
      <input id="cw-live-dest" value={dest} onChange={(e) => setDest(e.target.value)} placeholder="0x..." disabled={wStep === "sending"} style={{ ...input, height: 50, borderRadius: 14, fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: 13 }} />
      {browserAddress && dest.trim().toLowerCase() !== browserAddress.toLowerCase() && (
        <button type="button" onClick={() => setDest(browserAddress)} style={{ alignSelf: "flex-start", border: "none", background: "none", color: LINK, fontSize: 12.5, fontWeight: 600, cursor: "pointer", padding: 0 }}>Use my connected wallet</button>
      )}
      {asset.chainCode !== "ARC" && <p style={{ margin: 0, fontSize: 12, color: "#B45309", lineHeight: 1.5 }}>Withdrawing on {asset.chainName} needs a little ETH for gas in this Circle wallet. Send a small amount of ETH on {asset.chainName} to the address above from your own wallet first.</p>}
      {msgBox(wStep, wMsg, wHash, asset.explorer)}
      <button type="button" onClick={withdraw} disabled={!canWithdraw} style={primary(canWithdraw)}>
        {wStep === "sending" ? "Withdrawing..." : !amount ? "Enter an amount" : amt > balNum ? "Not enough balance" : !validDest ? "Enter a valid address" : `Withdraw ${amount} ${asset.symbol}`}
      </button>
    </>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 1040, margin: "0 auto" }}>
      {status?.withdrawOnly && (
        <div style={{ padding: "12px 14px", borderRadius: 14, background: "#FFF4E0", color: "#6A4308", fontSize: 13, lineHeight: 1.5 }}>
          Adding funds isn't available right now. You can withdraw to your own wallet at any time.
        </div>
      )}
      {status?.overCap && !status.withdrawOnly && (
        <div style={{ padding: "12px 14px", borderRadius: 14, background: "#FDECEC", color: "#B91C1C", fontSize: 13, lineHeight: 1.5 }}>
          This wallet holds more than the ${status.capUsd} limit. Other actions are paused until you withdraw the excess.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) minmax(0, 1fr)", gap: 20, alignItems: "start" }}>
        {accountCard}
        <div style={{ ...card, background: "rgba(255,255,255,0.75)", border: "1px solid rgba(255,255,255,0.95)", padding: "1.25rem 1.5rem 1.5rem", display: "flex", flexDirection: "column", gap: 14, boxShadow: "0 16px 40px -24px rgba(36,58,150,0.35), inset 0 1px 0 rgba(255,255,255,0.9)" }}>
          <div role="tablist" aria-label="Circle Wallet action" style={{ display: "flex", borderBottom: `1px solid ${LINE}`, margin: "-0.25rem -0.25rem 0" }}>
            {([["add", "Add funds"], ["withdraw", "Withdraw"]] as const).map(([k, t]) => {
              const on = (status?.withdrawOnly ? "withdraw" : tab) === k;
              return (
                <button key={k} type="button" role="tab" aria-selected={on} onClick={() => setTab(k)} disabled={k === "add" && !!status?.withdrawOnly}
                  style={{ flex: 1, height: 48, border: "none", background: "transparent", cursor: "pointer", fontSize: 16, fontWeight: on ? 600 : 500, color: on ? BLUE : MUTED, borderBottom: on ? `2.5px solid ${BLUE}` : "2.5px solid transparent", marginBottom: -1 }}>
                  {t}
                </button>
              );
            })}
          </div>
          {tab === "add" && !status?.withdrawOnly ? addPane : withdrawPane}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "flex-start", justifyContent: "center", fontSize: 12, color: PAGE_MUTED, lineHeight: 1.5 }}>
        <ShieldCheck size={15} style={{ flexShrink: 0, marginTop: 1 }} />
        Circle Wallet is a convenience wallet with a small holding limit. For larger amounts, use your own wallet.
      </div>
    </div>
  );
}
