import { useEffect, useMemo, useRef, useState } from "react";
import type { EIP1193Provider, Chain } from "viem";
import { createWalletClient, custom, defineChain } from "viem";
import { createClient, getQuote, execute, type Execute } from "@relayprotocol/relay-sdk";
import { showToast } from "../toast";

// Deliberately NOT using @relayprotocol/relay-kit-ui's pre-built SwapWidget
// -- it hard-requires wagmi v2 while other widgets on this page require
// wagmi v3. This talks to Relay's raw SDK/API directly instead.
//
// Relay's API sometimes returns a structured error body (an object, not a
// plain string). If that object ends up passed straight into `new
// Error(...)`, JS silently stringifies it to the literal text
// "[object Object]" -- a real string, so our old `typeof === "string"`
// check let it through, but a useless one. This digs through the common
// places the real detail could be hiding (response body, .data, nested
// .message) and falls back to JSON so we at least see the raw shape
// instead of that placeholder.
function extractErrorMessage(e: unknown): string {
  const anyE = e as Record<string, unknown> | undefined;
  const candidates = [
    anyE?.message,
    (anyE?.response as Record<string, unknown> | undefined)?.data,
    anyE?.data,
    anyE?.error,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c && c !== "[object Object]") return c;
    if (c && typeof c === "object") {
      const nested = (c as Record<string, unknown>).message ?? (c as Record<string, unknown>).error;
      if (typeof nested === "string" && nested) return nested;
      try {
        return JSON.stringify(c);
      } catch {
        // fall through
      }
    }
  }
  return "Couldn't get a quote.";
}

// Chain + token data is fetched live from Relay's own GET /chains
// endpoint rather than hand-maintained, so the picker mirrors relay.link's
// real, current universe (hundreds of tokens) instead of a small
// hardcoded list -- and it also means we're never trusting a
// hand-typed contract address: whatever Relay's own API returns is what
// gets used, exactly as relay.link itself does.
type RelayCurrency = { address: string; symbol: string; name: string; decimals: number; metadata?: { logoURI?: string } };
type RelayChain = {
  id: number;
  name: string;
  displayName: string;
  httpRpcUrl: string;
  vmType: string;
  disabled?: boolean;
  iconUrl?: string | null;
  currency: RelayCurrency;
  featuredTokens?: RelayCurrency[];
  erc20Currencies?: RelayCurrency[];
};

type TokenDef = { symbol: string; address: string; decimals: number; logoURI?: string };
type Side = { chainId: number; token: TokenDef };

// Pin a few common chains to the top of the picker for convenience; the
// full list (fetched live) still has everything else below, searchable.
const PINNED_CHAIN_IDS = [5042, 8453, 42161, 1];

