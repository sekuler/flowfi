import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPublicClient, createWalletClient, custom, defineChain, fallback, formatEther, http, parseEther, parseGwei } from "viem";
import type { EIP1193Provider } from "viem";
import { hyperEvm } from "viem/chains";
import { ArrowRight, Check } from "lucide-react";

// Native HYPE from HyperEVM into Elysium (Kinetiq's Arbitrum Orbit chain) through the official
// Orbit delayed inbox: createRetryableTicket on HyperEVM credits the user's own Elysium address.
// No FlowFi contract or reserve is involved. Exits are deliberately not offered here.
//
// Elysium's public launch is Nov 9, 2026 and Kinetiq publishes its own mainnet details then.
// Until then the values below come from Synthra's docs (docs.synthra.org/docs/contract-addresses,
// read Nov 2, 2026), including its two third-party RPCs: swap them for Kinetiq's official
// values at launch. The inbox is checked onchain and the chain ID live before anything is signed.
const ELYSIUM_CHAIN_ID = 99901;
const ELYSIUM_RPCS = ["https://rpc.styxn.fun", "https://rpc-live.elysp.com"];
const ELYSIUM_EXPLORER = "https://scan.elysp.com";
const ORBIT_INBOX = "0xce59f8b65ad41c9dae4c07a0571a39824bd92cff" as const;

const elysium = defineChain({
  id: ELYSIUM_CHAIN_ID,
  name: "Elysium",
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: { default: { http: ELYSIUM_RPCS } },
  blockExplorers: { default: { name: "Elysium Explorer", url: ELYSIUM_EXPLORER } },
});

