import { useEffect, useRef, useState } from "react";
import type { EIP1193Provider, Chain } from "viem";
import { createWalletClient, custom } from "viem";
import { arc, arbitrum, base, mainnet } from "viem/chains";
import { createClient, getQuote, execute, type Execute } from "@relayprotocol/relay-sdk";
import { showToast } from "../toast";

// Deliberately NOT using @relayprotocol/relay-kit-ui's pre-built SwapWidget
// here -- it hard-requires wagmi v2, while LI.FI's widget (elsewhere on
// this page) hard-requires wagmi v3. Both can't be satisfied by a single
// installed wagmi version at once. This talks to Relay's raw SDK directly
// (getQuote + execute) via the same EIP-1193-provider pattern already used
// elsewhere in this app, instead of wagmi.
//
// Chain/token addresses below are all independently verified against
// official sources (Circle's own USDC contract docs, Etherscan/Arbiscan)
// on 2026-09-17, not guessed -- wrong addresses here mean lost funds.
const NATIVE = "0x0000000000000000000000000000000000000000";

const CHAINS = [
  { id: 5042, name: "Arc", badgeBg: "#111827", badgeText: "A" },
  { id: 8453, name: "Base", badgeBg: "#2563EB", badgeText: "B" },
  { id: 42161, name: "Arbitrum", badgeBg: "#28A0F0", badgeText: "AR" },
  { id: 1, name: "Ethereum", badgeBg: "#627EEA", badgeText: "E" },
] as const;

type TokenDef = { symbol: string; address: string; decimals: number };

// USDC addresses verified: Arc (Circle's own docs.arc.io), Base
// (Circle's official USDC contract list), Arbitrum (Circle's "USDC on
// Arbitrum Now Available" announcement -- native USDC, not the old
// bridged USDC.e), Ethereum (Etherscan-verified Circle contract).
const TOKENS_BY_CHAIN: Record<number, TokenDef[]> = {
  5042: [{ symbol: "USDC", address: "0x3600000000000000000000000000000000000000", decimals: 6 }],
  8453: [
    { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
    { symbol: "ETH", address: NATIVE, decimals: 18 },
  ],
  42161: [
    { symbol: "USDC", address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },
    { symbol: "ETH", address: NATIVE, decimals: 18 },
  ],
  1: [
    { symbol: "USDC", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
    { symbol: "ETH", address: NATIVE, decimals: 18 },
  ],
};

// Arc's native gas token is USDC, but represented with 18 decimals at the
// protocol/native-balance level (wei-style) -- NOT the 6 decimals the USDC
// ERC-20 contract itself uses. Without an explicit chain object, viem
// misreads the wallet's actual gas balance by a factor of 10^12 and throws
// a false "insufficient gas" error even when well-funded. viem ships
// Arc's correct definition natively, so this just needs importing.
const CHAIN_BY_ID: Record<number, Chain> = {
  5042: arc,
  8453: base,
  42161: arbitrum,
  1: mainnet,
};

function chainInfo(id: number) {
  return CHAINS.find((c) => c.id === id)!;
}

// No FlowFi fee on this route -- bridging is free for the user (Relay's
// own network fee still applies, same as using relay.link directly).
// Monetization moved to Token Launch / Liquidity Pools instead of
// competing on price with Relay itself.

// Relay's own docs warn against sending their API key from the browser --
// baseApiUrl points at FlowFi's own proxy (api/relay-proxy/[...path].js),
// which injects RELAY_API_KEY server-side; the browser never sees it.
createClient({
  baseApiUrl: "/api/relay-proxy",
  source: "flowfi.finance",
});

type Step = "idle" | "quoting" | "quoted" | "executing" | "done";
type Side = { chainId: number; token: TokenDef };
type TxStep = { id: string; label: string; status: "pending" | "current" | "done" };

function TokenBadge({ side, onClick }: { side: Side; onClick: () => void }) {
  const chain = chainInfo(side.chainId);
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ display: "flex", alignItems: "center", gap: 8, background: "#F3F4F6", borderRadius: 999, padding: "0.4rem 0.6rem 0.4rem 0.4rem", border: "none", cursor: "pointer" }}
    >
      <div style={{ width: 24, height: 24, borderRadius: "50%", background: chain.badgeBg, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10.5, fontWeight: 800, flexShrink: 0 }}>
        {chain.badgeText}
      </div>
      <div style={{ textAlign: "left" }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "#111827", lineHeight: 1.1 }}>{side.token.symbol}</div>
        <div style={{ fontSize: 10.5, color: "#6B7280", lineHeight: 1.1 }}>{chain.name}</div>
      </div>
      <span style={{ color: "#9CA3AF", fontSize: 11, marginLeft: 2 }}>&#9662;</span>
    </button>
  );
}