function useRelayChains() {
  const [chains, setChains] = useState<RelayChain[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/relay-proxy/chains")
      .then((r) => r.json())
      .then((data: { chains: RelayChain[] }) => {
        if (cancelled) return;
        const evmChains = (data.chains ?? []).filter((c) => c.vmType === "evm" && !c.disabled);
        evmChains.sort((a, b) => {
          const ai = PINNED_CHAIN_IDS.indexOf(a.id);
          const bi = PINNED_CHAIN_IDS.indexOf(b.id);
          if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
          return a.displayName.localeCompare(b.displayName);
        });
        setChains(evmChains);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load the chain list from Relay.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { chains, error };
}

function tokensForChain(chain: RelayChain): TokenDef[] {
  const seen = new Map<string, TokenDef>();
  const add = (c: RelayCurrency | undefined) => {
    if (!c) return;
    const key = c.address.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, { symbol: c.symbol, address: c.address, decimals: c.decimals, logoURI: c.metadata?.logoURI });
    }
  };
  add(chain.currency);
  chain.featuredTokens?.forEach(add);
  chain.erc20Currencies?.forEach(add);
  return Array.from(seen.values());
}

// Arc's native gas token is USDC, but represented with 18 decimals at the
// protocol/native-balance level (wei-style) -- NOT the 6 decimals the USDC
// ERC-20 contract uses. Without an explicit chain object, viem misreads
// the wallet's real gas balance by 10^12 and throws a false
// "insufficient gas" error. Building the viem Chain from Relay's own
// /chains response (which already carries the correct native-currency
// decimals per chain) fixes this generically for every chain, not just
// Arc -- no per-chain hardcoding needed.
function toViemChain(rc: RelayChain): Chain {
  return defineChain({
    id: rc.id,
    name: rc.displayName || rc.name,
    nativeCurrency: { name: rc.currency.name, symbol: rc.currency.symbol, decimals: rc.currency.decimals },
    rpcUrls: { default: { http: [rc.httpRpcUrl] } },
  });
}

// No FlowFi fee on this route -- bridging is free for the user (Relay's
// own network fee still applies, same as using relay.link directly).
// Monetization moved to Token Launch / Liquidity Pools.

// Relay's own docs warn against sending their API key from the browser --
// baseApiUrl points at FlowFi's own proxy (api/relay-proxy/[...path].js),
// which injects RELAY_API_KEY server-side; the browser never sees it.
createClient({
  baseApiUrl: "/api/relay-proxy",
  source: "flowfi.finance",
});

type Step = "idle" | "quoting" | "quoted" | "executing" | "done";
type TxStep = { id: string; label: string; status: "pending" | "current" | "done" };

function ChainBadge({ chain, size = 24 }: { chain: RelayChain | undefined; size?: number }) {
  if (chain?.iconUrl) {
    return <img src={chain.iconUrl} alt="" width={size} height={size} style={{ borderRadius: "50%", flexShrink: 0 }} />;
  }
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: "#6B7280", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.42, fontWeight: 800, flexShrink: 0 }}>
      {(chain?.displayName ?? "?").slice(0, 1)}
    </div>
  );
}

function TokenBadge({ side, chain, onClick }: { side: Side; chain: RelayChain | undefined; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ display: "flex", alignItems: "center", gap: 8, background: "#F3F4F6", borderRadius: 999, padding: "0.4rem 0.6rem 0.4rem 0.4rem", border: "none", cursor: "pointer" }}
    >
      {side.token.logoURI ? (
        <img src={side.token.logoURI} alt="" width={24} height={24} style={{ borderRadius: "50%", flexShrink: 0 }} />
      ) : (
        <div style={{ width: 24, height: 24, borderRadius: "50%", background: "#EEF2FF", color: "#4338CA", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, flexShrink: 0 }}>
          {side.token.symbol.slice(0, 2)}
        </div>
      )}
      <div style={{ textAlign: "left" }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "#111827", lineHeight: 1.1 }}>{side.token.symbol}</div>
        <div style={{ fontSize: 10.5, color: "#6B7280", lineHeight: 1.1 }}>{chain?.displayName ?? "..."}</div>
      </div>
      <span style={{ color: "#9CA3AF", fontSize: 11, marginLeft: 2 }}>&#9662;</span>
    </button>
  );
}

