import { useState, useEffect } from "react";
import { createPublicClient, createWalletClient, custom, http, erc20Abi, formatUnits, parseUnits, isAddress } from "viem";
import type { Chain, EIP1193Provider } from "viem";
import { mainnet, base, arbitrum } from "viem/chains";
import { ArrowUpRight, ArrowDownLeft, Copy, Check, ShieldCheck, LogOut, RefreshCw, QrCode, Send } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { arcMainnet } from "../chains";
import { TokenOnChain, type ChainKey } from "./AssetLogos";

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

// Deposits are limited to stablecoins, because only USDC/EURC count toward the holding cap.
// (cirBTC that arrives from outside can still be withdrawn.)
const DEPOSIT_KEYS = ["arc-usdc", "arc-eurc", "base-usdc", "eth-usdc", "arb-usdc"];

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
const INK = "#16151C";
const MUTED = "#5E5B6B";
const LINE = "#E7E4DD";

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
  const [status, setStatus] = useState<{ stableTotal: number; capUsd: number; overCap: boolean; withdrawOnly: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

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

  // Send: same backend action as withdraw (always allowed, even over the cap), but to any
  // recipient the user types in, e.g. a friend's address.
  const [sKey, setSKey] = useState("arc-usdc");
  const [sAmount, setSAmount] = useState("");
  const [sTo, setSTo] = useState("");
  const [sStep, setSStep] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [sMsg, setSMsg] = useState<string | null>(null);
  const [sHash, setSHash] = useState<string | null>(null);
  const [recvCopied, setRecvCopied] = useState(false);
  const sAsset = ASSETS.find((a) => a.key === sKey)!;

  async function sendOut() {
    if (!wallet) return;
    const walletId = wallet.walletsByChain[sAsset.chainCode]?.walletId;
    if (!walletId) { setSStep("error"); setSMsg(`No ${sAsset.chainName} wallet on this account.`); return; }
    setSStep("sending"); setSMsg("Sending..."); setSHash(null);
    try {
      const { transactionId } = await post({ action: "withdraw", walletId, tokenAddress: sAsset.token, amount: sAmount.trim(), destinationAddress: sTo.trim() });
      const start = Date.now();
      while (Date.now() - start < 180000) {
        const st = await post({ action: "getTransaction", transactionId });
        if (st.state === "COMPLETE") { setSHash(st.txHash ?? null); setSStep("done"); setSMsg(`${sAmount} ${sAsset.symbol} sent.`); setSAmount(""); refresh(wallet); return; }
        if (["FAILED", "CANCELLED", "DENIED"].includes(st.state)) throw new Error(st.errorReason ?? `Send ${String(st.state).toLowerCase()}.`);
        await new Promise((r) => setTimeout(r, 3000));
      }
      throw new Error("Still processing. Check your balance again in a minute.");
    } catch (e) { setSStep("error"); setSMsg(e instanceof Error ? e.message : "Send failed."); }
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

  const card = { background: "#FFFFFF", border: `1px solid ${LINE}`, borderRadius: 20, padding: "1.25rem" } as const;
  const input = { width: "100%", boxSizing: "border-box" as const, height: 46, padding: "0 14px", borderRadius: 12, border: `1px solid ${LINE}`, fontSize: 14, color: INK, background: "#FFFFFF" };
  const primary = (on: boolean) => ({ width: "100%", height: 48, borderRadius: 12, border: "none", background: on ? BLUE : "#EEEDF5", color: on ? "#FFFFFF" : "#8A8798", fontSize: 15, fontWeight: 600, cursor: on ? "pointer" : "not-allowed" });

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
        <p style={{ margin: 0, fontSize: 12, color: MUTED, textAlign: "center", lineHeight: 1.5 }}>Real funds. Each account holds up to ${status?.capUsd ?? 100} in stablecoins, and you can withdraw to your own wallet at any time.</p>
      </div>
    );
  }

  const chainKeyOf = (a: Asset): ChainKey => ({ ARC: "arc", BASE: "base", ETH: "ethereum", ARB: "arbitrum" } as const)[a.chainCode as "ARC" | "BASE" | "ETH" | "ARB"];
  // Asset picker: token-with-chain logo buttons instead of a plain <select>.
  const assetPicker = (list: Asset[], value: string, onPick: (k: string) => void, disabled: boolean, ariaLabel: string) => (
    <div role="radiogroup" aria-label={ariaLabel} style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6 }}>
      {list.map((a) => {
        const on = value === a.key;
        return (
          <button key={a.key} type="button" role="radio" aria-checked={on} disabled={disabled} onClick={() => onPick(a.key)}
            style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 48, padding: "6px 10px", borderRadius: 12, textAlign: "left",
              border: on ? `1.5px solid ${BLUE}` : `1px solid ${LINE}`, background: on ? "#EEF1FE" : "#FFFFFF", cursor: disabled ? "not-allowed" : "pointer" }}>
            <TokenOnChain symbol={a.symbol} chain={chainKeyOf(a)} size={28} />
            <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: on ? BLUE : INK }}>{a.symbol}</span>
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
  const depMax = Math.floor(Math.min(depBalNum, room) * 100) / 100;
  const depValid = Number.isFinite(depAmt) && depAmt > 0 && depAmt <= depBalNum && depAmt <= room;
  const canDeposit = !!provider && !!browserAddress && !!status && !status.withdrawOnly && !status.overCap && depValid && dStep !== "sending";
  const depLabel = !provider || !browserAddress ? "Connect a browser wallet to deposit"
    : !status ? "Loading..."
    : status.withdrawOnly ? "Deposits are closed"
    : dStep === "sending" ? "Depositing..."
    : room <= 0 ? `Limit reached ($${status.capUsd})`
    : !depAmount ? "Enter an amount"
    : depAmt > depBalNum ? "Not enough balance"
    : depAmt > room ? `Max $${room.toFixed(2)} (limit)`
    : `Deposit ${depAmount} ${depAsset.symbol}`;

  const sBal = Number(balances[sKey] ?? 0);
  const sAmt = Number(sAmount);
  const sValidAmt = Number.isFinite(sAmt) && sAmt > 0 && sAmt <= sBal;
  const sValidTo = isAddress(sTo.trim());
  const canSend = sValidAmt && sValidTo && sStep !== "sending";

  const balNum = Number(balances[asset.key] ?? 0);
  const amt = Number(amount);
  const validAmt = Number.isFinite(amt) && amt > 0 && amt <= balNum;
  const validDest = isAddress(dest.trim());
  const canWithdraw = validAmt && validDest && wStep !== "sending";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 560, margin: "0 auto" }}>
      {status?.withdrawOnly && (
        <div style={{ padding: "12px 14px", borderRadius: 14, background: "#FFF4E0", color: "#6A4308", fontSize: 13, lineHeight: 1.5 }}>
          Circle Wallet on FlowFi is closing. Please withdraw your funds to your own wallet below.
        </div>
      )}
      {status?.overCap && !status.withdrawOnly && (
        <div style={{ padding: "12px 14px", borderRadius: 14, background: "#FDECEC", color: "#B91C1C", fontSize: 13, lineHeight: 1.5 }}>
          This wallet holds more than the ${status.capUsd} limit. Other actions are paused until you withdraw the excess.
        </div>
      )}

      <div style={{ ...card, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, color: MUTED }}>Signed in as</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{wallet.email}</div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" aria-label="Refresh balances" onClick={() => refresh(wallet)} style={{ width: 36, height: 36, borderRadius: 10, border: `1px solid ${LINE}`, background: "#FFFFFF", color: MUTED, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><RefreshCw size={15} /></button>
            <button type="button" aria-label="Sign out" onClick={signOut} style={{ width: 36, height: 36, borderRadius: 10, border: `1px solid ${LINE}`, background: "#FFFFFF", color: MUTED, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><LogOut size={15} /></button>
          </div>
        </div>
        <div style={{ padding: "10px 12px", borderRadius: 12, background: "#F5F7FF", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ flex: 1, minWidth: 0, fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: 12.5, color: INK, wordBreak: "break-all" }}>{wallet.address}</span>
          <button type="button" aria-label="Copy address" onClick={() => { navigator.clipboard.writeText(wallet.address); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
            style={{ width: 32, height: 32, borderRadius: 8, border: "none", background: "transparent", color: copied ? "#0E9F6E" : MUTED, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </button>
        </div>
        <p style={{ margin: 0, fontSize: 12, color: MUTED, lineHeight: 1.5 }}>Same address on Arc, Base, Ethereum and Arbitrum. Holding limit: ${status?.capUsd ?? 100} in stablecoins{status ? ` (now $${status.stableTotal.toFixed(2)})` : ""}.</p>

        <div style={{ display: "flex", flexDirection: "column" }}>
          {ASSETS.map((a, i) => (
            <div key={a.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderTop: i ? `1px solid ${LINE}` : "none", fontSize: 13.5 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <TokenOnChain symbol={a.symbol} chain={chainKeyOf(a)} size={30} />
                <span style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontWeight: 600, color: INK }}>{a.symbol}</span>
                  <span style={{ fontSize: 11.5, color: MUTED }}>{a.chainName}</span>
                </span>
              </span>
              <span style={{ fontFamily: "'Geist Mono', ui-monospace, monospace", fontWeight: 500, color: INK }}>
                {balances[a.key] === undefined ? "…" : balances[a.key] === null ? "—" : Number(balances[a.key]).toLocaleString("en-US", { maximumFractionDigits: a.decimals === 8 ? 8 : 2 })}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ ...card, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <QrCode size={18} color={BLUE} />
          <span style={{ fontSize: 17, fontWeight: 600, color: INK }}>Receive</span>
        </div>
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ padding: 10, borderRadius: 14, border: `1px solid ${LINE}`, background: "#FFFFFF", flexShrink: 0 }}>
            <QRCodeSVG value={wallet.address} size={132} fgColor={INK} bgColor="#FFFFFF" />
          </div>
          <div style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: 12.5, color: INK, wordBreak: "break-all", lineHeight: 1.5 }}>{wallet.address}</div>
            <button type="button" onClick={() => { navigator.clipboard.writeText(wallet.address); setRecvCopied(true); setTimeout(() => setRecvCopied(false), 1500); }}
              style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 6, height: 40, padding: "0 16px", borderRadius: 10, border: "none", background: recvCopied ? "#0E9F6E" : BLUE, color: "#FFFFFF", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>
              {recvCopied ? <Check size={15} /> : <Copy size={15} />} {recvCopied ? "Copied" : "Copy address"}
            </button>
          </div>
        </div>
        <div style={{ padding: "10px 12px", borderRadius: 12, background: "#FFF4E0", color: "#6A4308", fontSize: 12.5, lineHeight: 1.5 }}>
          Send <strong>USDC or EURC on the Arc network</strong> to this address, from an exchange or any wallet. Other networks aren't supported here: funds sent on Base, Ethereum or Arbitrum need ETH for gas that this wallet doesn't have.
        </div>
      </div>

      <div style={{ ...card, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Send size={18} color={BLUE} />
          <span style={{ fontSize: 17, fontWeight: 600, color: INK }}>Send</span>
        </div>
        <span style={{ fontSize: 12, fontWeight: 600, color: MUTED }}>Asset</span>
        {assetPicker(ASSETS.filter((a) => a.chainCode === "ARC"), sKey, (k) => { setSKey(k); setSAmount(""); }, sStep === "sending", "Asset to send")}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <label htmlFor="cw-live-send-amount" style={{ fontSize: 12, fontWeight: 600, color: MUTED }}>Amount · available {sBal.toLocaleString("en-US", { maximumFractionDigits: sAsset.decimals === 8 ? 8 : 2 })} {sAsset.symbol}</label>
          <button type="button" onClick={() => setSAmount(balances[sKey] ?? "")} style={{ border: "none", background: "#E3E8FD", color: BLUE, fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999, cursor: "pointer" }}>MAX</button>
        </div>
        <input id="cw-live-send-amount" inputMode="decimal" value={sAmount} placeholder="0.00" disabled={sStep === "sending"} style={input}
          onChange={(e) => { if (/^\d*\.?\d*$/.test(e.target.value)) setSAmount(e.target.value); }} />
        <label htmlFor="cw-live-send-to" style={{ fontSize: 12, fontWeight: 600, color: MUTED }}>Recipient address on Arc</label>
        <input id="cw-live-send-to" value={sTo} onChange={(e) => setSTo(e.target.value)} placeholder="0x..." disabled={sStep === "sending"} style={{ ...input, fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: 13 }} />
        {sMsg && sStep !== "idle" && (
          <div style={{ padding: "10px 12px", borderRadius: 10, fontSize: 13, background: sStep === "done" ? "#E7F7EF" : sStep === "error" ? "#FDECEC" : "#F5F7FF", color: sStep === "done" ? "#0B7A53" : sStep === "error" ? "#B91C1C" : INK }}>
            {sMsg}{" "}
            {sHash && <a href={`https://arc.etherscan.io/tx/${sHash}`} target="_blank" rel="noopener noreferrer" style={{ color: BLUE, fontWeight: 600 }}>View tx ↗</a>}
          </div>
        )}
        <button type="button" onClick={sendOut} disabled={!canSend} style={primary(canSend)}>
          {sStep === "sending" ? "Sending..." : !sAmount ? "Enter an amount" : sAmt > sBal ? "Not enough balance" : !sValidTo ? "Enter a valid address" : `Send ${sAmount} ${sAsset.symbol}`}
        </button>
      </div>

      <div style={{ ...card, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ArrowDownLeft size={18} color={BLUE} />
          <span style={{ fontSize: 17, fontWeight: 600, color: INK }}>Add funds</span>
        </div>
        <p style={{ margin: 0, fontSize: 12.5, color: MUTED, lineHeight: 1.5 }}>
          From your connected wallet. {status ? `You can add up to $${room.toFixed(2)} more (limit $${status.capUsd}).` : ""}
        </p>

        <span style={{ fontSize: 12, fontWeight: 600, color: MUTED }}>Asset</span>
        {assetPicker(ASSETS.filter((a) => DEPOSIT_KEYS.includes(a.key)), depKey, (k) => { setDepKey(k); setDepAmount(""); }, dStep === "sending", "Asset to add")}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <label htmlFor="cw-live-dep-amount" style={{ fontSize: 12, fontWeight: 600, color: MUTED }}>
            Amount{depBal !== null ? ` · in your wallet: ${depBalNum.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${depAsset.symbol}` : ""}
          </label>
          <button type="button" onClick={() => setDepAmount(depMax > 0 ? String(depMax) : "")} style={{ border: "none", background: "#E3E8FD", color: BLUE, fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999, cursor: "pointer" }}>MAX</button>
        </div>
        <input id="cw-live-dep-amount" inputMode="decimal" value={depAmount} placeholder="0.00" disabled={dStep === "sending"} style={input}
          onChange={(e) => { if (/^\d*\.?\d*$/.test(e.target.value)) setDepAmount(e.target.value); }} />
        {depAsset.chainCode !== "ARC" && <p style={{ margin: 0, fontSize: 12, color: MUTED }}>Your wallet pays a little ETH gas on {depAsset.chainName}.</p>}

        {dMsg && dStep !== "idle" && (
          <div style={{ padding: "10px 12px", borderRadius: 10, fontSize: 13, background: dStep === "done" ? "#E7F7EF" : dStep === "error" ? "#FDECEC" : "#F5F7FF", color: dStep === "done" ? "#0B7A53" : dStep === "error" ? "#B91C1C" : INK }}>
            {dMsg}{" "}
            {dHash && <a href={`${depAsset.explorer}/tx/${dHash}`} target="_blank" rel="noopener noreferrer" style={{ color: BLUE, fontWeight: 600 }}>View tx ↗</a>}
          </div>
        )}

        <button type="button" onClick={deposit} disabled={!canDeposit} style={primary(canDeposit)}>{depLabel}</button>
      </div>

      <div style={{ ...card, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ArrowUpRight size={18} color={BLUE} />
          <span style={{ fontSize: 17, fontWeight: 600, color: INK }}>Withdraw to my wallet</span>
        </div>

        <span style={{ fontSize: 12, fontWeight: 600, color: MUTED }}>Asset</span>
        {assetPicker(ASSETS, assetKey, (k) => { setAssetKey(k); setAmount(""); }, wStep === "sending", "Asset to withdraw")}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <label htmlFor="cw-live-amount" style={{ fontSize: 12, fontWeight: 600, color: MUTED }}>Amount</label>
          <button type="button" onClick={() => setAmount(balances[asset.key] ?? "")} style={{ border: "none", background: "#E3E8FD", color: BLUE, fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999, cursor: "pointer" }}>MAX</button>
        </div>
        <input id="cw-live-amount" inputMode="decimal" value={amount} placeholder="0.00" disabled={wStep === "sending"} style={input}
          onChange={(e) => { if (/^\d*\.?\d*$/.test(e.target.value)) setAmount(e.target.value); }} />

        <label htmlFor="cw-live-dest" style={{ fontSize: 12, fontWeight: 600, color: MUTED }}>Your wallet address on {asset.chainName}</label>
        <input id="cw-live-dest" value={dest} onChange={(e) => setDest(e.target.value)} placeholder="0x..." disabled={wStep === "sending"} style={{ ...input, fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: 13 }} />
        {browserAddress && dest.trim().toLowerCase() !== browserAddress.toLowerCase() && (
          <button type="button" onClick={() => setDest(browserAddress)} style={{ alignSelf: "flex-start", border: "none", background: "none", color: BLUE, fontSize: 12.5, fontWeight: 600, cursor: "pointer", padding: 0 }}>Use my connected wallet</button>
        )}
        {asset.chainCode !== "ARC" && <p style={{ margin: 0, fontSize: 12, color: MUTED }}>Withdrawing on {asset.chainName} needs a little ETH in this Circle wallet for gas.</p>}

        {wMsg && wStep !== "idle" && (
          <div style={{ padding: "10px 12px", borderRadius: 10, fontSize: 13, background: wStep === "done" ? "#E7F7EF" : wStep === "error" ? "#FDECEC" : "#F5F7FF", color: wStep === "done" ? "#0B7A53" : wStep === "error" ? "#B91C1C" : INK }}>
            {wMsg}{" "}
            {wHash && <a href={`${asset.explorer}/tx/${wHash}`} target="_blank" rel="noopener noreferrer" style={{ color: BLUE, fontWeight: 600 }}>View tx ↗</a>}
          </div>
        )}

        <button type="button" onClick={withdraw} disabled={!canWithdraw} style={primary(canWithdraw)}>
          {wStep === "sending" ? "Withdrawing..." : !amount ? "Enter an amount" : amt > balNum ? "Not enough balance" : !validDest ? "Enter a valid address" : `Withdraw ${amount} ${asset.symbol}`}
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, color: MUTED, lineHeight: 1.5 }}>
        <ShieldCheck size={15} style={{ flexShrink: 0, marginTop: 1 }} />
        Circle Wallet is a convenience wallet with a small holding limit. For larger amounts, use your own wallet.
      </div>
    </div>
  );
}
