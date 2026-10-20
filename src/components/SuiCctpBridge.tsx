import { useState, useEffect, useCallback } from "react";
import { createWalletClient, createPublicClient, custom, http, encodeFunctionData, formatUnits, parseUnits } from "viem";
import type { EIP1193Provider } from "viem";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import { getWallets, signAndExecuteTransaction, SUI_MAINNET_CHAIN } from "@mysten/wallet-standard";
import type { Wallet, WalletAccount } from "@mysten/wallet-standard";
import { ArrowRight, Check } from "lucide-react";
import { arcMainnet, ARC_MAINNET_CHAIN_ID_HEX } from "../chains";
import { USDC_LOGO } from "./tokenLogos";

// Native USDC from Sui into Arc Mainnet over Circle CCTP V2 (Sui domain 8 -> Arc domain 26).
// Sources (verified 2026-10-20 against developers.circle.com):
//  - Package and state object IDs: cctp/references/sui-packages (mainnet)
//  - Burn PTB (deposit_for_burn -> handler::burn -> complete_burn), Iris polling, Arc receiveMessage:
//    cctp/quickstarts/transfer-usdc-sui-arc
//  - Fee for 8 -> 26: GET iris-api.circle.com/v2/burn/USDC/fees/8/26 returns minimumFee 0 for standard (2000).
// Circle's Forwarding Service doesn't cover Sui as a source, so the last step (receiveMessage on Arc) is signed
// by the user's EVM wallet and needs a little USDC on Arc for gas. usedNonces stops any double mint; Resume
// finishes a transfer whose page was closed.
// The USDC coin is built with coinWithBalance, which works whether the wallet holds USDC as Coin objects or as
// a SIP-58 address balance (Circle's sample only covers the address-balance case).
const SUI_USDC_TYPE = "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";
const SUI_TYPE = "0x2::sui::SUI";
const TMM_V2_PACKAGE = "0xeb14978abfe93a37c5d5bf86a0623b923553a5f0e794daac7724f1e2fdbfb830";
const HANDLER_PACKAGE = "0x185ed207c4d64fc594882ab927f9f3c6ff957aad03df8a731ba64378faeeb2bf";
const TMM_V2_STATE = "0x06fb166941cd7bc095edc019d054a753ec3f1e4c25f28f2ecc4a6cfa0a9b1167";
const MT_V2_STATE = "0x0c067f7d325e5b60e3179712e7783534ba1556cbb3d359d8161497e37689230c";
const HANDLER_STATE = "0xa32de8a6dd0178fb05f662929d55cddb69a25c26bde4b83f89e36d17ead94c41";
const USDC_TREASURY = "0x57d6725e7a8b49a7b2a612f6bd66ab5f39fc95332ca48be421c3229d514a6de7";
const DENY_LIST = "0x403";
const SUI_DOMAIN = 8;
const ARC_DOMAIN = 26;
const STANDARD_FINALITY = 2000;

const ARC_MESSAGE_TRANSMITTER_V2 = "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64" as const;
const IRIS_API = "https://iris-api.circle.com";
const PENDING_KEY = "flowfi-sui-pending";
const WALLET_KEY = "flowfi-sui-wallet";
// receiveMessage on Arc uses roughly 150-200k gas; this is the budget we check the Arc balance against.
const ARC_MINT_GAS = 300_000n;
const MIN_SUI_GAS = 5_000_000n; // 0.005 SUI

const RECEIVE_MESSAGE_ABI = [{ type: "function", name: "receiveMessage", stateMutability: "nonpayable", inputs: [{ name: "message", type: "bytes" }, { name: "attestation", type: "bytes" }], outputs: [{ type: "bool" }] }] as const;
const USED_NONCES_ABI = [{ type: "function", name: "usedNonces", stateMutability: "view", inputs: [{ name: "nonce", type: "bytes32" }], outputs: [{ type: "uint256" }] }] as const;