function useTokenSearch(chainId: number | undefined, term: string, fallback: TokenDef[]) {
  const [results, setResults] = useState<TokenDef[] | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!chainId || !term.trim()) {
      setResults(null);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const handle = setTimeout(() => {
      fetch("/api/relay-proxy/currencies/v2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chainIds: [chainId], term: term.trim(), useExternalSearch: true, limit: 30 }),
      })
        .then((r) => r.json())
        .then((data: RelayCurrency[]) => {
          if (cancelled) return;
          setResults(
            (Array.isArray(data) ? data : []).map((t) => ({
              symbol: t.symbol,
              address: t.address,
              decimals: t.decimals,
              logoURI: t.metadata?.logoURI,
            }))
          );
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [chainId, term]);

  if (!term.trim()) return { tokens: fallback, searching: false };
  return { tokens: results ?? [], searching };
}

// "Select Token" picker, mirroring relay.link's own: a searchable chain
// list on the left, a searchable token list (for the selected chain) on
// the right -- backed by Relay's live /chains data, with the search box
// hitting Relay's currencies/v2 endpoint (useExternalSearch: true) so it
// finds the same broader token universe relay.link's own site shows, not
// just the curated "bridgeable" set from /chains.
function SelectTokenModal({
  chains,
  loadError,
  onPick,
  onClose,
}: {
  chains: RelayChain[] | null;
  loadError: string | null;
  onPick: (side: Side) => void;
  onClose: () => void;
}) {
  const [chainQuery, setChainQuery] = useState("");
  const [tokenQuery, setTokenQuery] = useState("");
  const [chainId, setChainId] = useState<number | null>(null);

  const filteredChains = useMemo(() => {
    if (!chains) return [];
    const q = chainQuery.trim().toLowerCase();
    return q ? chains.filter((c) => c.displayName.toLowerCase().includes(q)) : chains;
  }, [chains, chainQuery]);

  const activeChain = chains?.find((c) => c.id === (chainId ?? chains?.[0]?.id));
  const curatedTokens = activeChain ? tokensForChain(activeChain) : [];
  const { tokens: filteredTokens, searching } = useTokenSearch(activeChain?.id, tokenQuery, curatedTokens);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 16, width: 460, maxWidth: "92vw", maxHeight: "80vh", display: "flex", flexDirection: "column", overflow: "hidden" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.1rem 0.75rem" }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#111827" }}>Select Token</div>
          <button onClick={onClose} style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 16, color: "#9CA3AF" }}>&times;</button>
        </div>

        {loadError && <div style={{ padding: "0 1.1rem 0.75rem", fontSize: 12, color: "#DC2626" }}>{loadError}</div>}
        {!chains && !loadError && <div style={{ padding: "0 1.1rem 1.1rem", fontSize: 13, color: "#6B7280" }}>Loading chains...</div>}

        {chains && (
          <div style={{ display: "flex", borderTop: "1px solid #F3F4F6", flex: 1, minHeight: 0 }}>
            <div style={{ width: 140, borderRight: "1px solid #F3F4F6", display: "flex", flexDirection: "column", minHeight: 0 }}>
              <div style={{ padding: "0.6rem 0.6rem 0.4rem" }}>
                <input
                  value={chainQuery}
                  onChange={(e) => setChainQuery(e.target.value)}
                  placeholder="Search chains"
                  style={{ width: "100%", fontSize: 12, padding: "0.4rem 0.5rem", borderRadius: 8, border: "1px solid #E5E7EB", outline: "none" }}
                />
              </div>
              <div style={{ overflowY: "auto", padding: "0 0.6rem 0.6rem" }}>
                {filteredChains.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => { setChainId(c.id); setTokenQuery(""); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
                      padding: "0.45rem 0.4rem", borderRadius: 8, border: "none", cursor: "pointer", marginBottom: 2,
                      background: (chainId ?? chains[0]?.id) === c.id ? "#F3F4F6" : "transparent", fontSize: 12, fontWeight: 700, color: "#111827",
                    }}
                  >
                    <ChainBadge chain={c} size={20} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.displayName}</span>
                  </button>
                ))}
              </div>
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
              <div style={{ padding: "0.6rem 0.6rem 0.4rem" }}>
                <input
                  value={tokenQuery}
                  onChange={(e) => setTokenQuery(e.target.value)}
                  placeholder="Search for a token or paste address"
                  style={{ width: "100%", fontSize: 12.5, padding: "0.5rem 0.6rem", borderRadius: 8, border: "1px solid #E5E7EB", outline: "none" }}
                />
              </div>
              <div style={{ overflowY: "auto", padding: "0 0.6rem 0.6rem" }}>
                {searching && <div style={{ padding: "1rem 0.5rem", fontSize: 12.5, color: "#9CA3AF" }}>Searching...</div>}
                {!searching && filteredTokens.map((t) => (
                  <button
                    key={t.address}
                    type="button"
                    onClick={() => onPick({ chainId: activeChain!.id, token: t })}
                    style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", padding: "0.55rem 0.5rem", borderRadius: 8, border: "none", cursor: "pointer", background: "transparent" }}
                  >
                    {t.logoURI ? (
                      <img src={t.logoURI} alt="" width={28} height={28} style={{ borderRadius: "50%", flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#EEF2FF", color: "#4338CA", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10.5, fontWeight: 800, flexShrink: 0 }}>
                        {t.symbol.slice(0, 2)}
                      </div>
                    )}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: "#111827" }}>{t.symbol}</div>
                      <div style={{ fontSize: 10.5, color: "#6B7280", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{activeChain?.displayName}</div>
                    </div>
                  </button>
                ))}
                {!searching && filteredTokens.length === 0 && <div style={{ padding: "1rem 0.5rem", fontSize: 12.5, color: "#9CA3AF" }}>No tokens found.</div>}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TransactionModal({
  sell,
  buy,
  sellChain,
  buyChain,
  amount,
  outAmount,
  steps,
  onClose,
}: {
  sell: Side;
  buy: Side;
  sellChain: RelayChain | undefined;
  buyChain: RelayChain | undefined;
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
            <div style={{ fontSize: 11, color: "#6B7280" }}>{sellChain?.displayName ?? "..."}</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#111827" }}>{amount} {sell.token.symbol}</div>
          </div>
          <div style={{ color: "#9CA3AF" }}>&rarr;</div>
          <div style={{ flex: 1, background: "#F9FAFB", borderRadius: 10, padding: "0.6rem 0.75rem" }}>
            <div style={{ fontSize: 11, color: "#6B7280" }}>{buyChain?.displayName ?? "..."}</div>
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
  const { chains, error: chainsError } = useRelayChains();

  const [sell, setSell] = useState<Side>(defaultSell ?? { chainId: 8453, token: { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 } });
  const [buy, setBuy] = useState<Side>(defaultBuy ?? { chainId: 5042, token: { symbol: "USDC", address: "0x3600000000000000000000000000000000000000", decimals: 6 } });
  const [pickerSide, setPickerSide] = useState<"sell" | "buy" | null>(null);

  const sellChain = chains?.find((c) => c.id === sell.chainId);
  const buyChain = chains?.find((c) => c.id === buy.chainId);

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
    if (!sellChain) throw new Error("Chain list still loading -- try again in a moment.");
    return createWalletClient({ transport: custom(eth), account: address as `0x${string}`, chain: toViemChain(sellChain) });
  }

  const requestIdRef = useRef(0);

  async function doGetQuote() {
    if (!address || !sellChain) return;
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
        chainId: sell.chainId,
        currency: sell.token.address,
        toChainId: buy.chainId,
        toCurrency: buy.token.address,
        tradeType: "EXACT_INPUT",
        amount: String(Math.round(num * 10 ** sell.token.decimals)),
        wallet,
        user: address,
        recipient: address,
      });
      if (requestIdRef.current !== myRequestId) return;
      setQuote(result);
      setStep("quoted");

      const rawSteps = (result as unknown as { steps?: { id: string; action?: string }[] }).steps ?? [];
      setTxSteps(rawSteps.map((s) => ({ id: s.id, label: s.action ?? s.id, status: "pending" as const })));
    } catch (e: unknown) {
      if (requestIdRef.current !== myRequestId) return;
      setError(extractErrorMessage(e));
      setStep("idle");
    }
  }

  useEffect(() => {
    if (!address || !sellChain) return;
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
  }, [amount, sell.chainId, sell.token.address, buy.chainId, buy.token.address, address, !!sellChain]);

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
      showToast("Swap complete", "success");
    } catch (e: unknown) {
      setError(extractErrorMessage(e));
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
            <TokenBadge side={sell} chain={sellChain} onClick={() => setPickerSide("sell")} />
          </div>
        </div>

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

        <div style={{ background: "#F9FAFB", borderRadius: 14, padding: "0.9rem 1rem", marginTop: 6, marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 6 }}>Buy</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div style={{ fontSize: 32, fontWeight: 800, color: outAmount ? "#111827" : "#D1D5DB" }}>
              {outAmount ?? "0"}
            </div>
            <TokenBadge side={buy} chain={buyChain} onClick={() => setPickerSide("buy")} />
          </div>
        </div>

        {rate && (
          <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 10, padding: "0 2px" }}>
            1 {sell.token.symbol} &asymp; {rate} {buy.token.symbol}
          </div>
        )}

        {error && <div style={{ fontSize: 11.5, color: "#DC2626", wordBreak: "break-word", marginBottom: 10 }}>{error}</div>}
        {chainsError && <div style={{ fontSize: 11.5, color: "#DC2626", marginBottom: 10 }}>{chainsError}</div>}

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
          chains={chains}
          loadError={chainsError}
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
          sellChain={sellChain}
          buyChain={buyChain}
          amount={amount}
          outAmount={outAmount}
          steps={txSteps}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
