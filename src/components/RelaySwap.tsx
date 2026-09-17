import { useState } from "react";
import type { EIP1193Provider } from "viem";
import { createWalletClient, custom } from "viem";
import { createClient, getQuote, execute, type Execute } from "@relayprotocol/relay-sdk";
import { showToast } from "../toast";

// Deliberately NOT using @relayprotocol/relay-kit-ui's pre-built SwapWidget
// here -- it hard-requires wagmi v2, while LI.FI's widget (next to this one
// on the same page) hard-requires wagmi v3. Both can't be satisfied by a
// single installed wagmi version at once. Rather than risk breaking the
// already-working LI.FI integration to force a version onto Relay's
// widget, this talks to Relay's raw SDK directly (getQuote + execute),
// using the same EIP-1193-provider pattern already used everywhere else
// in this app (TokenBuyPanel, SwapForm, etc.) instead of wagmi at all.
const ARC_MAINNET_CHAIN_ID = 5042;
const ARC_MAINNET_USDC = "0x3600000000000000000000000000000000000000";
const BASE_CHAIN_ID = 8453;
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

// FlowFi's dedicated fee-receiving wallet -- same address registered as the
// default EVM receiver on LI.FI's side; passed explicitly here since
// Relay's appFees takes the recipient directly in the quote request, not
// via a portal-side setting.
const FEE_WALLET = "0x530Af0a7E1A702E8C23C8449Df61733C1B174cc8";

// Relay's own docs warn against sending their API key from the browser --
// baseApiUrl points at FlowFi's own proxy (api/relay-proxy/[...path].js),
// which injects RELAY_API_KEY server-side; the browser never sees it.
createClient({
  baseApiUrl: "/api/relay-proxy",
  source: "flowfi.finance",
});

type Step = "idle" | "quoting" | "quoted" | "executing" | "done";
export type RelayDirection = "toArc" | "fromArc";

// LI.FI does not yet surface Relay's Arc-outbound route (confirmed live:
// Arc -> Base works directly on relay.link, but LI.FI's aggregator returns
// no routes for that direction as of Arc's mainnet launch day). This
// component covers BOTH directions itself via Relay's own SDK, so it
// remains the only working path out of Arc until LI.FI indexes it.
const ROUTES: Record<RelayDirection, { fromChainId: number; fromCurrency: string; toChainId: number; toCurrency: string; label: string }> = {
  toArc: { fromChainId: BASE_CHAIN_ID, fromCurrency: BASE_USDC, toChainId: ARC_MAINNET_CHAIN_ID, toCurrency: ARC_MAINNET_USDC, label: "USDC on Base \u2192 USDC on Arc" },
  fromArc: { fromChainId: ARC_MAINNET_CHAIN_ID, fromCurrency: ARC_MAINNET_USDC, toChainId: BASE_CHAIN_ID, toCurrency: BASE_USDC, label: "USDC on Arc \u2192 USDC on Base" },
};

type TxStep = { id: string; label: string; status: "pending" | "current" | "done" };

