import { useState, useEffect, useCallback } from "react";
import type { EIP1193Provider } from "viem";
import { createWalletClient, createPublicClient, custom, http, erc20Abi, parseUnits, formatUnits } from "viem";
import { arcTestnet, ARC_CHAIN_ID_HEX } from "../chains";
import TradingViewChart from "./TradingViewChart";
import PnlHistory from "./PnlHistory";

const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as `0x${string}`;
const PERPS_CONTRACT = "0x3B4cE1734087e1c67474Ff42982063febE3E4B20" as `0x${string}`;

const PERPS_ABI = [
  { type: "function", name: "openPosition", stateMutability: "nonpayable", inputs: [{ name: "isLong", type: "bool" }, { name: "margin", type: "uint256" }, { name: "leverage", type: "uint256" }, { name: "entryPrice", type: "uint256" }, { name: "market", type: "string" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "closePosition", stateMutability: "nonpayable", inputs: [{ name: "id", type: "uint256" }, { name: "exitPrice", type: "uint256" }], outputs: [] },
  { type: "function", name: "getUserPositions", stateMutability: "view", inputs: [{ name: "trader", type: "address" }], outputs: [{ name: "", type: "uint256[]" }] },
  { type: "function", name: "getPosition", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }], outputs: [
    { name: "trader", type: "address" }, { name: "isLong", type: "bool" }, { name: "margin", type: "uint256" },
    { name: "leverage", type: "uint256" }, { name: "entryPrice", type: "uint256" }, { name: "exitPrice", type: "uint256" },
    { name: "pnl", type: "int256" }, { name: "status", type: "uint8" }, { name: "openedAt", type: "uint256" }, { name: "market", type: "string" },
  ] },
  { type: "function", name: "getPoolLiquidity", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
] as const;

interface Props {
  provider: EIP1193Provider;
  address: string;
}

interface Position {
  id: number;
  isLong: boolean;
  marginNum: number;
  margin: string;
  leverage: number;
  entryPriceNum: number;
  entryPrice: string;
  status: number;
  market: string;
  pnl: number;
}

interface CloseResult {
  market: string;
  exitPrice: number;
  pnl: number;
  pct: number;
  payout: number;
}

const STATUS_LABELS = ["Open", "Closed", "Liquidated"];

function fmtPrice(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function switchToArc(provider: EIP1193Provider) {
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC_CHAIN_ID_HEX }] });
  } catch (e: unknown) {
    const err = e as { code?: number };
    if (err.code === 4902) {
      await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: ARC_CHAIN_ID_HEX, chainName: "Arc Testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: ["https://rpc.testnet.arc.network"], blockExplorerUrls: ["https://testnet.arcscan.app"] }] });
    } else throw e;
  }
}

function computePnl(p: Position, exitPrice: number): { pnl: number; pct: number; payout: number } {
  const size = p.marginNum * p.leverage;
  const priceDiff = p.isLong ? exitPrice - p.entryPriceNum : p.entryPriceNum - exitPrice;
  const pnl = (size * priceDiff) / p.entryPriceNum;
  const pct = (pnl / p.marginNum) * 100;
  let payout = p.marginNum + pnl;
  if (payout < 0) payout = 0;
  if (payout > p.marginNum * 2) payout = p.marginNum * 2;
  return { pnl, pct, payout };
}

function liquidationPrice(p: Position): number {
  const move = p.entryPriceNum / p.leverage;
  return p.isLong ? p.entryPriceNum - move : p.entryPriceNum + move;
}