const INBOX_ABI = [
  { type: "function", name: "calculateRetryableSubmissionFee", stateMutability: "view", inputs: [{ name: "dataLength", type: "uint256" }, { name: "baseFee", type: "uint256" }], outputs: [{ type: "uint256" }] },
  {
    type: "function", name: "createRetryableTicket", stateMutability: "payable",
    inputs: [
      { name: "to", type: "address" },
      { name: "l2CallValue", type: "uint256" },
      { name: "maxSubmissionCost", type: "uint256" },
      { name: "excessFeeRefundAddress", type: "address" },
      { name: "callValueRefundAddress", type: "address" },
      { name: "gasLimit", type: "uint256" },
      { name: "maxFeePerGas", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

// Delivery budget for a plain value transfer. Anything unused is refunded on Elysium to the user.
const DELIVERY_GAS = 100_000n;
const MIN_GAS_BID = parseGwei("0.1");
const SUBMISSION_BUFFER = 3n;
const MAX_GAS_RESERVE = 600_000n;
const POLL_MS = 5000;
const POLL_ATTEMPTS = 144; // 12 minutes
const PENDING_KEY = "flowfi-elysium-pending";

const BLUE = "#3D5AF1";
const LINE = "#E7E4DD";
const MUTED = "#5E5B6B";
const INK = "#16151C";

const hyperClient = createPublicClient({ chain: hyperEvm, transport: http() });
const elysiumClient = createPublicClient({ chain: elysium, transport: fallback(ELYSIUM_RPCS.map((u) => http(u))) });

type Step = "idle" | "preparing" | "signing" | "confirming" | "delivering" | "done" | "late" | "error";
type Pending = { hash: string; address: string; amount: string; before: string };
type Quote = { maxSubmissionCost: bigint; maxFeePerGas: bigint; fee: bigint };

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
function short(v: bigint) { return Number(formatEther(v)).toLocaleString("en-US", { maximumFractionDigits: 4 }); }

async function switchChain(provider: EIP1193Provider, chain: typeof hyperEvm | typeof elysium) {
  const chainId = `0x${chain.id.toString(16)}`;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch (e: unknown) {
    // Wallets report an unknown network in different ways, so only a user rejection stops here.
    if ((e as { code?: number }).code === 4001) throw e;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{ chainId, chainName: chain.name, nativeCurrency: chain.nativeCurrency, rpcUrls: [...chain.rpcUrls.default.http], blockExplorerUrls: [chain.blockExplorers.default.url] }],
    });
  }
}

async function getQuote(): Promise<Quote> {
  const [liveChainId, inboxCode, block, elysiumGas] = await Promise.all([
    elysiumClient.getChainId(),
    hyperClient.getCode({ address: ORBIT_INBOX }),
    hyperClient.getBlock(),
    elysiumClient.getGasPrice(),
  ]);
  if (liveChainId !== ELYSIUM_CHAIN_ID) throw new Error("The Elysium connection returned an unexpected network. Nothing was sent.");
  if (!inboxCode || inboxCode === "0x") throw new Error("The Elysium inbox wasn't found on HyperEVM. Nothing was sent.");
  const baseFee = block.baseFeePerGas ?? (await hyperClient.getGasPrice());
  const submission = await hyperClient.readContract({ address: ORBIT_INBOX, abi: INBOX_ABI, functionName: "calculateRetryableSubmissionFee", args: [0n, baseFee] });
  const maxSubmissionCost = submission * SUBMISSION_BUFFER;
  const doubled = elysiumGas * 2n;
  const maxFeePerGas = doubled > MIN_GAS_BID ? doubled : MIN_GAS_BID;
  return { maxSubmissionCost, maxFeePerGas, fee: maxSubmissionCost + DELIVERY_GAS * maxFeePerGas };
}

export default function ElysiumBridge({ address, provider, onGetHype }: { address: string; provider?: EIP1193Provider; onGetHype: () => void }) {
  const account = address as `0x${string}`;
  const [amount, setAmount] = useState("");
  const [hyperBal, setHyperBal] = useState<bigint | null>(null);
  const [elysiumBal, setElysiumBal] = useState<bigint | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [walletNote, setWalletNote] = useState<string | null>(null);
  const alive = useRef(true);
  const watching = useRef<string | null>(null);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const refreshBalances = useCallback(() => {
    hyperClient.getBalance({ address: account }).then((b) => { if (alive.current) setHyperBal(b); }).catch(() => {});
    elysiumClient.getBalance({ address: account }).then((b) => { if (alive.current) setElysiumBal(b); }).catch(() => {});
  }, [account]);

  useEffect(() => {
    refreshBalances();
    getQuote().then((q) => { if (alive.current) setQuote(q); }).catch(() => {});
  }, [refreshBalances]);

  // Delivered once the Elysium balance has grown by at least the amount sent.
  const watchDelivery = useCallback(async (p: Pending) => {
    if (watching.current === p.hash) return;
    watching.current = p.hash;
    const target = BigInt(p.before) + parseEther(p.amount);
    setStep("delivering");
    for (let i = 0; i < POLL_ATTEMPTS && alive.current; i++) {
      try {
        const bal = await elysiumClient.getBalance({ address: p.address as `0x${string}` });
        if (bal >= target) {
          try { localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
          if (alive.current) { setElysiumBal(bal); setStep("done"); refreshBalances(); }
          watching.current = null;
          return;
        }
      } catch { /* retry */ }
      await sleep(POLL_MS);
    }
    watching.current = null;
    if (alive.current) setStep("late");
  }, [refreshBalances]);

  // Pick an unfinished transfer back up after a refresh, so nobody sends twice by mistake.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PENDING_KEY);
      if (!raw) return;
      const p = JSON.parse(raw) as Pending;
      if (!p.hash || p.address?.toLowerCase() !== address.toLowerCase()) return;
      setTxHash(p.hash); setAmount(p.amount);
      void watchDelivery(p);
    } catch { /* ignore */ }
  }, [address, watchDelivery]);

  let amountRaw = 0n;
  try { amountRaw = parseEther((amount.trim() || "0") as `${number}`); } catch { amountRaw = 0n; }
  const busy = step === "preparing" || step === "signing" || step === "confirming" || step === "delivering";
  const locked = busy || step === "late";
  const insufficient = hyperBal !== null && amountRaw > 0n && amountRaw + (quote?.fee ?? 0n) >= hyperBal;

  async function send() {
    if (!provider || amountRaw <= 0n) return;
    setError(null); setTxHash(null); setStep("preparing");
    try {
      const q = await getQuote();
      setQuote(q);
      const [before, balance] = await Promise.all([
        elysiumClient.getBalance({ address: account }),
        hyperClient.getBalance({ address: account }),
      ]);
      if (amountRaw + q.fee >= balance) throw new Error(`Not enough HYPE on HyperEVM. You need ${short(amountRaw + q.fee)} HYPE plus a little for gas. Nothing was sent.`);

      await switchChain(provider, hyperEvm);
      const args = [account, amountRaw, q.maxSubmissionCost, account, account, DELIVERY_GAS, q.maxFeePerGas, "0x"] as const;
      const value = amountRaw + q.fee;
      // Dry run first: if the inbox would reject this, the user is never asked to sign it.
      const { request } = await hyperClient.simulateContract({ account, address: ORBIT_INBOX, abi: INBOX_ABI, functionName: "createRetryableTicket", args, value });

      setStep("signing");
      const wallet = createWalletClient({ account, chain: hyperEvm, transport: custom(provider) });
      const hash = await wallet.writeContract(request);
      setTxHash(hash);
      const pending: Pending = { hash, address, amount: amount.trim(), before: before.toString() };
      try { localStorage.setItem(PENDING_KEY, JSON.stringify(pending)); } catch { /* ignore */ }

      setStep("confirming");
      // A slow receipt doesn't mean a failed transfer: keep watching Elysium rather than inviting a resend.
      const receipt = await hyperClient.waitForTransactionReceipt({ hash, timeout: 180_000 }).catch(() => null);
      if (receipt && receipt.status !== "success") {
        try { localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
        throw new Error("The transaction failed on HyperEVM, so nothing was moved to Elysium.");
      }
      await watchDelivery(pending);
    } catch (e: unknown) {
      const msg = (e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message ?? "Something went wrong.";
      setError(msg);
      setStep("error");
    }
  }

  // Leaves the delivery cost and enough HYPE for HyperEVM gas in the wallet.
  async function setMax() {
    try {
      const [q, balance, gasPrice] = await Promise.all([getQuote(), hyperClient.getBalance({ address: account }), hyperClient.getGasPrice()]);
      setQuote(q);
      const max = balance - q.fee - gasPrice * MAX_GAS_RESERVE;
      setAmount(max > 0n ? String(Number(formatEther(max - (max % 10n ** 12n)))) : "0");
    } catch { /* the amount can still be typed by hand */ }
  }

  function reset() {
    try { localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
    watching.current = null;
    setStep("idle"); setAmount(""); setTxHash(null); setError(null);
    refreshBalances();
  }

  async function addToWallet() {
    if (!provider) return;
    setWalletNote(null);
    try {
      await switchChain(provider, elysium);
      setWalletNote("Elysium is ready in your wallet.");
    } catch (e: unknown) {
      setWalletNote((e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message ?? "Your wallet couldn't add Elysium.");
    }
  }

  const statusText =
    step === "preparing" ? "Checking the route…"
    : step === "signing" ? "Confirm the transaction in your wallet."
    : step === "confirming" ? "Waiting for HyperEVM to confirm…"
    : step === "delivering" ? "Sent. Your HYPE usually arrives on Elysium in 1–3 minutes."
    : step === "done" ? `${amount} HYPE arrived on Elysium.`
    : step === "late" ? "This is taking longer than usual. Your transfer is on HyperEVM, so please don't send it again. A delayed delivery can be retried on Elysium for 7 days."
    : error;

  const ctaOn = !busy && step !== "late" && !!provider && amountRaw > 0n && !insufficient && !!quote;
  const cta = step === "done" ? "Send more" : !provider ? "Connect a wallet" : insufficient ? "Not enough HYPE on HyperEVM" : amountRaw <= 0n ? "Enter an amount" : !quote ? "Connecting to Elysium…" : busy ? "Working…" : "Send to Elysium";
  const ctaFn = step === "done" ? reset : send;
  const ctaEnabled = step === "done" || ctaOn;

  const pane: CSSProperties = { background: "#F6F6FB", borderRadius: 18, padding: "12px 14px" };
  const label: CSSProperties = { fontSize: 11, fontWeight: 800, color: MUTED, letterSpacing: "0.04em" };
  const rows = [
    { k: "From", v: "HyperEVM" },
    { k: "To", v: "Elysium, same wallet address" },
    { k: "You receive", v: amountRaw > 0n ? `${amount} HYPE` : "—" },
    { k: "Delivery cost", v: quote ? `up to ${quote.fee < 10n ** 14n ? "0.0001" : short(quote.fee)} HYPE, unused part refunded on Elysium` : "—" },
    { k: "Arrival", v: "Usually 1–3 minutes" },
  ];

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", background: "#FFFFFF", border: `1px solid ${LINE}`, borderRadius: 28, padding: "1.1rem", boxShadow: "0 24px 60px -16px rgba(61,90,241,0.18)" }}>
      <style>{`.ff-elysium-amt, .ff-elysium-amt:focus { outline: none !important; box-shadow: none !important; border: none !important; background: transparent !important; }`}</style>

      <div style={pane}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={label}>YOU SEND</span>
          {hyperBal !== null && (
            <span style={{ fontSize: 11.5, color: MUTED }}>
              On HyperEVM: {short(hyperBal)} HYPE
              <button type="button" onClick={setMax} disabled={locked || step === "done"}
                style={{ border: "none", background: "#E3E8FD", color: BLUE, fontSize: 10.5, fontWeight: 800, padding: "2px 8px", borderRadius: 999, cursor: "pointer", marginLeft: 6 }}>MAX</button>
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input className="ff-elysium-amt" type="text" inputMode="decimal" value={amount} placeholder="0.00" disabled={locked || step === "done"} aria-label="HYPE amount"
            onChange={(e) => { if (/^\d*\.?\d*$/.test(e.target.value)) setAmount(e.target.value); }}
            style={{ flex: 1, minWidth: 0, fontSize: 30, fontWeight: 700, color: INK, padding: 0 }} />
          <span style={{ background: "#fff", borderRadius: 999, padding: "7px 14px", fontSize: 13, fontWeight: 700, color: INK, boxShadow: "0 1px 3px rgba(17,24,39,0.06)" }}>HYPE</span>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", margin: "10px 2px 0", fontSize: 12, color: MUTED }}>
        <span>On Elysium: {elysiumBal === null ? "—" : `${short(elysiumBal)} HYPE`}</span>
        <button type="button" onClick={onGetHype} disabled={locked} style={{ border: "none", background: "none", padding: 0, color: BLUE, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Get HYPE from another network</button>
      </div>

      <div style={{ marginTop: 10, border: `1px solid ${LINE}`, borderRadius: 18, padding: "6px 14px" }}>
        {rows.map((r, i) => (
          <div key={r.k} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0", borderBottom: i < rows.length - 1 ? `1px solid ${LINE}` : "none", fontSize: 12.5 }}>
            <span style={{ color: MUTED }}>{r.k}</span>
            <span style={{ color: INK, fontWeight: 600, textAlign: "right" }}>{r.v}</span>
          </div>
        ))}
      </div>

      {step !== "idle" && (
        <div style={{ marginTop: 12, display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 14px", borderRadius: 16, background: step === "done" ? "#E7F7EF" : step === "error" ? "#FDECEC" : "#FFF8EC", fontSize: 12.5, lineHeight: 1.5, color: step === "done" ? "#0B7A53" : step === "error" ? "#B91C1C" : "#6A4308" }}>
          {step === "done" && <Check size={16} style={{ flexShrink: 0, marginTop: 2 }} />}
          <span>{statusText}</span>
        </div>
      )}

      {txHash && (
        <div style={{ marginTop: 10, fontSize: 12 }}>
          <a href={`${hyperEvm.blockExplorers.default.url}/tx/${txHash}`} target="_blank" rel="noopener noreferrer" style={{ color: BLUE, fontWeight: 600 }}>HyperEVM tx ↗</a>
        </div>
      )}

      <button type="button" onClick={ctaFn} disabled={!ctaEnabled}
        style={{ width: "100%", marginTop: 14, height: 52, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 999, border: "none", background: ctaEnabled ? BLUE : "#EEEDF5", color: ctaEnabled ? "#FFFFFF" : "#8A8798", fontSize: 16, fontWeight: 700, cursor: ctaEnabled ? "pointer" : "not-allowed" }}>
        {cta} {ctaEnabled && <ArrowRight size={18} />}
      </button>

      <div style={{ textAlign: "center", marginTop: 10, display: "flex", justifyContent: "center", gap: 14, flexWrap: "wrap" }}>
        <button type="button" onClick={addToWallet} disabled={!provider || busy} style={{ background: "none", border: "none", color: MUTED, fontSize: 11.5, cursor: "pointer", textDecoration: "underline" }}>Add Elysium to my wallet</button>
        {step === "late" && <button type="button" onClick={reset} style={{ background: "none", border: "none", color: MUTED, fontSize: 11.5, cursor: "pointer", textDecoration: "underline" }}>Already arrived? Dismiss</button>}
      </div>

      {walletNote && <p style={{ margin: "8px 0 0", fontSize: 11.5, color: INK, lineHeight: 1.5, textAlign: "center", wordBreak: "break-word" }}>{walletNote}</p>}

      <p style={{ margin: "10px 0 0", fontSize: 11.5, color: MUTED, lineHeight: 1.5, textAlign: "center" }}>
        Withdrawals from Elysium back to HyperEVM take about 6 days. Elysium opens to the public on November 9, so the network may change before then.
      </p>
    </div>
  );
}