function TransactionModal({
  direction,
  amount,
  outAmount,
  steps,
  onClose,
}: {
  direction: RelayDirection;
  amount: string;
  outAmount: string | undefined;
  steps: TxStep[];
  onClose: () => void;
}) {
  const route = ROUTES[direction];
  const fromLabel = direction === "toArc" ? "Base" : "Arc";
  const toLabel = direction === "toArc" ? "Arc" : "Base";

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 16, padding: "1.25rem", width: 340, maxWidth: "90vw" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#111827" }}>Transaction Details</div>
          <button onClick={onClose} style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 16, color: "#9CA3AF" }}>&times;</button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <div style={{ flex: 1, background: "#F9FAFB", borderRadius: 10, padding: "0.6rem 0.75rem" }}>
            <div style={{ fontSize: 11, color: "#6B7280" }}>{fromLabel}</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#111827" }}>{amount} USDC</div>
          </div>
          <div style={{ color: "#9CA3AF" }}>&rarr;</div>
          <div style={{ flex: 1, background: "#F9FAFB", borderRadius: 10, padding: "0.6rem 0.75rem" }}>
            <div style={{ fontSize: 11, color: "#6B7280" }}>{toLabel}</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#111827" }}>{outAmount ? `${outAmount} ${route.toCurrency === ARC_MAINNET_USDC || route.toCurrency === BASE_USDC ? "USDC" : ""}` : "..."}</div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {steps.map((s, i) => (
            <div key={s.id} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <div style={{
                width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: s.status === "done" ? "#DCFCE7" : s.status === "current" ? "#EDE9FE" : "#F3F4F6",
                color: s.status === "done" ? "#16A34A" : s.status === "current" ? "#6D5EF7" : "#9CA3AF",
                fontSize: 12, fontWeight: 700,
              }}>
                {s.status === "done" ? "\u2713" : i + 1}
              </div>
              <div style={{ paddingTop: 3 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: s.status === "pending" ? "#9CA3AF" : "#111827" }}>{s.label}</div>
                {s.status === "current" && <div style={{ fontSize: 11, color: "#6D5EF7" }}>In progress...</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function RelaySwap({ direction }: { direction: RelayDirection }) {
  const route = ROUTES[direction];
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [amount, setAmount] = useState("5");
  const [quote, setQuote] = useState<Execute | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txSteps, setTxSteps] = useState<TxStep[]>([]);
  const [showModal, setShowModal] = useState(false);

  async function connectWallet() {
    const eth = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
    if (!eth) {
      showToast("No browser wallet found (MetaMask, Rabby, etc.)", "error");
      return;
    }
    setConnecting(true);
    try {
      const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      setAddress(accounts[0]);
    } catch {
      showToast("Wallet connection was rejected.", "error");
    } finally {
      setConnecting(false);
    }
  }

  async function getWalletClient() {
    const eth = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
    if (!eth || !address) throw new Error("Connect a wallet first.");
    return createWalletClient({ transport: custom(eth), account: address as `0x${string}` });
  }

  async function doGetQuote() {
    if (!address) {
      showToast("Connect a wallet first.", "error");
      return;
    }
    const num = Number(amount);
    if (!amount || isNaN(num) || num <= 0) {
      showToast("Enter a USDC amount greater than 0.", "error");
      return;
    }
    setError(null);
    setStep("quoting");
    try {
      const wallet = await getWalletClient();
      const result = await getQuote({
        chainId: route.fromChainId,
        currency: route.fromCurrency,
        toChainId: route.toChainId,
        toCurrency: route.toCurrency,
        tradeType: "EXACT_INPUT",
        amount: String(Math.round(num * 1e6)), // USDC has 6 decimals
        wallet,
        recipient: address,
        options: {
          appFees: [{ recipient: FEE_WALLET, fee: "10" }], // 10 bps = 0.10%, matches the LI.FI side
        },
      });
      setQuote(result);
      setStep("quoted");

      // Pre-populate the step list from the quote so the modal shows the
      // full plan immediately, before execution starts.
      const rawSteps = (result as unknown as { steps?: { id: string; action?: string }[] }).steps ?? [];
      setTxSteps(rawSteps.map((s) => ({ id: s.id, label: s.action ?? s.id, status: "pending" as const })));
    } catch (e: unknown) {
      const err = e as { message?: string };
      setError(err.message ?? "Couldn't get a quote.");
      setStep("idle");
    }
  }

  async function doExecute() {
    if (!quote || !address) return;
    setStep("executing");
    setError(null);
    setShowModal(true);
    try {
      const wallet = await getWalletClient();
      await execute({
        quote,
        wallet,
        onProgress: (data) => {
          const currentId = data.currentStep?.id;
          setTxSteps((prev) => {
            if (prev.length === 0) return prev;
            const currentIdx = prev.findIndex((s) => s.id === currentId);
            return prev.map((s, i) => ({
              ...s,
              status: currentIdx === -1 ? s.status : i < currentIdx ? "done" : i === currentIdx ? "current" : "pending",
            }));
          });
        },
      });
      setTxSteps((prev) => prev.map((s) => ({ ...s, status: "done" })));
      setStep("done");
      showToast("Bridge complete", "success");
    } catch (e: unknown) {
      const err = e as { message?: string };
      setError(err.message ?? "Execution failed.");
      setStep("quoted");
      setShowModal(false);
    }
  }

  const outAmount = quote?.details?.currencyOut?.amountFormatted;

  return (
    <div style={{ background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 16, padding: "1rem", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 12, color: "#6B7280" }}>{route.label}</div>

      {!address ? (
        <button onClick={connectWallet} disabled={connecting}
          style={{ padding: "0.6rem", borderRadius: 8, border: "none", background: "#111827", color: "#fff", fontSize: 13, fontWeight: 700, cursor: connecting ? "not-allowed" : "pointer", opacity: connecting ? 0.6 : 1 }}>
          {connecting ? "Connecting..." : "Connect wallet"}
        </button>
      ) : (
        <>
          <input type="number" value={amount} onChange={(e) => { setAmount(e.target.value); setQuote(null); setStep("idle"); }} disabled={step === "executing"}
            placeholder="USDC amount" style={{ padding: "0.6rem 0.8rem", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 13 }} />

          {step === "quoted" && outAmount && (
            <div style={{ fontSize: 12, color: "#374151", background: "#fff", borderRadius: 8, padding: "0.5rem 0.7rem" }}>
              You'll receive &asymp; <strong>{outAmount} USDC</strong> on {direction === "toArc" ? "Arc" : "Base"}
            </div>
          )}

          {error && <div style={{ fontSize: 11, color: "#DC2626", wordBreak: "break-word" }}>{error}</div>}

          {step === "idle" || step === "quoting" ? (
            <button onClick={doGetQuote} disabled={step === "quoting"}
              style={{ padding: "0.6rem", borderRadius: 8, border: "none", background: "#6D5EF7", color: "#fff", fontSize: 13, fontWeight: 700, cursor: step === "quoting" ? "not-allowed" : "pointer", opacity: step === "quoting" ? 0.6 : 1 }}>
              {step === "quoting" ? "Getting quote..." : "Get quote"}
            </button>
          ) : (
            <button onClick={doExecute} disabled={step === "executing" || step === "done"}
              style={{ padding: "0.6rem", borderRadius: 8, border: "none", background: "#16A34A", color: "#fff", fontSize: 13, fontWeight: 700, cursor: step === "executing" || step === "done" ? "not-allowed" : "pointer", opacity: step === "executing" || step === "done" ? 0.6 : 1 }}>
              {step === "executing" ? "Bridging..." : step === "done" ? "Done" : "Confirm bridge"}
            </button>
          )}
        </>
      )}

      {showModal && (
        <TransactionModal
          direction={direction}
          amount={amount}
          outAmount={outAmount}
          steps={txSteps}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