export default function Perpetuals({ provider, address }: Props) {
  const [market, setMarket] = useState<"BTC" | "ETH">("BTC");
  const [prices, setPrices] = useState<{ BTC: number | null; ETH: number | null }>({ BTC: null, ETH: null });
  const [priceChange, setPriceChange] = useState<{ BTC: number | null; ETH: number | null }>({ BTC: null, ETH: null });
  const [isLong, setIsLong] = useState(true);
  const [margin, setMargin] = useState("");
  const [leverage, setLeverage] = useState(5);
  const [state, setState] = useState<"idle" | "approving" | "opening" | "closing" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loadingPositions, setLoadingPositions] = useState(true);
  const [closeResult, setCloseResult] = useState<CloseResult | null>(null);
  const [confirmClosingId, setConfirmClosingId] = useState<number | null>(null);
  const [poolLiquidity, setPoolLiquidity] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const loadPrices = useCallback(async () => {
    try {
      const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true");
      const data = await res.json();
      setPrices({ BTC: data.bitcoin?.usd ?? null, ETH: data.ethereum?.usd ?? null });
      setPriceChange({ BTC: data.bitcoin?.usd_24h_change ?? null, ETH: data.ethereum?.usd_24h_change ?? null });
    } catch {
      /* keep last known prices */
    }
  }, []);

  const loadPoolLiquidity = useCallback(async () => {
    try {
      const client = createPublicClient({ chain: arcTestnet, transport: http() });
      const liq = await client.readContract({ address: PERPS_CONTRACT, abi: PERPS_ABI, functionName: "getPoolLiquidity" });
      setPoolLiquidity(Number(formatUnits(liq, 6)).toFixed(2));
    } catch {
      setPoolLiquidity(null);
    }
  }, []);

  const loadPositions = useCallback(async () => {
    setLoadingPositions(true);
    try {
      const client = createPublicClient({ chain: arcTestnet, transport: http() });
      const ids = await client.readContract({ address: PERPS_CONTRACT, abi: PERPS_ABI, functionName: "getUserPositions", args: [address as `0x${string}`] });
      const loaded: Position[] = [];
      for (const id of ids as bigint[]) {
        const p = await client.readContract({ address: PERPS_CONTRACT, abi: PERPS_ABI, functionName: "getPosition", args: [id] });
        const [, isL, marginRaw, lev, entry, , pnlRaw, status, , mkt] = p as any;
        const marginNum = Number(formatUnits(marginRaw, 6));
        const entryPriceNum = Number(formatUnits(entry, 6));
        const pnlAbs = Number(formatUnits(pnlRaw < 0n ? -pnlRaw : pnlRaw, 6));
        loaded.push({
          id: Number(id), isLong: isL, marginNum, margin: marginNum.toFixed(2),
          leverage: Number(lev), entryPriceNum, entryPrice: entryPriceNum.toFixed(2),
          status: Number(status), market: mkt,
          pnl: pnlRaw < 0n ? -pnlAbs : pnlAbs,
        });
        await new Promise(r => setTimeout(r, 250));
      }
      setPositions(loaded.reverse());
    } catch {
      setPositions([]);
    } finally {
      setLoadingPositions(false);
    }
  }, [address]);

  useEffect(() => {
    loadPrices();
    const interval = setInterval(loadPrices, 15000);
    return () => clearInterval(interval);
  }, [loadPrices]);

  useEffect(() => { loadPositions(); loadPoolLiquidity(); }, [loadPositions, loadPoolLiquidity]);

  const currentPrice = prices[market];
  const change24h = priceChange[market];
  const openCount = positions.filter(p => p.status === 0).length;
  const closedTrades = positions.filter(p => p.status !== 0).slice().reverse();

  async function openPosition() {
    if (!margin || isNaN(Number(margin)) || Number(margin) <= 0) { setErrorMsg("Enter a valid margin amount."); return; }
    if (!currentPrice) { setErrorMsg("Price not loaded yet."); return; }
    setErrorMsg(null);
    try {
      await switchToArc(provider);
      const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
      const wc = createWalletClient({ chain: arcTestnet, transport: custom(provider) });
      const marginUnits = parseUnits(margin, 6);
      const priceUnits = BigInt(Math.round(currentPrice * 1e6));

      setState("approving");
      const approveHash = await wc.writeContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "approve", args: [PERPS_CONTRACT, marginUnits], account: address as `0x${string}` });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });

      setState("opening");
      const openHash = await wc.writeContract({ address: PERPS_CONTRACT, abi: PERPS_ABI, functionName: "openPosition", args: [isLong, marginUnits, BigInt(leverage), priceUnits, market], account: address as `0x${string}` });
      await publicClient.waitForTransactionReceipt({ hash: openHash });

      setState("idle"); setMargin("");
      await loadPositions();
      await loadPoolLiquidity();
    } catch (e: unknown) {
      const err = e as { message?: string };
      setErrorMsg(err.message ?? "Failed to open position."); setState("error");
    }
  }

  async function confirmClosePosition(p: Position) {
    const closePrice = prices[p.market as "BTC" | "ETH"];
    if (!closePrice) { setErrorMsg("Price not loaded yet."); return; }
    setErrorMsg(null); setState("closing"); setConfirmClosingId(null);
    try {
      await switchToArc(provider);
      const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
      const wc = createWalletClient({ chain: arcTestnet, transport: custom(provider) });
      const priceUnits = BigInt(Math.round(closePrice * 1e6));
      const hash = await wc.writeContract({ address: PERPS_CONTRACT, abi: PERPS_ABI, functionName: "closePosition", args: [BigInt(p.id), priceUnits], account: address as `0x${string}` });
      await publicClient.waitForTransactionReceipt({ hash });

      const result = computePnl(p, closePrice);
      setCloseResult({ market: p.market, exitPrice: closePrice, pnl: result.pnl, pct: result.pct, payout: result.payout });
      setState("idle");
      await loadPositions();
      await loadPoolLiquidity();
    } catch (e: unknown) {
      const err = e as { message?: string };
      setErrorMsg(err.message ?? "Failed to close position."); setState("error");
    }
  }

  const isLoading = state === "approving" || state === "opening" || state === "closing";

  if (closeResult) {
    const win = closeResult.pnl >= 0;
    return (
      <div style={{ maxWidth: 460, margin: "0 auto" }}>
        <div style={{ background: win ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)", border: `1px solid ${win ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.3)"}`, borderRadius: 16, padding: "2rem", textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>{win ? "📈" : "📉"}</div>
          <h3 style={{ color: win ? "#6ee7b7" : "#fca5a5", fontWeight: 800, fontSize: 22, marginBottom: 8 }}>
            {win ? "+" : ""}{closeResult.pnl.toFixed(2)} USDC ({win ? "+" : ""}{closeResult.pct.toFixed(1)}%)
          </h3>
          <p style={{ color: "#64748b", fontSize: 13, marginBottom: 20 }}>
            {closeResult.market}-PERP closed at ${fmtPrice(closeResult.exitPrice)}
          </p>
          <div style={{ background: "rgba(255,255,255,0.02)", borderRadius: 10, padding: "1rem", marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#94a3b8" }}>
              <span>Payout</span>
              <span style={{ color: "#f1f5f9", fontWeight: 700 }}>{closeResult.payout.toFixed(2)} USDC</span>
            </div>
          </div>
          <button onClick={() => setCloseResult(null)}
            style={{ width: "100%", padding: "0.9rem", borderRadius: 12, border: "none", background: "linear-gradient(135deg, #4f46e5, #7c3aed)", color: "#fff", fontSize: 16, fontWeight: 700, cursor: "pointer" }}>
            Back to Trading
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 10, padding: "0.7rem 1rem" }}>
        <p style={{ fontSize: 12, color: "#fca5a5", margin: 0 }}>
          Testnet demo — prices submitted client-side, not from a decentralized oracle. Not for real funds.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.75rem" }}>
        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "0.9rem 1rem" }}>
          <div style={{ fontSize: 10, color: "#334155", fontWeight: 700, letterSpacing: "1px", marginBottom: 4 }}>{market} PRICE</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#f1f5f9" }}>{currentPrice ? `$${fmtPrice(currentPrice)}` : "..."}</div>
          {change24h !== null && (
            <div style={{ fontSize: 11, fontWeight: 700, color: change24h >= 0 ? "#6ee7b7" : "#fca5a5", marginTop: 2 }}>
              {change24h >= 0 ? "▲" : "▼"} {Math.abs(change24h).toFixed(2)}% (24h)
            </div>
          )}
        </div>
        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "0.9rem 1rem" }}>
          <div style={{ fontSize: 10, color: "#334155", fontWeight: 700, letterSpacing: "1px", marginBottom: 4 }}>POOL LIQUIDITY</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#f1f5f9" }}>{poolLiquidity ? `$${poolLiquidity}` : "..."}</div>
          <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>Available for payouts</div>
        </div>
        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "0.9rem 1rem" }}>
          <div style={{ fontSize: 10, color: "#334155", fontWeight: 700, letterSpacing: "1px", marginBottom: 4 }}>OPEN POSITIONS</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#f1f5f9" }}>{openCount}</div>
          <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>Your active trades</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: "1rem", alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div style={{ display: "flex", gap: 8 }}>
            {(["BTC", "ETH"] as const).map((m) => (
              <button key={m} onClick={() => setMarket(m)} disabled={isLoading}
                style={{ flex: 1, padding: "0.6rem", borderRadius: 8, border: market === m ? "2px solid #3b82f6" : "1px solid rgba(255,255,255,0.08)", background: market === m ? "rgba(59,130,246,0.15)" : "rgba(255,255,255,0.03)", color: market === m ? "#60a5fa" : "#64748b", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                {m}-PERP
              </button>
            ))}
          </div>

          <TradingViewChart symbol={market} />

          <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setIsLong(true)} disabled={isLoading}
                style={{ flex: 1, padding: "0.7rem", borderRadius: 8, border: isLong ? "2px solid #10b981" : "1px solid rgba(255,255,255,0.08)", background: isLong ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.03)", color: isLong ? "#6ee7b7" : "#64748b", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                Long
              </button>
              <button onClick={() => setIsLong(false)} disabled={isLoading}
                style={{ flex: 1, padding: "0.7rem", borderRadius: 8, border: !isLong ? "2px solid #ef4444" : "1px solid rgba(255,255,255,0.08)", background: !isLong ? "rgba(239,68,68,0.15)" : "rgba(255,255,255,0.03)", color: !isLong ? "#fca5a5" : "#64748b", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                Short
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 13, color: "#94a3b8", fontWeight: 500 }}>Margin (USDC)</label>
              <input type="number" min="0" step="0.01" placeholder="0.00" value={margin} onChange={(e) => setMargin(e.target.value)} disabled={isLoading}
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "0.75rem 1rem", fontSize: 18, color: "#f1f5f9", fontWeight: 600, outline: "none" }} />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <label style={{ fontSize: 13, color: "#94a3b8", fontWeight: 500 }}>Leverage</label>
                <span style={{ fontSize: 13, color: "#f1f5f9", fontWeight: 700 }}>{leverage}x</span>
              </div>
              <input type="range" min="1" max="20" value={leverage} onChange={(e) => setLeverage(Number(e.target.value))} disabled={isLoading} />
            </div>

            {margin && currentPrice && (
              <div style={{ background: "rgba(255,255,255,0.02)", borderRadius: 10, padding: "0.8rem 0.9rem", display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ color: "#64748b" }}>Position Size</span>
                  <span style={{ color: "#e2e8f0", fontWeight: 600 }}>${(Number(margin) * leverage).toFixed(2)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ color: "#64748b" }}>Entry Price</span>
                  <span style={{ color: "#e2e8f0", fontWeight: 600 }}>${fmtPrice(currentPrice)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ color: "#64748b" }}>Est. Liquidation Price</span>
                  <span style={{ color: "#fca5a5", fontWeight: 600 }}>
                    ${fmtPrice(isLong ? currentPrice - currentPrice / leverage : currentPrice + currentPrice / leverage)}
                  </span>
                </div>
              </div>
            )}

            {errorMsg && <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "0.75rem 1rem", color: "#fca5a5", fontSize: 13 }}>{errorMsg}</div>}

            <button onClick={openPosition} disabled={isLoading || !currentPrice}
              style={{ width: "100%", padding: "0.9rem", borderRadius: 12, border: "none", background: isLong ? "linear-gradient(135deg, #059669, #10b981)" : "linear-gradient(135deg, #dc2626, #ef4444)", color: "#fff", fontSize: 16, fontWeight: 700, cursor: isLoading ? "not-allowed" : "pointer", opacity: isLoading || !currentPrice ? 0.6 : 1 }}>
              {state === "approving" && "Approving..."}
              {state === "opening" && "Opening..."}
              {(state === "idle" || state === "error") && `Open ${isLong ? "Long" : "Short"} ${leverage}x`}
            </button>
          </div>
        </div>

        <div>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <button onClick={() => setShowHistory(false)}
              style={{ flex: 1, padding: "0.4rem", borderRadius: 8, border: "none", background: !showHistory ? "rgba(79,70,229,0.15)" : "transparent", color: !showHistory ? "#a5b4fc" : "#64748b", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
              POSITIONS
            </button>
            <button onClick={() => setShowHistory(true)}
              style={{ flex: 1, padding: "0.4rem", borderRadius: 8, border: "none", background: showHistory ? "rgba(79,70,229,0.15)" : "transparent", color: showHistory ? "#a5b4fc" : "#64748b", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
              PNL HISTORY
            </button>
          </div>

          {!showHistory && (
            <>
              {loadingPositions && <div style={{ fontSize: 12, color: "#334155" }}>Loading...</div>}
              {!loadingPositions && positions.filter(p => p.status === 0).length === 0 && <div style={{ fontSize: 12, color: "#334155" }}>No open positions.</div>}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {positions.filter(p => p.status === 0).map((p) => {
                  const price = prices[p.market as "BTC" | "ETH"];
                  const live = price !== null ? computePnl(p, price) : null;
                  const liqPrice = liquidationPrice(p);
                  const confirming = confirmClosingId === p.id;
                  return (
                    <div key={p.id} style={{ background: "rgba(255,255,255,0.02)", border: `1px solid ${live && live.pnl >= 0 ? "rgba(16,185,129,0.2)" : live ? "rgba(239,68,68,0.2)" : "rgba(255,255,255,0.06)"}`, borderRadius: 14, padding: "1.1rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 7px", borderRadius: 5, background: p.isLong ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)", color: p.isLong ? "#6ee7b7" : "#fca5a5" }}>
                            {p.isLong ? "LONG" : "SHORT"}
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>{p.market}-PERP</span>
                          <span style={{ fontSize: 11, color: "#64748b" }}>{p.leverage}x</span>
                        </div>
                        <span style={{ fontSize: 10, fontWeight: 700, color: "#60a5fa" }}>{STATUS_LABELS[p.status]}</span>
                      </div>

                      {live && (
                        <div style={{ textAlign: "center", padding: "0.6rem 0", marginBottom: 10, background: live.pnl >= 0 ? "rgba(16,185,129,0.06)" : "rgba(239,68,68,0.06)", borderRadius: 10 }}>
                          <div style={{ fontSize: 18, fontWeight: 800, color: live.pnl >= 0 ? "#6ee7b7" : "#fca5a5" }}>
                            {live.pnl >= 0 ? "+" : ""}${live.pnl.toFixed(2)}
                          </div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: live.pnl >= 0 ? "#6ee7b7" : "#fca5a5" }}>
                            {live.pct >= 0 ? "+" : ""}{live.pct.toFixed(1)}% ROE
                          </div>
                        </div>
                      )}

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 11, marginBottom: 10 }}>
                        <div>
                          <div style={{ color: "#475569", marginBottom: 2 }}>Margin</div>
                          <div style={{ color: "#e2e8f0", fontWeight: 600 }}>${p.margin}</div>
                        </div>
                        <div>
                          <div style={{ color: "#475569", marginBottom: 2 }}>Entry Price</div>
                          <div style={{ color: "#e2e8f0", fontWeight: 600 }}>${fmtPrice(p.entryPriceNum)}</div>
                        </div>
                        <div>
                          <div style={{ color: "#475569", marginBottom: 2 }}>Mark Price</div>
                          <div style={{ color: "#e2e8f0", fontWeight: 600 }}>{price ? `$${fmtPrice(price)}` : "..."}</div>
                        </div>
                        <div>
                          <div style={{ color: "#475569", marginBottom: 2 }}>Liq. Price</div>
                          <div style={{ color: "#fca5a5", fontWeight: 600 }}>${fmtPrice(liqPrice)}</div>
                        </div>
                      </div>

                      {!confirming && (
                        <button onClick={() => setConfirmClosingId(p.id)} disabled={isLoading}
                          style={{ width: "100%", padding: "0.5rem", borderRadius: 8, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)", color: "#e2e8f0", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                          Close Position
                        </button>
                      )}
                      {confirming && (
                        <div style={{ display: "flex", gap: 6 }}>
                          <button onClick={() => confirmClosePosition(p)} disabled={isLoading}
                            style={{ flex: 1, padding: "0.5rem", borderRadius: 8, border: "none", background: "linear-gradient(135deg, #4f46e5, #7c3aed)", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                            {state === "closing" ? "Closing..." : `Confirm $${price ? fmtPrice(price) : "..."}`}
                          </button>
                          <button onClick={() => setConfirmClosingId(null)} disabled={isLoading}
                            style={{ padding: "0.5rem 0.8rem", borderRadius: 8, border: "1px solid rgba(255,255,255,0.08)", background: "transparent", color: "#94a3b8", fontSize: 11, cursor: "pointer" }}>
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {showHistory && <PnlHistory trades={closedTrades} />}
        </div>
      </div>
    </div>
  );
}