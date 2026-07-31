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
      await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: ARC_CHAIN_ID_HEX, chainName: "Arc Testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: ["https://arc-testnet.g.alchemy.com/v2/alch_1L2dTNapY_mz3YEIsoVEN"], blockExplorerUrls: ["https://testnet.arcscan.app"] }] });
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
        await new Promise(r => setTimeout(r, 50));
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
        <div style={{ background: win ? "rgba(52,211,153,0.1)" : "rgba(239,68,68,0.1)", borderRadius: 20, padding: "2rem", textAlign: "center" }}>
          <h3 style={{ color: win ? "#16A34A" : "#DC2626", fontWeight: 700, fontSize: 28, marginBottom: 8, fontFamily: "ui-monospace, monospace" }}>
            {win ? "+" : ""}{closeResult.pnl.toFixed(2)} USDC ({win ? "+" : ""}{closeResult.pct.toFixed(1)}%)
          </h3>
          <p style={{ color: "#4B5563", fontSize: 13, marginBottom: 20 }}>
            {closeResult.market}-PERP closed at ${fmtPrice(closeResult.exitPrice)}
          </p>
          <div style={{ background: "#f5f3ff", borderRadius: 12, padding: "1rem", marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#6B7280" }}>
              <span>Payout</span>
              <span style={{ color: "#111827", fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>{closeResult.payout.toFixed(2)} USDC</span>
            </div>
          </div>
          <button onClick={() => setCloseResult(null)}
            style={{ width: "100%", padding: "1rem", borderRadius: 16, border: "none", background: "#7c3aed", color: "#ffffff", fontSize: 16, fontWeight: 700, cursor: "pointer" }}>
            Back to Trading
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <div style={{ background: "rgba(239,68,68,0.1)", borderRadius: 10, padding: "0.7rem 1rem" }}>
        <p style={{ fontSize: 12, color: "#DC2626", margin: 0 }}>
          Testnet demo — prices submitted client-side, not from a decentralized oracle. Not for real funds.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.75rem" }}>
        <div style={{ background: "#f5f3ff", borderRadius: 14, padding: "0.9rem 1rem" }}>
          <div style={{ fontSize: 10, color: "#4B5563", fontWeight: 700, letterSpacing: "1px", marginBottom: 4 }}>{market} PRICE</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#111827", fontFamily: "ui-monospace, monospace" }}>{currentPrice ? `$${fmtPrice(currentPrice)}` : "..."}</div>
          {change24h !== null && (
            <div style={{ fontSize: 11, fontWeight: 700, color: change24h >= 0 ? "#16A34A" : "#DC2626", marginTop: 2 }}>
              {change24h >= 0 ? "▲" : "▼"} {Math.abs(change24h).toFixed(2)}% (24h)
            </div>
          )}
        </div>
        <div style={{ background: "#f5f3ff", borderRadius: 14, padding: "0.9rem 1rem" }}>
          <div style={{ fontSize: 10, color: "#4B5563", fontWeight: 700, letterSpacing: "1px", marginBottom: 4 }}>POOL LIQUIDITY</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#111827", fontFamily: "ui-monospace, monospace" }}>{poolLiquidity ? `$${poolLiquidity}` : "..."}</div>
          <div style={{ fontSize: 11, color: "#374151", marginTop: 2 }}>Available for payouts</div>
        </div>
        <div style={{ background: "#f5f3ff", borderRadius: 14, padding: "0.9rem 1rem" }}>
          <div style={{ fontSize: 10, color: "#4B5563", fontWeight: 700, letterSpacing: "1px", marginBottom: 4 }}>OPEN POSITIONS</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#111827", fontFamily: "ui-monospace, monospace" }}>{openCount}</div>
          <div style={{ fontSize: 11, color: "#374151", marginTop: 2 }}>Your active trades</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: "1rem", alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div style={{ display: "flex", gap: 8 }}>
            {(["BTC", "ETH"] as const).map((m) => (
  <button key={m} onClick={() => setMarket(m)} disabled={isLoading}
    style={{ flex: 1, padding: "0.6rem", borderRadius: 10, border: "none", background: market === m ? "#ede9fe" : "#f5f3ff", color: market === m ? "#5B21B6" : "#4B5563", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
    <img src={m === "BTC" ? "https://assets.coingecko.com/coins/images/1/small/bitcoin.png" : "https://assets.coingecko.com/coins/images/279/small/ethereum.png"} alt={m} style={{ width: 16, height: 16, borderRadius: "50%" }} />
    {m}-PERP
  </button>
))}
          </div>

          <TradingViewChart symbol={market} />

          <div style={{ background: "#ffffff", borderRadius: 20, padding: "1.25rem", display: "flex", flexDirection: "column", gap: "0.85rem" , boxShadow: "0 1px 3px rgba(124,58,237,0.08)" }}>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setIsLong(true)} disabled={isLoading}
                style={{ flex: 1, padding: "0.7rem", borderRadius: 10, border: "none", background: isLong ? "rgba(52,211,153,0.18)" : "#f5f3ff", color: isLong ? "#16A34A" : "#4B5563", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                Long
              </button>
              <button onClick={() => setIsLong(false)} disabled={isLoading}
                style={{ flex: 1, padding: "0.7rem", borderRadius: 10, border: "none", background: !isLong ? "rgba(239,68,68,0.18)" : "#f5f3ff", color: !isLong ? "#DC2626" : "#4B5563", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                Short
              </button>
            </div>

            <div style={{ borderRadius: 16, background: "#f5f3ff", padding: "1rem 1.1rem" }}>
              <label style={{ fontSize: 11, color: "#4B5563", fontWeight: 600, letterSpacing: "0.5px" }}>Margin (USDC)</label>
              <input type="number" min="0" step="0.01" placeholder="0.00" value={margin} onChange={(e) => setMargin(e.target.value)} disabled={isLoading}
                style={{ width: "100%", background: "transparent", border: "none", outline: "none", fontSize: 28, color: "#111827", fontWeight: 700, fontFamily: "ui-monospace, monospace", marginTop: 6 }} />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <label style={{ fontSize: 12, color: "#4B5563", fontWeight: 600 }}>Leverage</label>
                <span style={{ fontSize: 13, color: "#111827", fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>{leverage}x</span>
              </div>
              <input type="range" min="1" max="20" value={leverage} onChange={(e) => setLeverage(Number(e.target.value))} disabled={isLoading} />
            </div>

            {margin && currentPrice && (
              <div style={{ background: "#f5f3ff", borderRadius: 12, padding: "0.8rem 0.9rem", display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ color: "#4B5563" }}>Position Size</span>
                  <span style={{ color: "#111827", fontWeight: 600, fontFamily: "ui-monospace, monospace" }}>${(Number(margin) * leverage).toFixed(2)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ color: "#4B5563" }}>Entry Price</span>
                  <span style={{ color: "#111827", fontWeight: 600, fontFamily: "ui-monospace, monospace" }}>${fmtPrice(currentPrice)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ color: "#4B5563" }}>Est. Liquidation Price</span>
                  <span style={{ color: "#DC2626", fontWeight: 600, fontFamily: "ui-monospace, monospace" }}>
                    ${fmtPrice(isLong ? currentPrice - currentPrice / leverage : currentPrice + currentPrice / leverage)}
                  </span>
                </div>
              </div>
            )}

{(state === "approving" || state === "opening") && (
  <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "0.3rem 0" }}>
    {["approving", "opening"].map((s, i) => {
      const order = ["approving", "opening"];
      const currentIndex = order.indexOf(state);
      const isDone = currentIndex > i;
      const isActive = state === s;
      const isLast = i === order.length - 1;
      const label: Record<string, string> = { approving: "Approve", opening: "Open" };
      return (
        <div key={s} style={{ display: "flex", alignItems: "center", flex: isLast ? "0 0 auto" : 1 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <div style={{
              width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 10, fontWeight: 800,
              background: isDone ? "#7c3aed" : isActive ? "#ede9fe" : "#f5f3ff",
              color: isDone ? "#ffffff" : isActive ? "#5B21B6" : "#374151",
            }}>
              {isDone ? "✓" : i + 1}
            </div>
            <span style={{ fontSize: 9, color: isDone ? "#7c3aed" : isActive ? "#5B21B6" : "#374151" }}>{label[s]}</span>
          </div>
          {!isLast && <div style={{ height: 2, flex: 1, background: isDone ? "#7c3aed" : "#f5f3ff", marginBottom: 12 }} />}
        </div>
      );
    })}
  </div>
)}
            {errorMsg && <div style={{ background: "rgba(239,68,68,0.12)", borderRadius: 10, padding: "0.75rem 1rem", color: "#DC2626", fontSize: 13 }}>{errorMsg}</div>}
            <button onClick={openPosition} disabled={isLoading || !currentPrice}
              style={{ width: "100%", padding: "1rem", borderRadius: 16, border: "none", background: isLong ? "#16A34A" : "#ef4444", color: isLong ? "#ffffff" : "#fff", fontSize: 16, fontWeight: 700, cursor: isLoading ? "not-allowed" : "pointer", opacity: isLoading || !currentPrice ? 0.5 : 1 }}>
              {state === "approving" && "Approving..."}
              {state === "opening" && "Opening..."}
              {(state === "idle" || state === "error") && `Open ${isLong ? "Long" : "Short"} ${leverage}x`}
            </button>
          </div>
        </div>
        {margin && Number(margin) > 0 && currentPrice && (
  <div style={{ background: "rgba(124,58,237,0.1)", borderRadius: 16, padding: "1.1rem", marginBottom: 12 }}>
    <div style={{ fontSize: 10, color: "#5B21B6", fontWeight: 700, letterSpacing: "1px", marginBottom: 10 }}>POSITION SUMMARY</div>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
      <div>
        <div style={{ fontSize: 10, color: "#4B5563", marginBottom: 2 }}>Margin</div>
        <div style={{ fontSize: 14, color: "#111827", fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>${Number(margin).toFixed(2)}</div>
      </div>
      <div>
        <div style={{ fontSize: 10, color: "#4B5563", marginBottom: 2 }}>Leverage</div>
        <div style={{ fontSize: 14, color: "#111827", fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>{leverage}x</div>
      </div>
      <div>
        <div style={{ fontSize: 10, color: "#4B5563", marginBottom: 2 }}>Liquidation</div>
        <div style={{ fontSize: 14, color: "#DC2626", fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>
          ${fmtPrice(isLong ? currentPrice - currentPrice / leverage : currentPrice + currentPrice / leverage)}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 10, color: "#4B5563", marginBottom: 2 }}>Position Size</div>
        <div style={{ fontSize: 14, color: "#111827", fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>${(Number(margin) * leverage).toFixed(2)}</div>
      </div>
      <div>
        <div style={{ fontSize: 10, color: "#4B5563", marginBottom: 2 }}>PnL</div>
        <div style={{ fontSize: 14, color: "#4B5563", fontWeight: 700 }}>—</div>
      </div>
      <div>
        <div style={{ fontSize: 10, color: "#4B5563", marginBottom: 2 }}>ROI</div>
        <div style={{ fontSize: 14, color: "#4B5563", fontWeight: 700 }}>—</div>
      </div>
    </div>
    <p style={{ fontSize: 10, color: "#374151", marginTop: 10, marginBottom: 0 }}>Preview before opening — PnL and ROI appear once the position is live.</p>
  </div>
)}

        <div>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <button onClick={() => setShowHistory(false)}
              style={{ flex: 1, padding: "0.4rem", borderRadius: 8, border: "none", background: !showHistory ? "#ede9fe" : "transparent", color: !showHistory ? "#5B21B6" : "#4B5563", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
              POSITIONS
            </button>
            <button onClick={() => setShowHistory(true)}
              style={{ flex: 1, padding: "0.4rem", borderRadius: 8, border: "none", background: showHistory ? "#ede9fe" : "transparent", color: showHistory ? "#5B21B6" : "#4B5563", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
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
                    <div key={p.id} style={{ background: "#ffffff", borderRadius: 16, padding: "1.1rem" , boxShadow: "0 1px 3px rgba(124,58,237,0.08)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 7px", borderRadius: 5, background: p.isLong ? "rgba(52,211,153,0.18)" : "rgba(239,68,68,0.18)", color: p.isLong ? "#16A34A" : "#DC2626" }}>
                            {p.isLong ? "LONG" : "SHORT"}
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>{p.market}-PERP</span>
                          <span style={{ fontSize: 11, color: "#4B5563" }}>{p.leverage}x</span>
                        </div>
                        <span style={{ fontSize: 10, fontWeight: 700, color: "#5B21B6" }}>{STATUS_LABELS[p.status]}</span>
                      </div>

                      {live && (
                        <div style={{ textAlign: "center", padding: "0.6rem 0", marginBottom: 10, background: live.pnl >= 0 ? "rgba(52,211,153,0.1)" : "rgba(239,68,68,0.1)", borderRadius: 12 }}>
                          <div style={{ fontSize: 20, fontWeight: 700, color: live.pnl >= 0 ? "#16A34A" : "#DC2626", fontFamily: "ui-monospace, monospace" }}>
                            {live.pnl >= 0 ? "+" : ""}${live.pnl.toFixed(2)}
                          </div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: live.pnl >= 0 ? "#16A34A" : "#DC2626" }}>
                            {live.pct >= 0 ? "+" : ""}{live.pct.toFixed(1)}% ROE
                          </div>
                        </div>
                      )}

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 11, marginBottom: 10 }}>
                        <div>
                          <div style={{ color: "#374151", marginBottom: 2 }}>Margin</div>
                          <div style={{ color: "#111827", fontWeight: 600, fontFamily: "ui-monospace, monospace" }}>${p.margin}</div>
                        </div>
                        <div>
                          <div style={{ color: "#374151", marginBottom: 2 }}>Entry Price</div>
                          <div style={{ color: "#111827", fontWeight: 600, fontFamily: "ui-monospace, monospace" }}>${fmtPrice(p.entryPriceNum)}</div>
                        </div>
                        <div>
                          <div style={{ color: "#374151", marginBottom: 2 }}>Mark Price</div>
                          <div style={{ color: "#111827", fontWeight: 600, fontFamily: "ui-monospace, monospace" }}>{price ? `$${fmtPrice(price)}` : "..."}</div>
                        </div>
                        <div>
                          <div style={{ color: "#374151", marginBottom: 2 }}>Liq. Price</div>
                          <div style={{ color: "#DC2626", fontWeight: 600, fontFamily: "ui-monospace, monospace" }}>${fmtPrice(liqPrice)}</div>
                        </div>
                      </div>

                      {!confirming && (
                        <button onClick={() => setConfirmClosingId(p.id)} disabled={isLoading}
                          style={{ width: "100%", padding: "0.5rem", borderRadius: 10, border: "none", background: "#f5f3ff", color: "#111827", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                          Close Position
                        </button>
                      )}
                      {confirming && (
                        <div style={{ display: "flex", gap: 6 }}>
                          <button onClick={() => confirmClosePosition(p)} disabled={isLoading}
                            style={{ flex: 1, padding: "0.5rem", borderRadius: 10, border: "none", background: "#7c3aed", color: "#ffffff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                            {state === "closing" ? "Closing..." : `Confirm $${price ? fmtPrice(price) : "..."}`}
                          </button>
                          <button onClick={() => setConfirmClosingId(null)} disabled={isLoading}
                            style={{ padding: "0.5rem 0.8rem", borderRadius: 10, border: "none", background: "#f5f3ff", color: "#6B7280", fontSize: 11, cursor: "pointer" }}>
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
