import { useState, useEffect } from "react";
import { createPublicClient, createWalletClient, custom, http, erc20Abi, formatUnits, parseUnits, isAddress } from "viem";
import type { EIP1193Provider } from "viem";
import { Send } from "lucide-react";
import { arcMainnet, ARC_MAINNET_CHAIN_ID_HEX } from "../chains";
import type { LiveCircleWallet } from "./ConnectModal";
import { TokenOnChain } from "./AssetLogos";

// Mainnet Send: transfer USDC, EURC or cirBTC on Arc to any address, from the connected browser
// wallet (user signs) or the Circle Wallet (via /api/circle-wallet-mainnet `withdraw`, which is
// always allowed, even over the holding cap).
const TOKENS = [
  { key: "usdc", symbol: "USDC", token: "0x3600000000000000000000000000000000000000" as `0x${string}`, decimals: 6 },
  { key: "eurc", symbol: "EURC", token: "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1" as `0x${string}`, decimals: 6 },
  { key: "cirbtc", symbol: "cirBTC", token: "0x171A4217b86A807A64eB94757Db6849fb4bDbAA0" as `0x${string}`, decimals: 8 },
];

const BLUE = "#3D5AF1";
const INK = "#16151C";
const MUTED = "#5E5B6B";
const LINE = "#E7E4DD";
const API = "/api/circle-wallet-mainnet";

async function post(body: Record<string, unknown>) {
  const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.success) throw new Error(d.error ?? "Something went wrong.");
  return d;
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

