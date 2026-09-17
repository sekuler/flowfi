import { useEffect, useRef, useState } from "react";
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
// The layout below is a hand-built approximation of relay.link's own
// Sell/Buy card, since we can't use their pre-built widget component.
const ARC_MAINNET_CHAIN_ID = 5042;
const ARC_MAINNET_USDC = "0x3600000000000000000000000000000000000000";
const BASE_CHAIN_ID = 8453;
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

// No FlowFi fee on this route anymore -- bridging is now free for the
// user (Relay's own network fee still applies, same as using relay.link
// directly). Monetization moved to Token Launch / Liquidity Pools instead
// of competing on price with Relay itself, which nobody wins.

// Relay's own docs warn against sending their API key from the browser --
// baseApiUrl points at FlowFi's own proxy (api/relay-proxy/[...path].js),
// which injects RELAY_API_KEY server-side; the browser never sees it.
createClient({
  baseApiUrl: "/api/relay-proxy",
  source: "flowfi.finance",
});

type Step = "idle" | "quoting" | "quoted" | "executing" | "done";
export type RelayDirection = "toArc" | "fromArc";

type TokenInfo = { symbol: string; chainLabel: string; badgeBg: string; badgeText: string };

// LI.FI does not yet surface Relay's Arc-outbound route (confirmed live:
// Arc -> Base works directly on relay.link, but LI.FI's aggregator returns
// no routes for that direction as of Arc's mainnet launch day). This
// component covers BOTH directions itself via Relay's own SDK, so it
// remains the only working path out of Arc until LI.FI indexes it.
const ROUTES: Record<RelayDirection, { fromChainId: number; fromCurrency: string; toChainId: number; toCurrency: string; from: TokenInfo; to: TokenInfo }> = {
  toArc: {
    fromChainId: BASE_CHAIN_ID, fromCurrency: BASE_USDC, toChainId: ARC_MAINNET_CHAIN_ID, toCurrency: ARC_MAINNET_USDC,
    from: { symbol: "USDC", chainLabel: "Base", badgeBg: "#2563EB", badgeText: "B" },
    to: { symbol: "USDC", chainLabel: "Arc", badgeBg: "#111827", badgeText: "A" },
  },
  fromArc: {
    fromChainId: ARC_MAINNET_CHAIN_ID, fromCurrency: ARC_MAINNET_USDC, toChainId: BASE_CHAIN_ID, toCurrency: BASE_USDC,
    from: { symbol: "USDC", chainLabel: "Arc", badgeBg: "#111827", badgeText: "A" },
    to: { symbol: "USDC", chainLabel: "Base", badgeBg: "#2563EB", badgeText: "B" },
  },
};

type TxStep = { id: string; label: string; status: "pending" | "current" | "done" };

function TokenBadge({ token }: { token: TokenInfo }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#F3F4F6", borderRadius: 999, padding: "0.4rem 0.7rem 0.4rem 0.4rem" }}>
      <div style={{ width: 24, height: 24, borderRadius: "50%", background: token.badgeBg, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800 }}>
        {token.badgeText}
      </div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 800, color: "#111827", lineHeight: 1.1 }}>{token.symbol}</div>
        <div style={{ fontSize: 10.5, color: "#6B7280", lineHeight: 1.1 }}>{token.chainLabel}</div>
      </div>
    </div>
  );
}

function TransactionModal({
  from,
  to,
  amount,
  outAmount,
  steps,
  onClose,
}: {
  from: TokenInfo;
  to: TokenInfo;
  amount: string;
  outAmount: string | undefined;
  steps: TxStep[];
  onClose: () => void;
}) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 16, padding: "1.25rem", width: 340, maxWidth: "90vw" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#111827" }}>Transaction Details</div>
          <button onClick={onClose} style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 16, color: "#9CA3AF" }}>&times;</button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <div style={{ flex: 1, background: "#F9FAFB", borderRadius: 10, padding: "0.6rem 0.75rem" }}>
            <div style={{ fontSize: 11, color: "#6B7280" }}>{from.chainLabel}</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#111827" }}>{amount} {from.symbol}</div>
          </div>
          <div style={{ color: "#9CA3AF" }}>&rarr;</div>
          <div style={{ flex: 1, background: "#F9FAFB", borderRadius: 10, padding: "0.6rem 0.75rem" }}>
            <div style={{ fontSize: 11, color: "#6B7280" }}>{to.chainLabel}</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#111827" }}>{outAmount ? `${outAmount} ${to.symbol}` : "..."}</div>
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