const sui = new SuiGrpcClient({ network: "mainnet", baseUrl: "https://fullnode.mainnet.sui.io:443" });
const arcPc = createPublicClient({ chain: arcMainnet, transport: http() });

type Step = "idle" | "building" | "burning" | "attesting" | "minting" | "done" | "error";

const BLUE = "#3D5AF1";
const LINE = "#E7E4DD";
const MUTED = "#5E5B6B";
const INK = "#16151C";
const SUI_LOGO = "https://icons.llamao.fi/icons/chains/rsz_sui.jpg";

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
const short = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;
const padToBytes32 = (addr: string) => `0x${addr.replace(/^0x/, "").toLowerCase().padStart(64, "0")}`;

function isSuiWallet(w: Wallet) {
  return "standard:connect" in w.features
    && ("sui:signAndExecuteTransaction" in w.features || "sui:signAndExecuteTransactionBlock" in w.features)
    && w.chains.some((c) => c === SUI_MAINNET_CHAIN);
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

type IrisResult = { message: `0x${string}`; attestation: `0x${string}`; minted: boolean } | null;

// One look at Iris for this Sui digest. null = not attested yet.
async function checkIris(digest: string): Promise<IrisResult> {
  const res = await fetch(`${IRIS_API}/v2/messages/${SUI_DOMAIN}?transactionHash=${digest}`);
  if (res.status === 404 || !res.ok) return null;
  const msg = (await res.json())?.messages?.[0];
  if (!msg?.message || msg.message === "0x" || !msg.attestation || msg.attestation === "PENDING") return null;
  const nonce = `0x${(msg.message as string).slice(26, 90)}` as `0x${string}`;
  const used = await arcPc.readContract({ address: ARC_MESSAGE_TRANSMITTER_V2, abi: USED_NONCES_ABI, functionName: "usedNonces", args: [nonce] });
  return { message: msg.message, attestation: msg.attestation, minted: Number(used) > 0 };
}

export default function SuiCctpBridge({ address, provider }: { address: string; provider?: EIP1193Provider }) {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [account, setAccount] = useState<WalletAccount | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [usdcBal, setUsdcBal] = useState<bigint | null>(null);
  const [suiBal, setSuiBal] = useState<bigint | null>(null);
  const [arcGasOk, setArcGasOk] = useState<boolean | null>(null);
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [digest, setDigest] = useState<string | null>(null);
  const [mintHash, setMintHash] = useState<string | null>(null);

  const busy = step === "building" || step === "burning" || step === "attesting" || step === "minting";
  const unfinished = step === "error" && !!digest;
  const isDone = step === "done"; // balances refresh after a finished transfer

  // Sui wallets installed in the browser (Slush, Suiet, Phantom, ...), via the Wallet Standard.
  useEffect(() => {
    const api = getWallets();
    const refresh = () => setWallets(api.get().filter(isSuiWallet));
    refresh();
    const offRegister = api.on("register", refresh);
    const offUnregister = api.on("unregister", refresh);
    return () => { offRegister(); offUnregister(); };
  }, []);

  const pickAccount = useCallback((w: Wallet, accounts: readonly WalletAccount[]) => {
    const acc = accounts.find((a) => a.chains.some((c) => c === SUI_MAINNET_CHAIN)) ?? accounts[0];
    if (!acc) return false;
    setWallet(w); setAccount(acc);
    try { localStorage.setItem(WALLET_KEY, w.name); } catch { /* ignore */ }
    return true;
  }, []);

  // Reconnect quietly to the Sui wallet used last time.
  useEffect(() => {
    if (wallet) return;
    let name: string | null = null;
    try { name = localStorage.getItem(WALLET_KEY); } catch { /* ignore */ }
    const w = wallets.find((x) => x.name === name);
    if (!w) return;
    if (w.accounts.length) { pickAccount(w, w.accounts); return; }
    const connect = w.features["standard:connect"] as { connect: (i?: { silent?: boolean }) => Promise<{ accounts: readonly WalletAccount[] }> };
    connect.connect({ silent: true }).then((r) => { if (r.accounts.length) pickAccount(w, r.accounts); }).catch(() => {});
  }, [wallets, wallet, pickAccount]);

  // Follow account switches inside the Sui wallet.
  useEffect(() => {
    if (!wallet || !("standard:events" in wallet.features)) return;
    const events = wallet.features["standard:events"] as { on: (e: "change", cb: (p: { accounts?: readonly WalletAccount[] }) => void) => () => void };
    return events.on("change", ({ accounts }) => {
      if (!accounts) return;
      if (!accounts.length) { setWallet(null); setAccount(null); return; }
      pickAccount(wallet, accounts);
    });
  }, [wallet, pickAccount]);

  async function connectWallet(w: Wallet) {
    setPickerOpen(false); setError(null);
    try {
      const connect = w.features["standard:connect"] as { connect: () => Promise<{ accounts: readonly WalletAccount[] }> };
      const r = await connect.connect();
      if (!pickAccount(w, r.accounts)) setError("No Sui account was shared by the wallet.");
    } catch (e: unknown) {
      setError((e as { message?: string }).message || "Could not connect the Sui wallet.");
    }
  }

  function disconnectWallet() {
    try {
      const f = wallet?.features["standard:disconnect"] as { disconnect?: () => Promise<void> } | undefined;
      f?.disconnect?.().catch(() => {});
      localStorage.removeItem(WALLET_KEY);
    } catch { /* ignore */ }
    setWallet(null); setAccount(null); setUsdcBal(null); setSuiBal(null);
  }

  // USDC and SUI balances on Sui (Coin objects + address balance together).
  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    setUsdcBal(null); setSuiBal(null);
    Promise.all([
      sui.getBalance({ owner: account.address, coinType: SUI_USDC_TYPE }),
      sui.getBalance({ owner: account.address, coinType: SUI_TYPE }),
    ]).then(([u, s]) => {
      if (cancelled) return;
      setUsdcBal(BigInt(u.balance.balance)); setSuiBal(BigInt(s.balance.balance));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [account, isDone]);

  // Is there enough USDC on Arc to pay for the final mint transaction?
  useEffect(() => {
    let cancelled = false;
    setArcGasOk(null);
    Promise.all([arcPc.getBalance({ address: address as `0x${string}` }), arcPc.getGasPrice()])
      .then(([bal, price]) => { if (!cancelled) setArcGasOk(bal >= price * ARC_MINT_GAS); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [address, isDone]);

  // Unfinished transfer from an earlier visit.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PENDING_KEY);
      if (!raw) return;
      const p = JSON.parse(raw) as { digest?: string; address?: string; amount?: string };
      if (!p.digest || p.address?.toLowerCase() !== address.toLowerCase()) return;
      setDigest(p.digest); setAmount(p.amount ?? "");
      setStep("error");
      setError("You have an unfinished transfer from Sui: the USDC left Sui, but it hasn't been received on Arc yet.");
    } catch { /* ignore */ }
  }, [address]);

  function savePending(d: string, amt: string) {
    try { localStorage.setItem(PENDING_KEY, JSON.stringify({ digest: d, address, amount: amt })); } catch { /* ignore */ }
  }
  function clearPending() { try { localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ } }

  // Wait for Circle's attestation, then mint on Arc with the user's EVM wallet.
  async function finish(d: string, maxMin: number) {
    if (!provider) throw new Error("Connect your wallet to receive on Arc.");
    setStep("attesting");
    let att: IrisResult = null;
    const attempts = Math.ceil((maxMin * 60) / 5);
    for (let i = 0; i < attempts && !att; i++) {
      try { att = await checkIris(d); } catch { /* retry */ }
      if (!att) await sleep(5000);
    }
    if (!att) throw new Error("Circle is still confirming this transfer. Your USDC is safe. Use Resume in a few minutes.");
    if (att.minted) { clearPending(); setStep("done"); return; }

    setStep("minting");
    await switchToArc(provider);
    const wc = createWalletClient({ account: address as `0x${string}`, chain: arcMainnet, transport: custom(provider) });
    const h = await wc.sendTransaction({ to: ARC_MESSAGE_TRANSMITTER_V2, data: encodeFunctionData({ abi: RECEIVE_MESSAGE_ABI, functionName: "receiveMessage", args: [att.message, att.attestation] }) });
    setMintHash(h);
    const rr = await arcPc.waitForTransactionReceipt({ hash: h });
    if (rr.status === "reverted") throw new Error("Receiving on Arc didn't go through. Use Resume to try again.");
    clearPending(); setStep("done");
  }

  async function send() {
    if (!wallet || !account || !provider || !amount.trim()) return;
    setError(null); setDigest(null); setMintHash(null);
    try {
      const amountRaw = parseUnits(amount.trim(), 6);
      setStep("building");
      const tx = new Transaction();
      tx.setSender(account.address);
      const coin = tx.add(coinWithBalance({ type: SUI_USDC_TYPE, balance: amountRaw }));
      const [burnReceipt, returnedCoin] = tx.moveCall({
        target: `${TMM_V2_PACKAGE}::deposit_for_burn::deposit_for_burn`,
        typeArguments: [SUI_USDC_TYPE],
        arguments: [
          coin,
          tx.pure.u32(ARC_DOMAIN),
          tx.pure.address(padToBytes32(address)), // mint recipient on Arc: the connected EVM wallet
          tx.pure.address("0x0"), // destination caller: anyone may submit the message on Arc
          tx.pure.u256(0n), // max fee: Circle charges 0 for standard transfers from Sui
          tx.pure.u32(STANDARD_FINALITY),
          tx.pure.vector("u8", []),
          tx.object(TMM_V2_STATE),
        ],
      });
      const [ticket] = tx.moveCall({
        target: `${HANDLER_PACKAGE}::handler::burn`,
        arguments: [tx.object(HANDLER_STATE), burnReceipt, returnedCoin, tx.object(DENY_LIST), tx.object(USDC_TREASURY)],
      });
      tx.moveCall({
        target: `${TMM_V2_PACKAGE}::deposit_for_burn::complete_burn`,
        typeArguments: [SUI_USDC_TYPE, `${HANDLER_PACKAGE}::handler::Auth`],
        arguments: [ticket, tx.object(TMM_V2_STATE), tx.object(MT_V2_STATE)],
      });
      // Build here first: it dry-runs the transaction, so a problem shows up before the wallet asks to sign.
      const built = Transaction.from(await tx.build({ client: sui }));

      setStep("burning");
      const out = await signAndExecuteTransaction(wallet, { transaction: built, account, chain: SUI_MAINNET_CHAIN });
      setDigest(out.digest); savePending(out.digest, amount.trim());
      const r = await sui.waitForTransaction({ digest: out.digest });
      if (r.$kind === "FailedTransaction") {
        clearPending(); setDigest(null);
        throw new Error("The transaction failed on Sui. Nothing was sent.");
      }

      await finish(out.digest, 30);
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string };
      const msg = err.shortMessage || err.message || "Something went wrong.";
      setError(/reject|denied|cancel/i.test(msg) ? "You cancelled in your wallet." : msg);
      setStep("error");
    }
  }

  async function resume() {
    if (!digest) return;
    setError(null);
    try { await finish(digest, 1); } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string };
      setError(err.shortMessage || err.message || "Something went wrong.");
      setStep("error");
    }
  }

  function reset() { setStep("idle"); setAmount(""); setDigest(null); setMintHash(null); setError(null); }

  const amountRaw = (() => { try { return parseUnits(amount.trim() || "0", 6); } catch { return 0n; } })();
  const validAmt = amountRaw > 0n;
  const insufficient = validAmt && usdcBal !== null && amountRaw > usdcBal;
  const noSuiGas = suiBal !== null && suiBal < MIN_SUI_GAS;
  const noArcGas = arcGasOk === false;

  let cta = "Send USDC to Arc"; let ctaOn = false; let ctaFn: () => void = send;
  if (!account) { cta = "Connect Sui wallet"; ctaOn = true; ctaFn = () => setPickerOpen(true); }
  else if (!provider) cta = "Connect wallet";
  else if (!validAmt) cta = "Enter an amount";
  else if (insufficient) cta = "Insufficient USDC balance";
  else if (noSuiGas) cta = "Not enough SUI for gas";
  else if (noArcGas) cta = "Add a little USDC on Arc for gas";
  else ctaOn = step === "idle";
  if (busy) { cta = "Processing..."; ctaOn = false; }
  if (step === "done") { cta = "Send another"; ctaOn = true; ctaFn = reset; }
  if (unfinished) { cta = "Resume"; ctaOn = !!provider; ctaFn = resume; }
  else if (step === "error") { cta = "Try again"; ctaOn = true; ctaFn = () => { setStep("idle"); setError(null); }; }

  const statusText = {
    idle: "",
    building: "Preparing your transfer...",
    burning: "Confirm in your Sui wallet...",
    attesting: "Circle is confirming your transfer. This usually takes a few minutes...",
    minting: "Confirm in your wallet to receive your USDC on Arc...",
    done: "Your USDC is now on Arc.",
    error: error ?? "Failed",
  }[step];

  const pane = { background: "#F5F7FF", borderRadius: 20, padding: "14px 16px" } as const;
  const label = { fontSize: 11, color: MUTED, fontWeight: 600, letterSpacing: 0.3 } as const;
  const shownAmt = validAmt ? Number(formatUnits(amountRaw, 6)).toLocaleString("en-US", { maximumFractionDigits: 6 }) : null;
  const rows: { k: string; v: string; good?: boolean; warn?: boolean }[] = [
    { k: "Route", v: "Circle CCTP (native USDC)" },
    { k: "Circle fee", v: "None", good: true },
    { k: "You receive", v: shownAmt ? `${shownAmt} USDC` : "—" },
    { k: "Arrives at", v: short(address) },
    { k: "Gas on Arc", v: noArcGas ? "Needed for the final step" : "A few cents of USDC", warn: noArcGas },
    { k: "Signatures", v: "1 on Sui, 1 on Arc" },
  ];

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", background: "#FFFFFF", border: `1px solid ${LINE}`, borderRadius: 28, padding: "1.1rem", boxShadow: "0 24px 60px -16px rgba(61,90,241,0.18)" }}>
      <style>{`.ff-sui-amt, .ff-sui-amt:focus { outline: none !important; box-shadow: none !important; border: none !important; background: transparent !important; }`}</style>

      <div style={{ ...label, marginBottom: 8 }}>FROM</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, border: `1px solid ${LINE}`, borderRadius: 14, padding: "8px 10px 8px 12px", marginBottom: 10 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 600, color: INK }}>
          <img src={SUI_LOGO} alt="" width={22} height={22} style={{ borderRadius: "50%" }} /> Sui
        </span>
        {account ? (
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: MUTED }}>
            {wallet?.icon && <img src={wallet.icon} alt="" width={18} height={18} style={{ borderRadius: 5 }} />}
            {short(account.address)}
            <button type="button" onClick={disconnectWallet} disabled={busy}
              style={{ border: "none", background: "none", color: BLUE, fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0 }}>Disconnect</button>
          </span>
        ) : (
          <button type="button" onClick={() => setPickerOpen((o) => !o)}
            style={{ height: 32, padding: "0 14px", borderRadius: 999, border: "none", background: BLUE, color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
            Connect Sui wallet
          </button>
        )}
      </div>

      {pickerOpen && !account && (
        <div style={{ border: `1px solid ${LINE}`, borderRadius: 14, padding: 8, marginBottom: 10 }}>
          {wallets.length === 0 ? (
            <div style={{ fontSize: 12.5, color: MUTED, padding: "6px 6px", lineHeight: 1.5 }}>
              No Sui wallet found in this browser. Install{" "}
              <a href="https://slush.app" target="_blank" rel="noopener noreferrer" style={{ color: BLUE, fontWeight: 600 }}>Slush</a>{" "}
              or another Sui wallet, then refresh the page.
            </div>
          ) : wallets.map((w) => (
            <button key={w.name} type="button" onClick={() => connectWallet(w)}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "8px 8px", border: "none", borderRadius: 10, background: "transparent", cursor: "pointer", fontSize: 14, fontWeight: 600, color: INK, textAlign: "left" }}>
              {w.icon && <img src={w.icon} alt="" width={24} height={24} style={{ borderRadius: 6 }} />}
              {w.name}
            </button>
          ))}
        </div>
      )}

      <div style={pane}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={label}>YOU SEND</span>
          {usdcBal !== null && (
            <span style={{ fontSize: 11.5, color: MUTED }}>
              Balance: {Number(formatUnits(usdcBal, 6)).toLocaleString("en-US", { maximumFractionDigits: 2 })} USDC
              <button type="button" onClick={() => setAmount(formatUnits(usdcBal, 6))} disabled={busy || unfinished}
                style={{ border: "none", background: "#E3E8FD", color: BLUE, fontSize: 10.5, fontWeight: 800, padding: "2px 8px", borderRadius: 999, cursor: "pointer", marginLeft: 6 }}>MAX</button>
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input className="ff-sui-amt" type="text" inputMode="decimal" value={amount} placeholder="0.00" disabled={busy || unfinished} aria-label="USDC amount"
            onChange={(e) => { if (/^\d*\.?\d{0,6}$/.test(e.target.value)) setAmount(e.target.value); }}
            style={{ flex: 1, minWidth: 0, fontSize: 30, fontWeight: 700, color: INK, padding: 0 }} />
          <span style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff", borderRadius: 999, padding: "5px 12px 5px 6px", fontSize: 13, fontWeight: 700, color: INK, boxShadow: "0 1px 3px rgba(17,24,39,0.06)" }}>
            <img src={USDC_LOGO} alt="" width={24} height={24} style={{ borderRadius: "50%" }} /> USDC
          </span>
        </div>
      </div>

      <div style={{ marginTop: 10, border: `1px solid ${LINE}`, borderRadius: 18, padding: "6px 14px" }}>
        {rows.map((r, i) => (
          <div key={r.k} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0", borderBottom: i < rows.length - 1 ? `1px solid ${LINE}` : "none", fontSize: 12.5 }}>
            <span style={{ color: MUTED }}>{r.k}</span>
            <span style={{ color: r.good ? "#0E9F6E" : r.warn ? "#B45309" : INK, fontWeight: 600, textAlign: "right" }}>{r.v}</span>
          </div>
        ))}
      </div>

      {step !== "idle" && (
        <div style={{ marginTop: 12, display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 14px", borderRadius: 16, background: step === "done" ? "#E7F7EF" : step === "error" && !unfinished ? "#FDECEC" : "#FFF8EC", fontSize: 12.5, lineHeight: 1.5, color: step === "done" ? "#0B7A53" : step === "error" && !unfinished ? "#B91C1C" : "#6A4308" }}>
          {step === "done" && <Check size={16} style={{ flexShrink: 0, marginTop: 2 }} />}
          <span>
            {statusText}
            {unfinished && <><br />Your USDC left Sui. Use Resume below and don't start a new transfer.</>}
          </span>
        </div>
      )}

      {(digest || mintHash) && (
        <div style={{ display: "flex", gap: 14, marginTop: 10, fontSize: 12 }}>
          {digest && <a href={`https://suiscan.xyz/mainnet/tx/${digest}`} target="_blank" rel="noopener noreferrer" style={{ color: BLUE, fontWeight: 600 }}>Send tx ↗</a>}
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
        Self-custody: you sign in your own wallets. USDC is burned on Sui and minted 1:1 on Arc by Circle, with no wrapped tokens.
      </p>
    </div>
  );
}