// "Select Token" picker -- chains on the left, tokens for the selected
// chain on the right. Scoped to the 4 chains/tokens we've verified above;
// this is smaller than relay.link's full universe on purpose, since a
// wrong contract address here costs someone real money.
function SelectTokenModal({
  onPick,
  onClose,
}: {
  onPick: (side: Side) => void;
  onClose: () => void;
}) {
  const [chainId, setChainId] = useState<number>(CHAINS[0].id);
  const tokens = TOKENS_BY_CHAIN[chainId] ?? [];

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 16, width: 420, maxWidth: "92vw", maxHeight: "80vh", display: "flex", flexDirection: "column", overflow: "hidden" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.1rem 0.75rem" }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#111827" }}>Select Token</div>
          <button onClick={onClose} style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 16, color: "#9CA3AF" }}>&times;</button>
        </div>
        <div style={{ display: "flex", borderTop: "1px solid #F3F4F6", flex: 1, minHeight: 0 }}>
          <div style={{ width: 130, borderRight: "1px solid #F3F4F6", padding: "0.6rem", overflowY: "auto" }}>
            {CHAINS.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setChainId(c.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
                  padding: "0.5rem 0.5rem", borderRadius: 8, border: "none", cursor: "pointer", marginBottom: 2,
                  background: chainId === c.id ? "#F3F4F6" : "transparent", fontSize: 12.5, fontWeight: 700, color: "#111827",
                }}
              >
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: c.badgeBg, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9.5, fontWeight: 800, flexShrink: 0 }}>
                  {c.badgeText}
                </div>
                {c.name}
              </button>
            ))}
          </div>
          <div style={{ flex: 1, padding: "0.6rem", overflowY: "auto" }}>
            {tokens.map((t) => (
              <button
                key={t.address}
                type="button"
                onClick={() => onPick({ chainId, token: t })}
                style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", padding: "0.6rem 0.5rem", borderRadius: 8, border: "none", cursor: "pointer", background: "transparent" }}
              >
                <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#EEF2FF", color: "#4338CA", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800 }}>
                  {t.symbol.slice(0, 2)}
                </div>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: "#111827" }}>{t.symbol}</div>
                  <div style={{ fontSize: 11, color: "#6B7280" }}>{chainInfo(chainId).name}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function TransactionModal({
  sell,
  buy,
  amount,
  outAmount,
  steps,
  onClose,
}: {
  sell: Side;
  buy: Side;
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
            <div style={{ fontSize: 11, color: "#6B7280" }}>{chainInfo(sell.chainId).name}</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#111827" }}>{amount} {sell.token.symbol}</div>
          </div>
          <div style={{ color: "#9CA3AF" }}>&rarr;</div>
          <div style={{ flex: 1, background: "#F9FAFB", borderRadius: 10, padding: "0.6rem 0.75rem" }}>
            <div style={{ fontSize: 11, color: "#6B7280" }}>{chainInfo(buy.chainId).name}</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#111827" }}>{outAmount ? `${outAmount} ${buy.token.symbol}` : "..."}</div>
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

export default function RelaySwap({
  defaultSell,
  defaultBuy,
}: {
  defaultSell?: Side;
  defaultBuy?: Side;
} = {}) {
  const [sell, setSell] = useState<Side>(defaultSell ?? { chainId: 8453, token: TOKENS_BY_CHAIN[8453][0] });
  const [buy, setBuy] = useState<Side>(defaultBuy ?? { chainId: 5042, token: TOKENS_BY_CHAIN[5042][0] });
  const [pickerSide, setPickerSide] = useState<"sell" | "buy" | null>(null);

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

  async function getWalletClient(forChainId: number) {
    const eth = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
    if (!eth || !address) throw new Error("Connect a wallet first.");
    return createWalletClient({ transport: custom(eth), account: address as `0x${string}`, chain: CHAIN_BY_ID[forChainId] });
  }

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
      const wallet = await getWalletClient(sell.chainId);
      const result = await getQuote({
        chainId: sell.chainId,
        currency: sell.token.address,
        toChainId: buy.chainId,
        toCurrency: buy.token.address,
        tradeType: "EXACT_INPUT",
        amount: String(Math.round(num * 10 ** sell.token.decimals)),
        wallet,
        recipient: address,
      });
      if (requestIdRef.current !== myRequestId) return;
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

  // Auto-quote as soon as a valid amount is entered (debounced).
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
  }, [amount, sell.chainId, sell.token.address, buy.chainId, buy.token.address, address]);

  async function doExecute() {
    if (!quote || !address) return;
    setStep("executing");
    setError(null);
    setShowModal(true);
    try {
      const wallet = await getWalletClient(sell.chainId);
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
      showToast("Swap complete", "success");
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

  function flipSides() {
    if (step === "executing") return;
    setSell(buy);
    setBuy(sell);
    setQuote(null);
    setStep("idle");
    setError(null);
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
              style={{ border: "none", background: "transparent", outline: "none", fontSize: 32, fontWeight: 800, color: "#111827", width: "55%", minWidth: 0 }}
            />
            <TokenBadge side={sell} onClick={() => setPickerSide("sell")} />
          </div>
        </div>

        {/* Direction flip -- swaps Sell and Buy sides entirely (chain + token) */}
        <div style={{ display: "flex", justifyContent: "center", margin: "-4px 0" }}>
          <button
            type="button"
            onClick={flipSides}
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
            <TokenBadge side={buy} onClick={() => setPickerSide("buy")} />
          </div>
        </div>

        {rate && (
          <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 10, padding: "0 2px" }}>
            1 {sell.token.symbol} &asymp; {rate} {buy.token.symbol}
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

      {pickerSide && (
        <SelectTokenModal
          onClose={() => setPickerSide(null)}
          onPick={(side) => {
            if (pickerSide === "sell") setSell(side);
            else setBuy(side);
            setPickerSide(null);
            setQuote(null);
            setStep("idle");
          }}
        />
      )}

      {showModal && (
        <TransactionModal
          sell={sell}
          buy={buy}
          amount={amount}
          outAmount={outAmount}
          steps={txSteps}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