export default function RelaySwap() {
  // Direction is owned here now (not passed in as a prop from a tab
  // switcher) -- the little arrow between the Sell/Buy panels flips it,
  // same as relay.link's own UI, instead of two separate tabs.
  const [direction, setDirection] = useState<RelayDirection>("toArc");
  const route = ROUTES[direction];
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [amount, setAmount] = useState("1");
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

  // Bumped on every new quote attempt so a slow, now-stale response can't
  // overwrite a newer one (e.g. user typed a new amount while the first
  // quote was still in flight).
  const requestIdRef = useRef(0);

  async function doGetQuote() {
    if (!address) return;
    const num = Number(amount);
    if (!amount || isNaN(num) || num <= 0) {
      setStep("idle");
      return;
    }
    const myRequestId = ++requestIdRef.current;
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
      });
      if (requestIdRef.current !== myRequestId) return; // a newer request superseded this one
      setQuote(result);
      setStep("quoted");

      const rawSteps = (result as unknown as { steps?: { id: string; action?: string }[] }).steps ?? [];
      setTxSteps(rawSteps.map((s) => ({ id: s.id, label: s.action ?? s.id, status: "pending" as const })));
    } catch (e: unknown) {
      if (requestIdRef.current !== myRequestId) return;
      const err = e as { message?: string };
      setError(err.message ?? "Couldn't get a quote.");
      setStep("idle");
    }
  }

  // Auto-quote as soon as a valid amount is entered (debounced) -- no more
  // separate "Get quote" click. Skips entirely until a wallet is connected,
  // since Relay's quote needs a wallet client.
  useEffect(() => {
    if (!address) return;
    const num = Number(amount);
    if (!amount || isNaN(num) || num <= 0) {
      setQuote(null);
      setStep("idle");
      return;
    }
    const handle = setTimeout(() => {
      doGetQuote();
    }, 450);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, direction, address]);

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
  const rate = quote?.details?.rate;

  const buttonLabel = !address
    ? connecting ? "Connecting..." : "Connect wallet"
    : step === "quoting" ? "Fetching quote..."
    : step === "executing" ? "Bridging..."
    : step === "done" ? "Done"
    : step === "quoted" ? "Approve & swap"
    : "Enter an amount";

  const buttonDisabled = connecting || step === "quoting" || step === "executing" || step === "done" || (!!address && step === "idle");

  function handleMainButton() {
    if (!address) return connectWallet();
    if (step === "quoted") return doExecute();
  }

  return (
    <div style={{ maxWidth: 440, margin: "0 auto" }}>
      <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 20, padding: "1.1rem", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        {/* Sell panel */}
        <div style={{ background: "#F9FAFB", borderRadius: 14, padding: "0.9rem 1rem", marginBottom: 6 }}>
          <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 6 }}>Sell</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <input
              type="number"
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setQuote(null); setStep("idle"); }}
              disabled={step === "executing"}
              placeholder="0"
              style={{ border: "none", background: "transparent", outline: "none", fontSize: 32, fontWeight: 800, color: "#111827", width: "60%", minWidth: 0 }}
            />
            <TokenBadge token={route.from} />
          </div>
        </div>

        {/* Direction divider -- click to flip Sell/Buy */}
        <div style={{ display: "flex", justifyContent: "center", margin: "-4px 0" }}>
          <button
            type="button"
            onClick={() => {
              if (step === "executing") return;
              setDirection((d) => (d === "toArc" ? "fromArc" : "toArc"));
              setQuote(null);
              setStep("idle");
              setError(null);
            }}
            disabled={step === "executing"}
            style={{ width: 32, height: 32, borderRadius: 10, background: "#fff", border: "1px solid #E5E7EB", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1, color: "#6B7280", fontSize: 14, cursor: step === "executing" ? "not-allowed" : "pointer" }}
          >
            &darr;
          </button>
        </div>

        {/* Buy panel */}
        <div style={{ background: "#F9FAFB", borderRadius: 14, padding: "0.9rem 1rem", marginTop: 6, marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 6 }}>Buy</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div style={{ fontSize: 32, fontWeight: 800, color: outAmount ? "#111827" : "#D1D5DB" }}>
              {outAmount ?? "0"}
            </div>
            <TokenBadge token={route.to} />
          </div>
        </div>

        {rate && (
          <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 10, padding: "0 2px" }}>
            1 {route.from.symbol} &asymp; {rate} {route.to.symbol}
          </div>
        )}

        {error && <div style={{ fontSize: 11.5, color: "#DC2626", wordBreak: "break-word", marginBottom: 10 }}>{error}</div>}

        <button
          onClick={handleMainButton}
          disabled={buttonDisabled}
          style={{
            width: "100%", padding: "0.95rem", borderRadius: 14, border: "none",
            background: buttonDisabled ? "#C4B5FD" : "#6D5EF7",
            color: "#fff", fontSize: 15, fontWeight: 800, letterSpacing: "0.3px",
            cursor: buttonDisabled ? "not-allowed" : "pointer",
          }}
        >
          {buttonLabel.toUpperCase()}
        </button>
      </div>

      {showModal && (
        <TransactionModal
          from={route.from}
          to={route.to}
          amount={amount}
          outAmount={outAmount}
          steps={txSteps}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