export default function SendMainnet({ browserAddress, provider, circleLive, onConnect }: { browserAddress?: string; provider?: EIP1193Provider; circleLive?: LiveCircleWallet | null; onConnect?: () => void }) {
  const hasBrowser = !!browserAddress && !!provider;
  const hasCircle = !!circleLive;
  const [source, setSource] = useState<"browser" | "circle">(hasBrowser ? "browser" : "circle");
  const owner = source === "browser" ? browserAddress : circleLive?.address;

  const [tokenKey, setTokenKey] = useState("usdc");
  const [amount, setAmount] = useState("");
  const [to, setTo] = useState("");
  const [bal, setBal] = useState<string | null>(null);
  const [step, setStep] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const tok = TOKENS.find((t) => t.key === tokenKey)!;

  useEffect(() => {
    let cancelled = false;
    setBal(null);
    if (!owner) return;
    (async () => {
      try {
        const pc = createPublicClient({ chain: arcMainnet, transport: http() });
        const raw = await pc.readContract({ address: tok.token, abi: erc20Abi, functionName: "balanceOf", args: [owner as `0x${string}`] });
        if (!cancelled) setBal(formatUnits(raw, tok.decimals));
      } catch { if (!cancelled) setBal(null); }
    })();
    return () => { cancelled = true; };
  }, [owner, tokenKey, step === "done"]);

  async function send() {
    if (!owner) return;
    setStep("sending"); setHash(null);
    try {
      if (source === "browser") {
        setMsg("Confirm in your wallet...");
        await switchToArc(provider!);
        const wc = createWalletClient({ account: owner as `0x${string}`, chain: arcMainnet, transport: custom(provider!) });
        const pc = createPublicClient({ chain: arcMainnet, transport: http() });
        const h = await wc.writeContract({ address: tok.token, abi: erc20Abi, functionName: "transfer", args: [to.trim() as `0x${string}`, parseUnits(amount.trim(), tok.decimals)] });
        setHash(h); setMsg("Waiting for confirmation...");
        if ((await pc.waitForTransactionReceipt({ hash: h })).status === "reverted") throw new Error("The transfer reverted. Nothing was sent.");
      } else {
        setMsg("Sending...");
        const walletId = circleLive!.walletsByChain.ARC?.walletId;
        if (!walletId) throw new Error("No Arc Circle wallet on this account.");
        const { transactionId } = await post({ action: "withdraw", walletId, tokenAddress: tok.token, amount: amount.trim(), destinationAddress: to.trim() });
        const start = Date.now();
        let done = false;
        while (Date.now() - start < 180000) {
          const s = await post({ action: "getTransaction", transactionId });
          if (s.state === "COMPLETE") { setHash(s.txHash ?? null); done = true; break; }
          if (["FAILED", "CANCELLED", "DENIED"].includes(s.state)) throw new Error(s.errorReason ?? `Send ${String(s.state).toLowerCase()}.`);
          await new Promise((r) => setTimeout(r, 3000));
        }
        if (!done) throw new Error("Still processing. Check your balance again in a minute.");
      }
      setStep("done"); setMsg(`${amount} ${tok.symbol} sent.`); setAmount("");
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string };
      setStep("error"); setMsg(err.shortMessage || err.message || "Send failed.");
    }
  }

  const card = { background: "#FFFFFF", border: `1px solid ${LINE}`, borderRadius: 20, padding: "1.25rem", display: "flex", flexDirection: "column" as const, gap: 12 };
  const input = { width: "100%", boxSizing: "border-box" as const, height: 46, padding: "0 14px", borderRadius: 12, border: `1px solid ${LINE}`, fontSize: 14, color: INK, background: "#FFFFFF" };
  const label = { fontSize: 12, fontWeight: 600, color: MUTED } as const;
  const primary = (on: boolean) => ({ width: "100%", height: 48, borderRadius: 12, border: "none", background: on ? BLUE : "#EEEDF5", color: on ? "#FFFFFF" : "#8A8798", fontSize: 15, fontWeight: 600, cursor: on ? "pointer" : "not-allowed" });

  const balNum = Number(bal ?? 0);
  const amt = Number(amount);
  const validTo = isAddress(to.trim()) && to.trim().toLowerCase() !== (owner ?? "").toLowerCase();
  const can = !!owner && Number.isFinite(amt) && amt > 0 && amt <= balNum && validTo && step !== "sending";
  const btn = step === "sending" ? "Sending..." : !amount ? "Enter an amount" : amt > balNum ? "Not enough balance" : !validTo ? "Enter a valid recipient" : `Send ${amount} ${tok.symbol}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 520, margin: "0 auto" }}>
      <div role="group" aria-label="Wallet" style={{ display: "flex", gap: 2, padding: 3, borderRadius: 12, background: "#ECEAE4" }}>
        {(["browser", "circle"] as const).map((k) => {
          const on = source === k;
          return (
            <button key={k} type="button" aria-pressed={on} onClick={() => { setSource(k); setStep("idle"); setMsg(null); }}
              style={{ flex: 1, height: 38, borderRadius: 10, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, background: on ? "#FFFFFF" : "transparent", color: on ? INK : MUTED, boxShadow: on ? "0 1px 2px rgba(22,21,28,0.12)" : "none" }}>
              {k === "browser" ? "Browser wallet" : "Circle Wallet"}
            </button>
          );
        })}
      </div>

      {!owner ? (
        <div style={{ ...card, alignItems: "center", textAlign: "center", color: MUTED, fontSize: 13.5 }}>
          {source === "circle" ? "Sign in with Circle Wallet to send from it." : "Connect a browser wallet to send from it."}
          {onConnect && <button type="button" onClick={onConnect} style={{ ...primary(true), maxWidth: 260 }}>{source === "circle" ? "Sign in with Circle Wallet" : "Connect wallet"}</button>}
        </div>
      ) : (
        <section style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}><Send size={18} color={BLUE} /><span style={{ fontSize: 17, fontWeight: 600, color: INK }}>Send on Arc</span></div>

          <span style={label}>Asset</span>
          <div role="radiogroup" aria-label="Asset" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6 }}>
            {TOKENS.map((t) => {
              const on = t.key === tokenKey;
              return (
                <button key={t.key} type="button" role="radio" aria-checked={on} disabled={step === "sending"} onClick={() => { setTokenKey(t.key); setAmount(""); }}
                  style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 48, padding: "6px 10px", borderRadius: 12, border: on ? `1.5px solid ${BLUE}` : `1px solid ${LINE}`, background: on ? "#EEF1FE" : "#FFFFFF", cursor: "pointer" }}>
                  <TokenOnChain symbol={t.symbol} chain="arc" size={26} />
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: on ? BLUE : INK }}>{t.symbol}</span>
                </button>
              );
            })}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <label htmlFor="send-amount" style={label}>Amount · available {bal === null ? "…" : balNum.toLocaleString("en-US", { maximumFractionDigits: tok.decimals === 8 ? 8 : 2 })} {tok.symbol}</label>
            <button type="button" onClick={() => setAmount(bal ?? "")} style={{ border: "none", background: "#E3E8FD", color: BLUE, fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999, cursor: "pointer" }}>MAX</button>
          </div>
          <input id="send-amount" inputMode="decimal" value={amount} placeholder="0.00" disabled={step === "sending"} style={input}
            onChange={(e) => { if (/^\d*\.?\d*$/.test(e.target.value)) setAmount(e.target.value); }} />

          <label htmlFor="send-to" style={label}>Recipient address on Arc</label>
          <input id="send-to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x..." disabled={step === "sending"}
            style={{ ...input, fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: 13 }} />
          {tokenKey === "usdc" && source === "browser" && <p style={{ margin: 0, fontSize: 12, color: MUTED }}>Gas on Arc is paid in USDC, so keep a little extra when sending your full USDC balance.</p>}

          {msg && step !== "idle" && (
            <div style={{ padding: "10px 12px", borderRadius: 10, fontSize: 13, background: step === "done" ? "#E7F7EF" : step === "error" ? "#FDECEC" : "#F5F7FF", color: step === "done" ? "#0B7A53" : step === "error" ? "#B91C1C" : INK }}>
              {msg}{" "}
              {hash && <a href={`https://arc.etherscan.io/tx/${hash}`} target="_blank" rel="noopener noreferrer" style={{ color: BLUE, fontWeight: 600 }}>View tx ↗</a>}
            </div>
          )}

          <button type="button" onClick={send} disabled={!can} style={primary(can)}>{btn}</button>
        </section>
      )}
    </div>
  );
}
