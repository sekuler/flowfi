import { useState, useEffect, createElement } from "react";
import { createPublicClient, createWalletClient, custom, http, erc20Abi, formatUnits, parseUnits, maxUint256 } from "viem";
import type { EIP1193Provider } from "viem";
import { PiggyBank, Landmark, RefreshCw, X, ArrowLeft, ExternalLink, Wallet, TrendingUp, CalendarDays, ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { arcMainnet, ARC_MAINNET_CHAIN_ID_HEX } from "../chains";
import { TokenOnChain } from "./AssetLogos";
import { ARC_LOGO } from "./tokenLogos";
import { useIsMobile } from "../useIsMobile";
import {
  MORPHO_BLUE, MARKETS, type BorrowAsset, USDC, CIRBTC, EURC, VAULTS, type EarnAsset, USDC_DECIMALS, CIRBTC_DECIMALS,
  WAD, ORACLE_SCALE, SAFE_LTV_PCT, MORPHO_ABI, IRM_ABI, ORACLE_ABI, VAULT_ABI, toAssetsUp, fetchVaultApy,
  AAVE_CORE_HUB, AAVE_SPOKE_ABI, AAVE_USDC_RESERVE_ID, fetchAaveUsdcApy, fetchVaultDetails, type VaultDetails, type ExposureItem, fetchVaultApyHistory, fetchAaveUsdcApyHistory, fetchMarketBorrowApyHistory, type ApyPoint,
} from "./morpho";
import AaveForexBorrow, { fetchForexSummary } from "./AaveForexBorrow";

// Earn & Borrow on Arc mainnet, built on Morpho. Earn = deposit USDC or EURC into a curated
// Morpho vault (ERC-4626). Borrow = cirBTC collateral, USDC or EURC loan on verified Morpho Blue markets.
// Browser wallet only: every call goes from the user's wallet straight to Morpho, FlowFi holds nothing.

const BLUE = "#3D5AF1";
const INK = "#16151C";
const MUTED = "#5E5B6B";
const LINE = "#DCE2F7";
const GAS_BUFFER = 50_000n; // 0.05 USDC left for gas on MAX (gas on Arc is paid in USDC)

const pc = createPublicClient({ chain: arcMainnet, transport: http() });

// Morpho's integrator requirements (docs.morpho.org/developers/earn/vault-ux/ux-requirement):
// a "Powered by Morpho" badge on the screens where users interact with Morpho, and an explicit
// acknowledgment of the Terms of Use + Morpho Disclaimer before the first interaction.
const TERMS_URL = "https://github.com/sekuler/flowfi/blob/main/TERMS.md";
const MORPHO_DISCLAIMER_URL = "https://morpho.org/disclaimers/";
const MORPHO_BADGE_SRC = "https://morpho.org/snippet.v1.js";
const MORPHO_BADGE_SRI = "sha384-o5vctdoI4K119T6AU2kFx3S1utrEqZdzkZwcW39c6p97FLU1fqqG0heM5xLbiYip";
const ackKey = (a: string) => `flowfi-morpho-ack-v1-${a.toLowerCase()}`;
function readAck(a: string) { try { return localStorage.getItem(ackKey(a)) === "1"; } catch { return false; } }
function loadMorphoBadge() {
  if (document.querySelector(`script[src="${MORPHO_BADGE_SRC}"]`)) return;
  const el = document.createElement("script");
  el.src = MORPHO_BADGE_SRC;
  el.integrity = MORPHO_BADGE_SRI;
  el.crossOrigin = "anonymous";
  el.async = true;
  document.head.appendChild(el);
}

// APY chart ranges. Morpho takes a day count; Aave takes one of its TimeWindow values.
type ChartRange = "1D" | "1W" | "1M" | "3M";
const RANGES: Record<ChartRange, { days: number; aave: "LAST_DAY" | "LAST_WEEK" | "LAST_MONTH"; label: string }> = {
  "1D": { days: 1, aave: "LAST_DAY", label: "day" },
  "1W": { days: 7, aave: "LAST_WEEK", label: "week" },
  "1M": { days: 30, aave: "LAST_MONTH", label: "month" },
  "3M": { days: 90, aave: "LAST_MONTH", label: "3 months" },
};
const MORPHO_RANGES: ChartRange[] = ["1W", "1M", "3M"];
const AAVE_RANGES: ChartRange[] = ["1D", "1W", "1M"];
const rangeFor = (kind: string, r: ChartRange): ChartRange => ((kind === "aave" ? AAVE_RANGES : MORPHO_RANGES).includes(r) ? r : "1M");

type Mkt = { totalSupplyAssets: bigint; totalSupplyShares: bigint; totalBorrowAssets: bigint; totalBorrowShares: bigint; lastUpdate: bigint; fee: bigint };
// assetOk: the vault's onchain asset() matches the token FlowFi thinks it is (checked on every load).
type VaultState = { tvl: bigint; shares: bigint; assets: bigint; maxW: bigint; assetOk: boolean };
type EarnAction = "deposit" | "withdraw";
type BorrowAction = "collateral" | "borrow" | "repay" | "withdraw";

const usd = (n: number, d = 2) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const compact = (n: number, cur = "$") => n >= 1e6 ? `${cur}${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${cur}${(n / 1e3).toFixed(2)}k` : `${cur}${usd(n)}`;
const pct = (n: number | null) => (n === null ? "—" : `${(n * 100).toFixed(2)}%`);
const u6 = (v: bigint) => Number(formatUnits(v, USDC_DECIMALS));
const b8 = (v: bigint) => Number(formatUnits(v, CIRBTC_DECIMALS));
const minB = (a: bigint, b: bigint) => (a < b ? a : b);
const pos0 = (v: bigint) => (v > 0n ? v : 0n);

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

export default function MorphoMainnet({ browserAddress, provider, onConnect }: { browserAddress?: string; provider?: EIP1193Provider; onConnect?: () => void }) {
  const owner = browserAddress && provider ? (browserAddress as `0x${string}`) : undefined;

  const [mode, setMode] = useState<"earn" | "borrow">("earn");
  const [tick, setTick] = useState(0);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [mkt, setMkt] = useState<Mkt | null>(null);
  const [price, setPrice] = useState<bigint | null>(null);
  const [rate, setRate] = useState<bigint | null>(null);
  const [pos, setPos] = useState<{ borrowShares: bigint; collateral: bigint }>({ borrowShares: 0n, collateral: 0n });
  const [walletUsdc, setWalletUsdc] = useState(0n);
  const [walletEurc, setWalletEurc] = useState(0n);
  const [earnAsset, setEarnAsset] = useState<EarnAsset>("USDC");
  const [borrowAsset, setBorrowAsset] = useState<BorrowAsset>("USDC");
  const M = MARKETS[borrowAsset];
  const [walletBtc, setWalletBtc] = useState(0n);
  const [vaults, setVaults] = useState<Record<string, VaultState>>({});
  const [apy, setApy] = useState<Record<string, number | null>>({});

  const [vaultKey, setVaultKey] = useState<string>(VAULTS[0].key);
  const [earnAction, setEarnAction] = useState<EarnAction>("deposit");
  const [borrowAction, setBorrowAction] = useState<BorrowAction>("collateral");
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [acked, setAcked] = useState(false);
  const [showAck, setShowAck] = useState(false);
  const [ackChecked, setAckChecked] = useState(false);
  // Earn: the vault list is the page; tapping a vault opens its own page (details + deposit box).
  const [panelOpen, setPanelOpen] = useState(false);
  const [details, setDetails] = useState<Record<string, VaultDetails>>({});
  // APY history chart on a Morpho vault page, cached per vault + range ("loading" while fetching, null when unavailable).
  const [chartRange, setChartRange] = useState<ChartRange>("1M");
  const [history, setHistory] = useState<Record<string, ApyPoint[] | null | "loading">>({});
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  // Borrow: market list first; tapping a market opens its page (same actions as before, new layout).
  const [borrowOpen, setBorrowOpen] = useState(false);
  // Aave V4 Forex (EURC collateral -> USDC loan) has its own page.
  const [forexOpen, setForexOpen] = useState(false);
  const [forex, setForex] = useState<{ available: number; rate: number; cf: number } | null>(null);
  type MktSummary = { apy: number; available: bigint; util: number };
  const [mkts, setMkts] = useState<Partial<Record<BorrowAsset, MktSummary>>>({});
  const [sortBy, setSortBy] = useState<"apy" | "size">("apy");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc"); // tapping the active header flips it
  const isMobile = useIsMobile();
  // Both borrow markets (USDC and EURC) for the "Your loans" card, read only while the Borrow tab is open.
  type Loan = { coll: bigint; debt: bigint; price: bigint; rate: bigint };
  const [loans, setLoans] = useState<Partial<Record<BorrowAsset, Loan>>>({});
  // "Aave is live" banner on Earn; once closed it stays closed in this browser.
  const [aaveBanner, setAaveBanner] = useState(() => { try { return localStorage.getItem("flowfi-aave-banner-v1") !== "closed"; } catch { return true; } });
  const closeAaveBanner = () => { setAaveBanner(false); try { localStorage.setItem("flowfi-aave-banner-v1", "closed"); } catch { /* shows again next visit */ } };

  useEffect(() => { loadMorphoBadge(); }, []);
  useEffect(() => { setAcked(owner ? readAck(owner) : false); }, [owner]);

  // Switching USDC <-> EURC borrow market: drop the old market's numbers right away, so nothing
  // (max, LTV, Repay all) is computed from the previous market while the new one loads.
  useEffect(() => {
    setMkt(null); setPrice(null); setRate(null); setPos({ borrowShares: 0n, collateral: 0n });
  }, [borrowAsset]);

  // Market, oracle, rate, vault TVLs, and the user's balances/positions.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [m, px] = await Promise.all([
          pc.readContract({ address: MORPHO_BLUE, abi: MORPHO_ABI, functionName: "market", args: [M.id] }),
          pc.readContract({ address: M.params.oracle, abi: ORACLE_ABI, functionName: "price" }),
        ]);
        const market: Mkt = { totalSupplyAssets: m[0], totalSupplyShares: m[1], totalBorrowAssets: m[2], totalBorrowShares: m[3], lastUpdate: m[4], fee: m[5] };
        const r = await pc.readContract({ address: M.params.irm, abi: IRM_ABI, functionName: "borrowRateView", args: [M.params, market] });

        const vs: Record<string, VaultState> = {};
        await Promise.all(VAULTS.map(async (v) => {
          if (v.kind === "aave") {
            // Safety check: reserve 0 on this Spoke must be USDC on Aave's Core Hub, or deposits stay paused.
            const [res, tvl] = await Promise.all([
              pc.readContract({ address: v.address, abi: AAVE_SPOKE_ABI, functionName: "getReserve", args: [AAVE_USDC_RESERVE_ID] }).catch(() => null),
              pc.readContract({ address: v.address, abi: AAVE_SPOKE_ABI, functionName: "getReserveSuppliedAssets", args: [AAVE_USDC_RESERVE_ID] }),
            ]);
            const assetOk = !!res && res.underlying.toLowerCase() === USDC.toLowerCase() && res.hub.toLowerCase() === AAVE_CORE_HUB.toLowerCase();
            const assets = owner ? await pc.readContract({ address: v.address, abi: AAVE_SPOKE_ABI, functionName: "getUserSuppliedAssets", args: [AAVE_USDC_RESERVE_ID, owner] }) : 0n;
            vs[v.key] = { tvl, shares: 0n, assets, maxW: 0n, assetOk };
            return;
          }
          const [tvl, underlying] = await Promise.all([
            pc.readContract({ address: v.address, abi: VAULT_ABI, functionName: "totalAssets" }),
            pc.readContract({ address: v.address, abi: VAULT_ABI, functionName: "asset" }).catch(() => null),
          ]);
          const assetOk = !!underlying && underlying.toLowerCase() === (v.asset === "EURC" ? EURC : USDC).toLowerCase();
          let shares = 0n, assets = 0n, maxW = 0n;
          if (owner) {
            [shares, maxW] = await Promise.all([
              pc.readContract({ address: v.address, abi: VAULT_ABI, functionName: "balanceOf", args: [owner] }),
              pc.readContract({ address: v.address, abi: VAULT_ABI, functionName: "maxWithdraw", args: [owner] }).catch(() => 0n),
            ]);
            if (shares > 0n) assets = await pc.readContract({ address: v.address, abi: VAULT_ABI, functionName: "convertToAssets", args: [shares] });
          }
          vs[v.key] = { tvl, shares, assets, maxW, assetOk };
        }));

        let p = { borrowShares: 0n, collateral: 0n }, wu = 0n, wb = 0n, we = 0n;
        if (owner) {
          const [ps, u, b, e] = await Promise.all([
            pc.readContract({ address: MORPHO_BLUE, abi: MORPHO_ABI, functionName: "position", args: [M.id, owner] }),
            pc.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
            pc.readContract({ address: CIRBTC, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
            pc.readContract({ address: EURC, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
          ]);
          p = { borrowShares: ps[1], collateral: ps[2] };
          wu = u; wb = b; we = e;
        }
        if (cancelled) return;
        setMkt(market); setPrice(px); setRate(r); setVaults(vs); setPos(p); setWalletUsdc(wu); setWalletBtc(wb); setWalletEurc(we); setLoadErr(null);
      } catch (e: unknown) {
        if (!cancelled) setLoadErr((e as { shortMessage?: string; message?: string }).shortMessage ?? "Could not load Morpho data. Try refresh.");
      }
    })();
    return () => { cancelled = true; };
  }, [owner, tick, borrowAsset]);

  // Morpho vault facts (deposits in $, withdrawable now, exposure, fees) for the list and the vault page,
  // refreshed with everything else on each tick.
  useEffect(() => {
    VAULTS.forEach((v) => { if (v.kind === "morpho") fetchVaultDetails(v.address).then((d) => setDetails((s) => ({ ...s, [v.key]: d }))); });
  }, [tick]);
  // Loans in both markets are read while the Borrow tab is open (for the list and the summary strip).
  // Auto-refresh every 60s while the tab is visible and no transaction is in flight, so numbers stay in step with Morpho/Aave.
  useEffect(() => {
    if (step === "sending") return;
    const id = setInterval(() => { if (document.visibilityState === "visible") setTick((t) => t + 1); }, 60_000);
    return () => clearInterval(id);
  }, [step]);
  useEffect(() => { if (mode !== "earn") setPanelOpen(false); if (mode !== "borrow") { setBorrowOpen(false); setForexOpen(false); } }, [mode]);
  useEffect(() => { if (mode === "borrow") fetchForexSummary().then(setForex); }, [mode, tick]);
  // Read-only numbers for the Borrow market list (both markets), same formulas as the market page below.
  useEffect(() => {
    if (mode !== "borrow") return;
    let cancelled = false;
    (async () => {
      const out: Partial<Record<BorrowAsset, MktSummary>> = {};
      await Promise.all((Object.keys(MARKETS) as BorrowAsset[]).map(async (k) => {
        const mk = MARKETS[k];
        try {
          const m = await pc.readContract({ address: MORPHO_BLUE, abi: MORPHO_ABI, functionName: "market", args: [mk.id] });
          const market: Mkt = { totalSupplyAssets: m[0], totalSupplyShares: m[1], totalBorrowAssets: m[2], totalBorrowShares: m[3], lastUpdate: m[4], fee: m[5] };
          const r = await pc.readContract({ address: mk.params.irm, abi: IRM_ABI, functionName: "borrowRateView", args: [mk.params, market] });
          const nowS = BigInt(Math.floor(Date.now() / 1000));
          const acc = nowS > market.lastUpdate ? (market.totalBorrowAssets * r * (nowS - market.lastUpdate)) / WAD : 0n;
          const tb = market.totalBorrowAssets + acc, ts = market.totalSupplyAssets + acc;
          out[k] = { apy: Math.exp((Number(r) / 1e18) * 31_536_000) - 1, available: pos0(ts - tb), util: ts > 0n ? Number(tb) / Number(ts) : 0 };
        } catch { /* leave this market out */ }
      }));
      if (!cancelled) setMkts(out);
    })();
    return () => { cancelled = true; };
  }, [mode, tick]);
  useEffect(() => {
    if (!borrowOpen) return;
    const rng = rangeFor("morpho", chartRange);
    const k = `borrow-${borrowAsset}-${rng}`;
    if (history[k] !== undefined) return;
    setHistory((s) => ({ ...s, [k]: "loading" }));
    fetchMarketBorrowApyHistory(MARKETS[borrowAsset].id, RANGES[rng].days).then((pts) => setHistory((s) => ({ ...s, [k]: pts })));
  }, [borrowOpen, borrowAsset, chartRange, history]);
  useEffect(() => {
    const v = VAULTS.find((x) => x.key === vaultKey);
    if (!panelOpen || !v) return;
    const rng = rangeFor(v.kind, chartRange);
    const k = `${vaultKey}-${rng}`;
    if (history[k] !== undefined) return;
    setHistory((s) => ({ ...s, [k]: "loading" }));
    const req = v.kind === "aave" ? fetchAaveUsdcApyHistory(RANGES[rng].aave) : fetchVaultApyHistory(v.address, RANGES[rng].days);
    req.then((pts) => setHistory((s) => ({ ...s, [k]: pts })));
  }, [panelOpen, vaultKey, chartRange, history]);

  useEffect(() => {
    VAULTS.forEach((v) => { (v.kind === "aave" ? fetchAaveUsdcApy() : fetchVaultApy(v.address)).then((a) => { if (a !== null || apy[v.key] === undefined) setApy((s) => ({ ...s, [v.key]: a })); }); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  useEffect(() => {
    if (!owner || mode !== "borrow") return;
    let cancelled = false;
    (async () => {
      const out: Partial<Record<BorrowAsset, Loan>> = {};
      await Promise.all((Object.keys(MARKETS) as BorrowAsset[]).map(async (k) => {
        const mk = MARKETS[k];
        try {
          const [m, ps, px] = await Promise.all([
            pc.readContract({ address: MORPHO_BLUE, abi: MORPHO_ABI, functionName: "market", args: [mk.id] }),
            pc.readContract({ address: MORPHO_BLUE, abi: MORPHO_ABI, functionName: "position", args: [mk.id, owner] }),
            pc.readContract({ address: mk.params.oracle, abi: ORACLE_ABI, functionName: "price" }),
          ]);
          const market: Mkt = { totalSupplyAssets: m[0], totalSupplyShares: m[1], totalBorrowAssets: m[2], totalBorrowShares: m[3], lastUpdate: m[4], fee: m[5] };
          const rate = await pc.readContract({ address: mk.params.irm, abi: IRM_ABI, functionName: "borrowRateView", args: [mk.params, market] });
          // Same interest accrual as the main Borrow numbers, so the debt matches what Repay all would pay.
          const nowS = BigInt(Math.floor(Date.now() / 1000));
          const acc = nowS > market.lastUpdate ? (market.totalBorrowAssets * rate * (nowS - market.lastUpdate)) / WAD : 0n;
          out[k] = { coll: ps[2], debt: toAssetsUp(ps[1], market.totalBorrowAssets + acc, market.totalBorrowShares), price: px, rate };
        } catch { /* leave this market out */ }
      }));
      if (!cancelled) setLoans(out);
    })();
    return () => { cancelled = true; };
  }, [owner, mode, tick]);

  // ---- derived market + position numbers ----
  // Clock for interest accrual, ticking every 15s (not read during render).
  const [now, setNow] = useState(() => BigInt(Math.floor(Date.now() / 1000)));
  useEffect(() => {
    const id = setInterval(() => setNow(BigInt(Math.floor(Date.now() / 1000))), 15000);
    return () => clearInterval(id);
  }, []);
  const interest = mkt && rate !== null && now > mkt.lastUpdate ? (mkt.totalBorrowAssets * rate * (now - mkt.lastUpdate)) / WAD : 0n;
  const totBorrow = mkt ? mkt.totalBorrowAssets + interest : 0n;
  const totSupply = mkt ? mkt.totalSupplyAssets + interest : 0n;
  const available = pos0(totSupply - totBorrow);
  const utilization = totSupply > 0n ? Number(totBorrow) / Number(totSupply) : 0;
  const borrowApy = rate !== null ? Math.exp((Number(rate) / 1e18) * 31_536_000) - 1 : null;
  // Loan-token side of the Borrow screen (USDC or EURC; both 6 decimals).
  const loanSym = borrowAsset;
  const lc = M.cur;
  const walletLoan = borrowAsset === "EURC" ? walletEurc : walletUsdc;
  const loanSpendable = borrowAsset === "EURC" ? walletEurc : pos0(walletUsdc - GAS_BUFFER);
  const btcPrice = price !== null ? Number(price / 10n ** 30n) / 1e4 : null; // 1e36 * 10^(6-8) scale

  const debt = mkt ? toAssetsUp(pos.borrowShares, totBorrow, mkt.totalBorrowShares) : 0n;
  const collValueOf = (c: bigint) => (price !== null ? (c * price) / ORACLE_SCALE : 0n); // in USDC units
  const ltvOf = (c: bigint, d: bigint) => { const v = collValueOf(c); return v > 0n ? Number(d) / Number(v) : d > 0n ? Infinity : 0; };
  const ltv = ltvOf(pos.collateral, debt);
  const liqPriceOf = (c: bigint, d: bigint) => (c > 0n && d > 0n ? u6(d) / (b8(c) * (Number(M.params.lltv) / 1e18)) : null);

  const vault = VAULTS.find((v) => v.key === vaultKey)!;
  const earnVaults = VAULTS.filter((v) => v.asset === earnAsset);
  const cur = earnAsset === "EURC" ? "€" : "$";
  const earnToken = earnAsset === "EURC" ? EURC : USDC;
  // Gas on Arc is paid in USDC, so only a USDC deposit keeps a little back for fees.
  const earnWallet = earnAsset === "EURC" ? walletEurc : pos0(walletUsdc - GAS_BUFFER);
  const earnWalletRaw = earnAsset === "EURC" ? walletEurc : walletUsdc;
  const vs = vaults[vaultKey] ?? { tvl: 0n, shares: 0n, assets: 0n, maxW: 0n, assetOk: true };
  // Some vaults report maxWithdraw = 0 for everyone; then the real limit is checked when the tx is simulated.
  const withdrawable = vs.maxW > 0n ? minB(vs.maxW, vs.assets) : vs.assets;
  const withdrawLimited = vs.maxW > 0n && vs.maxW < vs.assets;

  // ---- current action: token, max and the position after it ----
  const isEarn = mode === "earn";
  const tokenDecimals = !isEarn && (borrowAction === "collateral" || borrowAction === "withdraw") ? CIRBTC_DECIMALS : USDC_DECIMALS;
  const tokenSymbol = isEarn ? earnAsset : tokenDecimals === CIRBTC_DECIMALS ? "cirBTC" : loanSym;
  let amt = 0n;
  try { amt = amount ? parseUnits(amount as `${number}`, tokenDecimals) : 0n; } catch { amt = 0n; }

  const safeMaxDebt = (collValueOf(pos.collateral) * SAFE_LTV_PCT) / 100n;
  const requiredColl = debt > 0n && price ? (debt * ORACLE_SCALE * 100n + price * SAFE_LTV_PCT - 1n) / (price * SAFE_LTV_PCT) : 0n;
  const maxFor: Record<string, bigint> = {
    deposit: earnWallet,
    withdraw_earn: withdrawable,
    collateral: walletBtc,
    borrow: minB(pos0(safeMaxDebt - debt), available),
    repay: minB(debt, loanSpendable),
    withdraw: debt === 0n ? pos.collateral : pos0(pos.collateral - requiredColl),
  };
  const actionKey = isEarn ? (earnAction === "deposit" ? "deposit" : "withdraw_earn") : borrowAction;
  const max = maxFor[actionKey];

  const newColl = borrowAction === "collateral" ? pos.collateral + amt : borrowAction === "withdraw" ? pos0(pos.collateral - amt) : pos.collateral;
  const newDebt = borrowAction === "borrow" ? debt + amt : borrowAction === "repay" ? pos0(debt - amt) : debt;
  const newLtv = ltvOf(newColl, newDebt);
  const fullRepay = borrowAction === "repay" && debt > 0n && amt >= debt;
  const fullWithdrawEarn = earnAction === "withdraw" && vs.assets > 0n && amt >= vs.assets;

  const vaultBlocked = isEarn && earnAction === "deposit" && !vs.assetOk;
  const can = !!owner && amt > 0n && step !== "sending" && (fullRepay ? loanSpendable >= debt : amt <= max) && !!mkt && !vaultBlocked;
  const verb = isEarn ? (earnAction === "deposit" ? "Deposit" : "Withdraw")
    : ({ collateral: "Add collateral", borrow: "Borrow", repay: fullRepay ? "Repay all" : "Repay", withdraw: "Withdraw collateral" } as const)[borrowAction];
  const btn = step === "sending" ? "Confirm in your wallet..." : !amount ? "Enter an amount" : amt > max && !fullRepay ? (actionKey === "borrow" ? "Above the 70% safe limit" : actionKey === "withdraw" ? "Would go above the 70% safe limit" : "Not enough balance") : `${verb} ${amount} ${tokenSymbol}`;

  function start() {
    // The Morpho acknowledgment is only for Morpho actions (its vaults and the Borrow side).
    if (acked || (isEarn && vault.kind === "aave")) { run(); return; }
    setAckChecked(false); setShowAck(true);
  }
  function acceptAck() {
    if (!owner) return;
    try { localStorage.setItem(ackKey(owner), "1"); } catch { /* ask again next time */ }
    setAcked(true); setShowAck(false); run();
  }

  function reset() { setAmount(""); setStep("idle"); setMsg(null); setHash(null); }

  async function run() {
    if (!owner || !provider || !mkt) return;
    setStep("sending"); setHash(null);
    try {
      await switchToArc(provider);
      const wc = createWalletClient({ account: owner, chain: arcMainnet, transport: custom(provider) });
      const wait = async (h: `0x${string}`) => {
        setHash(h);
        const rc = await pc.waitForTransactionReceipt({ hash: h });
        if (rc.status === "reverted") throw new Error("The transaction reverted. Nothing changed.");
      };
      const approve = async (token: `0x${string}`, spender: `0x${string}`, need: bigint, label: string) => {
        const cur = await pc.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [owner, spender] });
        if (cur >= need) return;
        setMsg(`Approve ${label} in your wallet...`);
        await wait(await wc.writeContract({ address: token, abi: erc20Abi, functionName: "approve", args: [spender, need] }));
      };

      if (isEarn && vault.kind === "aave") {
        if (earnAction === "deposit") {
          await approve(earnToken, vault.address, amt, earnAsset);
          setMsg("Confirm the deposit...");
          const { request } = await pc.simulateContract({ account: owner, address: vault.address, abi: AAVE_SPOKE_ABI, functionName: "supply", args: [AAVE_USDC_RESERVE_ID, amt, owner] });
          await wait(await wc.writeContract(request));
        } else {
          setMsg("Confirm the withdrawal...");
          const { request } = await pc.simulateContract({ account: owner, address: vault.address, abi: AAVE_SPOKE_ABI, functionName: "withdraw", args: [AAVE_USDC_RESERVE_ID, fullWithdrawEarn ? maxUint256 : amt, owner] });
          await wait(await wc.writeContract(request));
        }
      } else if (isEarn) {
        if (earnAction === "deposit") {
          await approve(earnToken, vault.address, amt, earnAsset);
          setMsg("Confirm the deposit...");
          const { request } = await pc.simulateContract({ account: owner, address: vault.address, abi: VAULT_ABI, functionName: "deposit", args: [amt, owner] });
          await wait(await wc.writeContract(request));
        } else {
          setMsg("Confirm the withdrawal...");
          if (fullWithdrawEarn) {
            const { request } = await pc.simulateContract({ account: owner, address: vault.address, abi: VAULT_ABI, functionName: "redeem", args: [vs.shares, owner, owner] });
            await wait(await wc.writeContract(request));
          } else {
            const { request } = await pc.simulateContract({ account: owner, address: vault.address, abi: VAULT_ABI, functionName: "withdraw", args: [amt, owner, owner] });
            await wait(await wc.writeContract(request));
          }
        }
      } else if (borrowAction === "collateral") {
        await approve(CIRBTC, MORPHO_BLUE, amt, "cirBTC");
        setMsg("Confirm adding collateral...");
        const { request } = await pc.simulateContract({ account: owner, address: MORPHO_BLUE, abi: MORPHO_ABI, functionName: "supplyCollateral", args: [M.params, amt, owner, "0x"] });
        await wait(await wc.writeContract(request));
      } else if (borrowAction === "borrow") {
        setMsg("Confirm the borrow...");
        const { request } = await pc.simulateContract({ account: owner, address: MORPHO_BLUE, abi: MORPHO_ABI, functionName: "borrow", args: [M.params, amt, 0n, owner, owner] });
        await wait(await wc.writeContract(request));
      } else if (borrowAction === "repay") {
        // Full repay goes by shares so no dust debt is left; approve a small buffer for interest accrued meanwhile.
        const need = fullRepay ? minB(loanSpendable, (debt * 1001n) / 1000n + 10_000n) : amt;
        await approve(M.loan, MORPHO_BLUE, need, loanSym);
        setMsg("Confirm the repayment...");
        const [repayAssets, repayShares] = fullRepay ? [0n, pos.borrowShares] : [amt, 0n];
        const { request } = await pc.simulateContract({ account: owner, address: MORPHO_BLUE, abi: MORPHO_ABI, functionName: "repay", args: [M.params, repayAssets, repayShares, owner, "0x"] });
        await wait(await wc.writeContract(request));
      } else {
        setMsg("Confirm the collateral withdrawal...");
        const { request } = await pc.simulateContract({ account: owner, address: MORPHO_BLUE, abi: MORPHO_ABI, functionName: "withdrawCollateral", args: [M.params, amt, owner, owner] });
        await wait(await wc.writeContract(request));
      }
      setStep("done"); setMsg(`${verb} ${amount} ${tokenSymbol}: done.`); setAmount("");
      setTick((t) => t + 1);
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string };
      setStep("error"); setMsg(err.shortMessage || err.message || "Transaction failed.");
    }
  }

  // ---- styles (same glass cards as Gateway / Circle Wallet) ----
  const card = { background: "linear-gradient(160deg, rgba(255,255,255,0.82) 0%, rgba(236,240,255,0.74) 100%)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)", color: INK, border: "1px solid rgba(255,255,255,0.95)", borderRadius: 20, padding: "1.25rem", display: "flex", flexDirection: "column" as const, gap: 12, boxShadow: "0 22px 50px -30px rgba(61,90,241,0.55), inset 0 1px 0 rgba(255,255,255,0.9)" };
  const hero = { background: "linear-gradient(135deg, #2F4DE8 0%, #3D5AF1 45%, #6C8BFF 100%)", color: "#FFFFFF", borderRadius: 20, padding: "1.25rem", boxShadow: "0 22px 50px -26px rgba(61,90,241,0.8)" };
  const input = { width: "100%", boxSizing: "border-box" as const, height: 46, padding: "0 14px", borderRadius: 12, border: `1px solid ${LINE}`, fontSize: 14, color: INK, background: "rgba(255,255,255,0.85)" };
  const label = { fontSize: 12, fontWeight: 600, color: MUTED } as const;
  const primary = (on: boolean) => ({ width: "100%", height: 48, borderRadius: 12, border: "none", background: on ? BLUE : "#EEEDF5", color: on ? "#FFFFFF" : "#8A8798", fontSize: 15, fontWeight: 600, cursor: on ? "pointer" : "not-allowed" });
  const sectionTitle = (Icon: typeof PiggyBank, text: string) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ width: 36, height: 36, borderRadius: 11, background: "linear-gradient(135deg, #3D5AF1 0%, #6C8BFF 100%)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 6px 16px -6px rgba(61,90,241,0.7)" }}>
        <Icon size={18} color="#FFFFFF" />
      </span>
      <span style={{ fontSize: 19, fontWeight: 700, color: BLUE, letterSpacing: "-0.01em" }}>{text}</span>
    </div>
  );
  const segmented = <T extends string>(opts: { k: T; t: string }[], cur: T, set: (k: T) => void, aria: string) => (
    <div role="group" aria-label={aria} style={{ display: "flex", gap: 2, padding: 3, borderRadius: 12, background: "#E6EAFB" }}>
      {opts.map(({ k, t }) => {
        const on = cur === k;
        return (
          <button key={k} type="button" aria-pressed={on} disabled={step === "sending"} onClick={() => { set(k); reset(); }}
            style={{ flex: 1, minHeight: 36, borderRadius: 10, border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 600, background: on ? "#FFFFFF" : "transparent", color: on ? BLUE : MUTED, boxShadow: on ? "0 1px 2px rgba(22,21,28,0.12)" : "none" }}>
            {t}
          </button>
        );
      })}
    </div>
  );
  // Round logo for a vault: the curator's/protocol's official mark, or its initial when we have none.
  const avatar = (v: (typeof VAULTS)[number], size: number, onHero: boolean) => (
    <span style={{ width: size, height: size, borderRadius: 999, overflow: "hidden", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
      background: v.kind === "aave" ? (onHero ? "#FFFFFF" : "#F3E8F8") : onHero ? "#FFFFFF" : "#E6EAFB", color: BLUE, fontWeight: 800, fontSize: size * 0.42 }}>
      {(v.logo as string | null)
        ? <img src={v.logo} alt="" style={v.kind === "aave" ? { width: size * 0.66, height: size * 0.36, objectFit: "contain" } : { width: "100%", height: "100%", objectFit: "cover" }} />
        : v.curator.slice(0, 1)}
    </span>
  );
  const row = (k: string, v: string, strong = false) => (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
      <span style={{ color: MUTED }}>{k}</span>
      <span style={{ color: INK, fontWeight: strong ? 700 : 600 }}>{v}</span>
    </div>
  );
  const ltvColor = (x: number) => (x < 0.5 ? "#0B7A53" : x < 0.7 ? "#B45309" : "#B91C1C");
  const ltvBar = (cur: number, next: number | null) => {
    const w = (x: number) => `${Math.min(100, Math.max(0, x * 100))}%`;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ position: "relative", height: 10, borderRadius: 999, background: "#E6EAFB", overflow: "hidden" }}>
          {next !== null && <div style={{ position: "absolute", inset: 0, width: w(next), background: ltvColor(next), opacity: 0.35 }} />}
          <div style={{ position: "absolute", inset: 0, width: w(cur), background: ltvColor(cur) }} />
          <div title="FlowFi safe limit 70%" style={{ position: "absolute", left: "70%", top: 0, bottom: 0, width: 2, background: "#B45309" }} />
          <div title="Liquidation 86%" style={{ position: "absolute", left: "86%", top: 0, bottom: 0, width: 2, background: "#B91C1C" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: MUTED }}>
          <span>LTV {Number.isFinite(cur) ? `${(cur * 100).toFixed(1)}%` : "—"}{next !== null && Number.isFinite(next) && next !== cur ? ` → ${(next * 100).toFixed(1)}%` : ""}</span>
          <span>Safe limit 70% · Liquidation 86%</span>
        </div>
      </div>
    );
  };

  const walletLine = isEarn
    ? earnAction === "deposit" ? `In wallet ${usd(u6(earnWalletRaw))} ${earnAsset}` : `Withdrawable ${usd(u6(withdrawable))} ${earnAsset}`
    : borrowAction === "collateral" ? `In wallet ${b8(walletBtc).toFixed(8)} cirBTC`
    : borrowAction === "withdraw" ? `Withdrawable ${b8(maxFor.withdraw).toFixed(8)} cirBTC`
    : borrowAction === "borrow" ? `You can borrow ${usd(u6(maxFor.borrow))} ${loanSym}`
    : `Debt ${usd(u6(debt))} ${loanSym} · wallet ${usd(u6(walletLoan))} ${loanSym}`;

  const setMax = () => {
    if (!isEarn && borrowAction === "repay" && debt > 0n && loanSpendable >= debt) { setAmount(formatUnits(debt, USDC_DECIMALS)); return; }
    if (isEarn && earnAction === "withdraw" && !withdrawLimited && vs.assets > 0n) { setAmount(formatUnits(vs.assets, USDC_DECIMALS)); return; }
    setAmount(formatUnits(max, tokenDecimals));
  };

  // Earn positions: every vault the user has money in (amounts read onchain above), summed in a strip
  // above the vault list. Totals stay per currency (no made-up FX rate).
  const positions = VAULTS.filter((v) => (vaults[v.key]?.assets ?? 0n) > 0n);
  const sumOf = (a: "USDC" | "EURC") => positions.filter((v) => v.asset === a).reduce((t, v) => t + u6(vaults[v.key].assets), 0);
  const yearlyOf = (a: "USDC" | "EURC") => positions.filter((v) => v.asset === a).reduce((t, v) => t + u6(vaults[v.key].assets) * (apy[v.key] ?? 0), 0);
  const both = (fn: (a: "USDC" | "EURC") => number, sign = "") => {
    const parts = [["USDC", "$"], ["EURC", "€"]].filter(([a]) => positions.some((v) => v.asset === a)).map(([a, c]) => `${sign}${c}${usd(fn(a as "USDC" | "EURC"))}`);
    return parts.length ? parts.join(" + ") : "$0.00";
  };
  const singleCur = new Set(positions.map((v) => v.asset)).size === 1;
  const avgApy = singleCur ? (() => { const tot = positions.reduce((t, v) => t + u6(vaults[v.key].assets), 0); return tot > 0 ? positions.reduce((t, v) => t + u6(vaults[v.key].assets) * (apy[v.key] ?? 0), 0) / tot : null; })() : null;

  // ---- Earn: one sortable list (Morpho vaults and Aave side by side), deposit in a panel ----
  const sortedVaults = [...earnVaults].sort((a, b) => (sortDir === "desc" ? 1 : -1) * (sortBy === "apy"
    ? (apy[b.key] ?? -1) - (apy[a.key] ?? -1)
    : u6(vaults[b.key]?.tvl ?? 0n) - u6(vaults[a.key]?.tvl ?? 0n)));
  const openVault = (k: string, action: EarnAction = "deposit") => {
    setVaultKey(k); setEarnAction(action); reset(); setPanelOpen(true);
    try { window.scrollTo({ top: 0 }); } catch { /* fine */ }
  };
  const closePanel = () => { if (step === "sending") return; setPanelOpen(false); reset(); };
  const COLS = "minmax(0, 2.2fr) minmax(0, 1fr) minmax(0, 0.9fr) minmax(0, 0.9fr) 64px";

  // Summary above the vault list: four tinted tiles (deposits, avg APY, est. earnings, best APY now) and a bar showing
  // which vaults hold the user's money in the selected asset. Every number comes from the onchain reads and APYs above.
  const positionsStrip = () => {
    const tileStyle = (bg: string) => ({ display: "flex", alignItems: "center", gap: 12, padding: 12, borderRadius: 14, background: bg, minWidth: 0, textAlign: "left" as const });
    const iconBox = (Icon: typeof Wallet, bg: string) => (
      <span style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 12, background: bg, color: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon size={19} /></span>
    );
    const big = (v: string, color = INK) => <div style={{ fontSize: isMobile ? 16 : 20, fontWeight: 800, color, letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v}</div>;
    const lab = (t: string, color: string) => <div style={{ fontSize: 12, color }}>{t}</div>;
    const bestV = earnVaults.filter((v) => typeof apy[v.key] === "number").sort((x, y) => (apy[y.key] as number) - (apy[x.key] as number))[0];
    const mine = positions.filter((v) => v.asset === earnAsset).map((v) => ({ v, n: u6(vaults[v.key].assets) })).sort((x, y) => y.n - x.n);
    const mineTotal = mine.reduce((t, m) => t + m.n, 0);
    const TONES = ["#2F4DE8", "#5B76F5", "#8EA2FA", "#C3CDFD"];
    const tiles = [
      <div key="dep" style={tileStyle("#EEF1FE")}>{iconBox(Wallet, BLUE)}<div style={{ minWidth: 0 }}>{lab("Your deposits", "#4A4F75")}{big(both(sumOf))}</div></div>,
      ...(singleCur ? [<div key="apy" style={tileStyle("#F2EEFE")}>{iconBox(TrendingUp, "#6D4FE0")}<div style={{ minWidth: 0 }}>{lab("Avg. APY", "#4F4675")}{big(pct(avgApy))}</div></div>] : []),
      <div key="earn" style={tileStyle("#E8F7EF")}>{iconBox(CalendarDays, "#0B7A53")}<div style={{ minWidth: 0 }}>
        {lab("Est. earnings", "#3E6152")}
        {big(`${both(yearlyOf, "+")} /yr`, "#0B7A53")}
        <div style={{ fontSize: 11, color: "#3E6152" }}>{both((a) => yearlyOf(a) / 12, "+")} /month</div>
      </div></div>,
      ...(bestV ? [<button key="best" type="button" onClick={() => openVault(bestV.key)} style={{ ...tileStyle("#FFF4E6"), border: "none", cursor: "pointer", font: "inherit", color: INK }}>
        {avatar(bestV, 40, false)}
        <div style={{ minWidth: 0 }}>
          {lab("Best APY now", "#7A4B12")}
          {big(pct(apy[bestV.key] ?? null), "#9A5A0B")}
          <div style={{ fontSize: 11, color: "#7A4B12", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{bestV.curator} · Deposit ›</div>
        </div>
      </button>] : []),
    ];
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: isMobile ? 12 : 16, borderRadius: 18, background: "#FFFFFF", border: "1px solid #E6EAFB" }}>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${isMobile ? 2 : tiles.length}, minmax(0, 1fr))`, gap: 10 }}>{tiles}</div>
        {mine.length > 0 && mineTotal > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 600, color: MUTED }}>
              <span>Where your {earnAsset} is</span><span>{mine.length} {mine.length === 1 ? "vault" : "vaults"}</span>
            </div>
            <div role="img" aria-label={`Your ${earnAsset} by vault: ` + mine.map((m) => `${m.v.name} ${((m.n / mineTotal) * 100).toFixed(0)}%`).join(", ")}
              style={{ display: "flex", height: 12, borderRadius: 999, overflow: "hidden", gap: 2 }}>
              {mine.map((m, i) => <span key={m.v.key} style={{ flex: m.n, background: TONES[i % TONES.length] }} />)}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px", fontSize: 12.5, color: INK }}>
              {mine.map((m, i) => (
                <span key={m.v.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: TONES[i % TONES.length] }} />
                  {avatar(m.v, 18, false)}
                  <b>{m.v.curator}</b> {cur}{usd(m.n)} <span style={{ color: MUTED }}>{((m.n / mineTotal) * 100).toFixed(0)}%</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  // Exposure: up to 3 collateral logos (Morpho's own asset logos from its API), with the full list on hover/focus.
  const [expOpen, setExpOpen] = useState<string | null>(null);
  const coinDot = (e: ExposureItem, size: number, i: number) => (
    <span key={e.symbol + i} style={{ width: size, height: size, marginLeft: i ? -size * 0.3 : 0, borderRadius: 999, border: "2px solid #FFFFFF", background: "#E6EAFB", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.42, fontWeight: 800, color: BLUE, flexShrink: 0 }}>
      {e.logo ? <img src={e.logo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : e.symbol.slice(0, 1)}
    </span>
  );
  const exposureCell = (v: (typeof VAULTS)[number]) => {
    const ex = details[v.key]?.exposure;
    // Aave V4 is one shared market; its API has no per-collateral breakdown, so say so instead of a blank.
    if (v.kind === "aave") return <span style={{ fontSize: 11.5, fontWeight: 700, color: MUTED, background: "#F1F2F7", padding: "3px 9px", borderRadius: 999, whiteSpace: "nowrap" }}>Shared pool</span>;
    if (!ex) return <span style={{ fontSize: 13, color: "#8A8798" }}>—</span>;
    const exTotal = ex.reduce((t, e) => t + e.usd, 0);
    const shown = ex.slice(0, 3);
    return (
      <span style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 4 }}
        onMouseEnter={() => setExpOpen(v.key)} onMouseLeave={() => setExpOpen(null)}>
        <span style={{ display: "flex" }}>{shown.map((e, i) => coinDot(e, 24, i))}</span>
        {ex.length > 3 && <span style={{ fontSize: 11.5, fontWeight: 700, color: MUTED }}>+{ex.length - 3}</span>}
        {expOpen === v.key && (
          <span role="tooltip" style={{ position: "absolute", zIndex: 20, top: "calc(100% + 8px)", left: -12, width: 260, display: "flex", flexDirection: "column", gap: 10, padding: 12, borderRadius: 14, background: "#FFFFFF", border: `1px solid ${LINE}`, boxShadow: "0 18px 40px -20px rgba(22,21,28,0.35)" }}>
            {ex.map((e, i) => {
              // Share of this vault's exposure, from Morpho's own dollar amounts.
              const share = exTotal > 0 ? (e.usd / exTotal) * 100 : 0;
              return (
                <span key={e.symbol + i} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: INK }}>
                    {coinDot(e, 20, 0)}
                    <span style={{ fontWeight: 700 }}>{e.symbol}</span>
                    {e.idle && <span style={{ fontSize: 10.5, fontWeight: 700, color: MUTED, background: "#EEF1FE", padding: "1px 6px", borderRadius: 999 }}>Idle</span>}
                    <span style={{ marginLeft: "auto", fontWeight: 600 }}>{compact(e.usd)}</span>
                    <span style={{ width: 40, textAlign: "right", color: MUTED }}>{share < 1 && share > 0 ? "<1" : share.toFixed(0)}%</span>
                  </span>
                  <span style={{ height: 5, borderRadius: 999, background: "#EEF1FE", overflow: "hidden" }}>
                    <span style={{ display: "block", width: `${Math.min(100, share)}%`, height: "100%", background: BLUE, borderRadius: 999 }} />
                  </span>
                </span>
              );
            })}
          </span>
        )}
      </span>
    );
  };

  const vaultRow = (v: (typeof VAULTS)[number]) => {
    const mine = vaults[v.key]?.assets ?? 0n;
    const c = v.asset === "EURC" ? "€" : "$";
    const d = details[v.key];
    // "…" until the first onchain read lands, so a vault never flashes as empty.
    const tokenAmt = vaults[v.key] ? `${compact(u6(vaults[v.key].tvl), "")} ${v.asset}` : "…";
    const usdChip = d?.totalAssetsUsd != null ? <span style={{ alignSelf: "flex-start", fontSize: 11, color: MUTED, background: "#EEF1FE", padding: "1px 7px", borderRadius: 6 }}>{compact(d.totalAssetsUsd)}</span> : null;
    const withdrawable = v.kind === "aave" ? "—" : !d ? "…" : d.liquidityUsd != null ? compact(d.liquidityUsd) : "—";
    const apyEl = (
      <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", lineHeight: 1.1 }}>
        <span style={{ fontSize: 17, fontWeight: 800, color: BLUE }}>{apy[v.key] === undefined ? "…" : pct(apy[v.key])}</span>
        <span style={{ fontSize: 10.5, fontWeight: 600, color: "#8A8798" }}>APY</span>
      </span>
    );
    const nameBlock = (
      <span style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        {/* Project logo, with a small badge of the asset it takes (USDC / EURC). */}
        <span style={{ position: "relative", width: 36, height: 36, flexShrink: 0 }}>
          {avatar(v, 36, false)}
          <span style={{ position: "absolute", right: -4, bottom: -4, borderRadius: 999, boxShadow: "0 0 0 2px #FFFFFF", display: "flex" }}><TokenOnChain symbol={v.asset} chain="arc" size={16} /></span>
        </span>
        <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.name}</span>
          <span style={{ fontSize: 11.5, color: MUTED, whiteSpace: "nowrap" }}>{v.kind === "aave" ? "Aave V4 market" : `Morpho vault · ${v.curator}`}</span>
          {mine > 0n && <span style={{ fontSize: 11.5, fontWeight: 700, color: BLUE }}>Your deposit {c}{usd(u6(mine))}</span>}
        </span>
      </span>
    );
    const cellLabel = (t: string) => <span style={{ fontSize: 11, color: MUTED }}>{t}</span>;
    if (isMobile) {
      return (
        <button key={v.key} type="button" onClick={() => openVault(v.key)}
          style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%", padding: 14, borderRadius: 16, border: `1px solid ${LINE}`, background: "rgba(255,255,255,0.92)", cursor: "pointer", textAlign: "left" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 10, width: "100%" }}>{nameBlock}<span style={{ marginLeft: "auto" }}>{apyEl}</span></span>
          <span style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, width: "100%", paddingTop: 10, borderTop: "1px solid #E9EDFB" }}>
            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>{cellLabel("Deposits")}<span style={{ fontSize: 13, fontWeight: 700, color: INK }}>{tokenAmt}</span></span>
            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>{cellLabel("Withdrawable now")}<span style={{ fontSize: 13, fontWeight: 700, color: withdrawable === "—" ? "#8A8798" : INK }}>{withdrawable}</span></span>
            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>{cellLabel("Exposure")}{exposureCell(v)}</span>
          </span>
        </button>
      );
    }
    // The whole row opens the vault: a transparent button covers the row (cells ignore clicks and let them
    // fall through to it); only the exposure cell sits above it, so its hover list still works.
    const passThrough = { pointerEvents: "none" as const };
    return (
      <div key={v.key} className="ff-vault-row" style={{ position: "relative", display: "grid", gridTemplateColumns: COLS, alignItems: "center", gap: 12, padding: 14, borderBottom: "1px solid #E9EDFB" }}>
        <button type="button" onClick={() => openVault(v.key)} aria-label={`Open ${v.name}`}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none", background: "transparent", cursor: "pointer", padding: 0, borderRadius: 12 }} />
        <span style={passThrough}>{nameBlock}</span>
        <span style={{ ...passThrough, display: "flex", flexDirection: "column", gap: 3 }}><span style={{ fontSize: 13.5, fontWeight: 700, color: INK }}>{tokenAmt}</span>{usdChip}</span>
        <span style={{ ...passThrough, fontSize: 13.5, fontWeight: 700, color: withdrawable === "—" ? "#8A8798" : INK }}>{withdrawable}</span>
        <span style={{ position: "relative", zIndex: 1, justifySelf: "start" }}>{exposureCell(v)}</span>
        <span style={{ ...passThrough, textAlign: "right" }}>{apyEl}</span>
      </div>
    );
  };

  // Table headers that sort the list (highest first), Morpho-style; the active one is blue with an arrow.
  const sortHeader = (k: "apy" | "size", text: string, side: "start" | "end") => {
    const on = sortBy === k;
    return (
      <button type="button" onClick={() => { if (on) setSortDir((d) => (d === "desc" ? "asc" : "desc")); else { setSortBy(k); setSortDir("desc"); } }}
        aria-pressed={on} aria-label={`Sort by ${text}, ${on && sortDir === "desc" ? "highest" : "lowest"} first`}
        style={{ justifySelf: side, display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 6px", margin: side === "start" ? "0 0 0 -6px" : "0 -6px 0 0", border: "none", borderRadius: 6, background: on ? "#EEF1FE" : "transparent", color: on ? BLUE : MUTED, fontSize: 12, fontWeight: on ? 700 : 600, cursor: "pointer" }}>
        {text}{on ? (sortDir === "desc" ? <ArrowDown size={12} /> : <ArrowUp size={12} />) : <ArrowUpDown size={12} color="#B5B3BE" />}
      </button>
    );
  };

  const earnList = () => (
    <section style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 21, fontWeight: 800, color: BLUE, letterSpacing: "-0.01em" }}>Earn on</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px 3px 4px", borderRadius: 999, background: "#FFFFFF", border: `1px solid ${LINE}`, fontSize: 14, fontWeight: 700, color: INK }}>
            <img src={ARC_LOGO} alt="" width={22} height={22} style={{ borderRadius: 999 }} />Arc
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div role="radiogroup" aria-label="Asset" style={{ display: "flex", gap: 6 }}>
            {(["USDC", "EURC"] as const).map((a) => {
              const on = a === earnAsset;
              return (
                <button key={a} type="button" role="radio" aria-checked={on}
                  onClick={() => { setEarnAsset(a); setVaultKey(VAULTS.find((v) => v.asset === a)!.key); reset(); }}
                  style={{ display: "flex", alignItems: "center", gap: 7, minHeight: 44, padding: "6px 14px", borderRadius: 999, border: on ? `1.5px solid ${BLUE}` : `1px solid ${LINE}`, background: on ? "#EEF1FE" : "#FFFFFF", cursor: "pointer" }}>
                  <TokenOnChain symbol={a} chain="arc" size={20} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: on ? BLUE : INK }}>{a}</span>
                </button>
              );
            })}
          </div>
          {/* Phones have no table header to sort by, so they keep a small sort switch. */}
          {isMobile && <div style={{ width: 170 }}>{segmented([{ k: "apy", t: "APY" }, { k: "size", t: "Deposits" }], sortBy, (k) => { setSortBy(k); setSortDir("desc"); }, "Sort vaults")}</div>}
          <button type="button" aria-label="Refresh" onClick={() => setTick((t) => t + 1)} style={{ border: `1px solid ${LINE}`, background: "#FFFFFF", color: BLUE, borderRadius: 999, width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><RefreshCw size={14} /></button>
        </div>
      </div>
      {owner && positions.length > 0 && positionsStrip()}
      <h2 style={{ margin: "4px 0 -2px", fontSize: 17, fontWeight: 800, color: INK }}>Vaults</h2>
      {isMobile ? (
        <div role="list" aria-label="Vaults" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {sortedVaults.map((v) => <div role="listitem" key={v.key}>{vaultRow(v)}</div>)}
        </div>
      ) : (
        <div role="table" aria-label="Vaults" style={{ display: "flex", flexDirection: "column" }}>
          <style>{`.ff-vault-row { border-radius: 12px; transition: background 0.15s; } .ff-vault-row:hover { background: #F3F6FF; } .ff-vault-row:has(> button:focus-visible) { outline: 2px solid ${BLUE}; outline-offset: -2px; }`}</style>
          <div role="row" style={{ display: "grid", gridTemplateColumns: COLS, gap: 12, padding: "0 14px 10px", borderBottom: `1px solid ${LINE}`, fontSize: 12, fontWeight: 600, color: MUTED }}>
            <span>Vault</span>
            {sortHeader("size", "Deposits", "start")}
            <span>Withdrawable now</span><span>Exposure</span>
            {sortHeader("apy", "APY", "end")}
          </div>
          {sortedVaults.map((v) => vaultRow(v))}
        </div>
      )}
      <p style={{ margin: 0, fontSize: 11, color: "#8A8798", textAlign: "center" }}>APY is variable and set by each protocol. Numbers refresh every minute. Tap a vault to see details and deposit.</p>
    </section>
  );

  // ---- APY line chart (Earn vault pages and Borrow market pages) ----
  type ChartOpts = { hist: ApyPoint[] | null | "loading" | undefined; rng: ChartRange; ranges: ChartRange[]; title: string; subtitle: string; avgColor: string; missing: string };
  const apyChartCard = ({ hist, rng, ranges, title, subtitle, avgColor, missing }: ChartOpts) => {
    const pts = Array.isArray(hist) ? hist : null;
      const W = 640, H = 200, PX = 8, PT = 14, PB = 10;
      let body: React.ReactNode;
      let avg: number | null = null;
      if (pts) {
        const ys = pts.map((p) => p.apy);
        avg = ys.reduce((a, b) => a + b, 0) / ys.length;
        let lo = Math.min(...ys), hi = Math.max(...ys);
        const pad = (hi - lo) * 0.15 || Math.max(hi * 0.1, 0.001);
        lo = Math.max(0, lo - pad); hi = hi + pad;
        const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
        const X = (t: number) => PX + ((t - t0) / Math.max(1, t1 - t0)) * (W - PX * 2);
        const Y = (y: number) => PT + (1 - (y - lo) / (hi - lo)) * (H - PT - PB);
        const line = pts.map((p, i) => `${i ? "L" : "M"}${X(p.t).toFixed(1)},${Y(p.apy).toFixed(1)}`).join(" ");
        const area = `${line} L${X(t1).toFixed(1)},${H - PB} L${X(t0).toFixed(1)},${H - PB} Z`;
        const hp = hoverIdx !== null && pts[hoverIdx] ? pts[hoverIdx] : null;
        const fmtDate = (t: number) => new Date(t * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" });
        body = (
          <div style={{ position: "relative" }}>
            <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={isMobile ? 150 : 200} preserveAspectRatio="none" role="img" aria-label={`APY over the last ${RANGES[rng].label}`}
              style={{ display: "block", cursor: "crosshair", touchAction: "none" }}
              onPointerMove={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                const tx = t0 + ((e.clientX - r.left) / r.width) * (t1 - t0);
                let best = 0;
                pts.forEach((p, i) => { if (Math.abs(p.t - tx) < Math.abs(pts[best].t - tx)) best = i; });
                setHoverIdx(best);
              }}
              onPointerLeave={() => setHoverIdx(null)}>
              <defs>
                <linearGradient id="apyFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={BLUE} stopOpacity="0.28" />
                  <stop offset="100%" stopColor={BLUE} stopOpacity="0" />
                </linearGradient>
              </defs>
              {[0.25, 0.5, 0.75].map((f) => <line key={f} x1={0} x2={W} y1={PT + f * (H - PT - PB)} y2={PT + f * (H - PT - PB)} stroke={LINE} strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
              <path d={area} fill="url(#apyFill)" />
              <path d={line} fill="none" stroke={BLUE} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              {hp && <line x1={X(hp.t)} x2={X(hp.t)} y1={PT} y2={H - PB} stroke={BLUE} strokeOpacity={0.4} strokeWidth={1} vectorEffect="non-scaling-stroke" />}
            </svg>
            {hp && (
              <div style={{ position: "absolute", top: 0, left: `${(X(hp.t) / W) * 100}%`, transform: `translateX(${X(hp.t) / W > 0.7 ? "-100%" : "8px"})`, pointerEvents: "none", background: INK, color: "#FFFFFF", fontSize: 12, fontWeight: 600, padding: "5px 9px", borderRadius: 8, whiteSpace: "nowrap" }}>
                {fmtDate(hp.t)} · {pct(hp.apy)}
              </div>
            )}
            {hp && <span aria-hidden="true" style={{ position: "absolute", left: `${(X(hp.t) / W) * 100}%`, top: `${(Y(hp.apy) / H) * 100}%`, width: 10, height: 10, marginLeft: -5, marginTop: -5, borderRadius: 999, background: BLUE, border: "2px solid #FFFFFF", pointerEvents: "none" }} />}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: MUTED, marginTop: 6 }}>
              <span>{fmtDate(t0)}</span><span>{fmtDate(t1)}</span>
            </div>
          </div>
        );
      } else {
        body = (
          <div style={{ height: isMobile ? 150 : 200, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: MUTED, borderRadius: 12, background: "#F5F7FF" }}>
            {hist === "loading" || hist === undefined ? "Loading chart…" : missing}
          </div>
        );
      }
      return (
        <section style={{ ...card, gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 17, fontWeight: 800, color: INK }}>{title}</span>
              <span style={{ fontSize: 12.5, color: MUTED }}>{avg !== null ? <>Average over the last {RANGES[rng].label}: <b style={{ color: avgColor }}>{pct(avg)}</b></> : subtitle}</span>
            </div>
            <div role="group" aria-label="Chart range" style={{ display: "flex", gap: 2, padding: 3, borderRadius: 10, background: "#E6EAFB" }}>
              {ranges.map((t) => (
                <button key={t} type="button" aria-pressed={rng === t} onClick={() => { setChartRange(t); setHoverIdx(null); }}
                  style={{ minWidth: 44, minHeight: 32, borderRadius: 8, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 700, background: rng === t ? "#FFFFFF" : "transparent", color: rng === t ? BLUE : MUTED }}>{t}</button>
              ))}
            </div>
          </div>
          {body}
        </section>
      );
  };

  // ---- Earn: one vault's own page (Morpho-style): who runs it, the numbers, how it works, risks, deposit box ----
  const vaultPage = () => {
    const isAave = vault.kind === "aave";
    const d = details[vault.key];
    const apyNow = apy[vaultKey] ?? null;
    const amtNum = Number(amount) || 0;
    const shortAddr = `${vault.address.slice(0, 6)}…${vault.address.slice(-4)}`;
    const about = isAave
      ? `Your ${vault.asset} is supplied to Aave V4's ${vault.asset} market on Arc. Borrowers in the market pay interest, and that interest goes to suppliers like you.`
      : d?.description ?? `Your ${vault.asset} is lent to borrowers who post collateral first. ${vault.curator} curates the vault: it decides which collateral is accepted and how much can be lent against it.`;
    const chip = (content: React.ReactNode) => (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: INK, background: "#FFFFFF", border: `1px solid ${LINE}`, padding: "4px 10px", borderRadius: 999 }}>{content}</span>
    );
    const tile = (k: string, v: string, big = false) => (
      <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "12px 14px", borderRadius: 14, background: "rgba(255,255,255,0.14)" }}>
        <span style={{ fontSize: 12, opacity: 0.85 }}>{k}</span>
        <span style={{ fontSize: big ? 26 : 20, fontWeight: 800, letterSpacing: "-0.01em" }}>{v}</span>
      </div>
    );
    const tiles = [
      tile("Net APY", pct(apyNow), true),
      tile(isAave ? "Market size" : "Total deposits", compact(u6(vs.tvl), cur)),
      ...(!isAave && d?.liquidityUsd != null ? [tile("Withdrawable now", compact(d.liquidityUsd))] : []),
      tile("Your deposit", `${cur}${usd(u6(vs.assets))}`),
    ];
    const howStep = (n: number, title: string, text: string) => (
      <div style={{ display: "flex", gap: 12 }}>
        <span style={{ width: 28, height: 28, flexShrink: 0, borderRadius: 999, background: "#EEF1FE", color: BLUE, fontSize: 13, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{n}</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: INK }}>{title}</span>
          <span style={{ fontSize: 13, color: MUTED, lineHeight: 1.5 }}>{text}</span>
        </div>
      </div>
    );
    const risk = (title: string, text: string) => (
      <li style={{ fontSize: 13, color: MUTED, lineHeight: 1.5 }}><b style={{ color: INK }}>{title}.</b> {text}</li>
    );

    const header = (
      <section style={{ ...card, gap: 14 }}>
        <button type="button" onClick={closePanel} disabled={step === "sending"}
          style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 6, minHeight: 36, padding: "0 12px", borderRadius: 999, border: `1px solid ${LINE}`, background: "#FFFFFF", color: BLUE, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
          <ArrowLeft size={15} />All vaults
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
          {avatar(vault, 56, false)}
          <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: isMobile ? 21 : 26, fontWeight: 800, color: INK, letterSpacing: "-0.02em" }}>{vault.name}</h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {chip(<><TokenOnChain symbol={vault.asset} chain="arc" size={16} />{vault.asset} on Arc</>)}
              {isAave
                ? chip(<><img src="/logos/aave.svg" alt="" width={16} height={9} />Aave V4 market</>)
                : chip(<><span style={{ display: "inline-flex", padding: 3, borderRadius: 999, background: "#2F4DE8" }}><img src="/logos/morpho.svg" alt="" width={10} height={9} /></span>Morpho vault</>)}
              {!isAave && chip(<>Curated by {vault.curator}</>)}
            </div>
          </div>
        </div>
        <p style={{ margin: 0, fontSize: 14, color: MUTED, lineHeight: 1.6 }}>{about}</p>
      </section>
    );

    const stats = (
      <section style={{ ...hero, padding: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${isMobile ? 2 : tiles.length}, minmax(0, 1fr))`, gap: 10 }}>{tiles}</div>
      </section>
    );

    const depositBox = (
      <section style={{ ...card, gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 17, fontWeight: 800, color: BLUE }}>{earnAction === "deposit" ? `Deposit ${vault.asset}` : `Withdraw ${vault.asset}`}</span>
          <button type="button" aria-label="Refresh" onClick={() => setTick((t) => t + 1)} style={{ border: `1px solid ${LINE}`, background: "#FFFFFF", color: BLUE, borderRadius: 999, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><RefreshCw size={13} /></button>
        </div>
        {loadErr && <div style={{ padding: "10px 12px", borderRadius: 10, fontSize: 13, background: "#FDECEC", color: "#B91C1C" }}>{loadErr}</div>}
        {!owner ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center", color: MUTED, fontSize: 13.5 }}>
            Connect a browser wallet to deposit.
            {onConnect && <button type="button" onClick={onConnect} style={{ ...primary(true), maxWidth: 260 }}>Connect wallet</button>}
          </div>
        ) : (<>
          {segmented([{ k: "deposit", t: "Deposit" }, { k: "withdraw", t: "Withdraw" }], earnAction, setEarnAction, "Deposit or withdraw")}
          {!vs.assetOk && <p style={{ margin: 0, fontSize: 12, color: "#B91C1C" }}>This vault didn't pass FlowFi's safety check, so deposits are paused. Withdrawals still work.</p>}
          {withdrawLimited && earnAction === "withdraw" && <p style={{ margin: 0, fontSize: 12, color: "#B45309" }}>The vault's funds are mostly lent out right now, so only part of your deposit can be withdrawn at once.</p>}
          {amountBox()}
          {earnAction === "deposit" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 12, borderRadius: 12, background: "#F5F7FF" }}>
              {row("APY now", pct(apyNow))}
              {row("Est. monthly earnings", apyNow !== null ? `+${cur}${usd((amtNum * apyNow) / 12)}` : "—")}
              {row("Est. yearly earnings", apyNow !== null ? `+${cur}${usd(amtNum * apyNow)}` : "—", true)}
            </div>
          )}
        </>)}
        {!isAave && <div style={{ display: "flex", justifyContent: "center" }}>{createElement("powered-by-morpho", { theme: "light" })}</div>}
        <p style={{ margin: 0, fontSize: 11.5, color: MUTED, textAlign: "center", lineHeight: 1.5 }}>Non-custodial: your funds go from your wallet straight to the {isAave ? "Aave market" : "vault"}. FlowFi never holds them.</p>
      </section>
    );

    const rng = rangeFor(vault.kind, chartRange);
    const chart = apyChartCard({
      hist: history[`${vault.key}-${rng}`], rng, ranges: isAave ? AAVE_RANGES : MORPHO_RANGES,
      title: "APY history", subtitle: isAave ? "Supply APY" : "Net APY, after vault fees", avgColor: "#0B7A53",
      missing: "APY history isn't available for this vault yet.",
    });

    const how = (
      <section style={card}>
        <span style={{ fontSize: 17, fontWeight: 800, color: INK }}>How it works</span>
        {howStep(1, `Deposit ${vault.asset}`, isAave ? `Your ${vault.asset} goes into Aave's market and your balance is tracked onchain.` : `You get vault shares that track your balance. They stay in your wallet.`)}
        {howStep(2, "Earn interest", isAave ? "Borrowers pay interest on what they borrow, and it adds to your balance over time." : "The vault lends to borrowers who post collateral first. The interest they pay grows your balance.")}
        {howStep(3, "Withdraw anytime", "Take your funds back whenever you want, as long as there is enough available liquidity.")}
      </section>
    );

    const facts = (
      <section style={{ ...card, gap: 10 }}>
        <span style={{ fontSize: 17, fontWeight: 800, color: INK }}>Details</span>
        {row("Protocol", isAave ? "Aave V4" : "Morpho")}
        {!isAave && row("Curator", vault.curator)}
        {row("Asset", `${vault.asset} on Arc`)}
        {!isAave && d?.performanceFee != null && row("Performance fee", pct(d.performanceFee))}
        {!isAave && d?.managementFee != null && row("Management fee", pct(d.managementFee))}
        {row("FlowFi fee", "None")}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
          <span style={{ color: MUTED }}>Contract</span>
          <a href={`https://arc.etherscan.io/address/${vault.address}`} target="_blank" rel="noopener noreferrer" style={{ color: BLUE, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none" }}>{shortAddr}<ExternalLink size={13} /></a>
        </div>
      </section>
    );

    const risks = (
      <section style={{ ...card, gap: 8 }}>
        <span style={{ fontSize: 17, fontWeight: 800, color: INK }}>Risks to know</span>
        <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
          {risk("Variable APY", "The rate moves with demand from borrowers. Estimates use today's rate.")}
          {risk("Liquidity", "If most of the funds are lent out, a large withdrawal may have to wait until borrowers repay.")}
          {risk("Borrower risk", "Loans are backed by collateral, but a sharp price drop can still cause losses.")}
          {risk("Smart contracts", `Your funds sit in ${isAave ? "Aave's" : "Morpho's"} smart contracts, which carry technical risk.`)}
        </ul>
      </section>
    );

    return isMobile ? (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>{header}{stats}{depositBox}{chart}{how}{facts}{risks}</div>
    ) : (
      // Deposit box starts at the top of the right column and stays in view (never taller than the screen),
      // so it's visible as soon as the page opens, even on a laptop.
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 380px", gap: 16, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>{header}{stats}{chart}{how}{facts}{risks}</div>
        <div style={{ position: "sticky", top: 16, maxHeight: "calc(100vh - 32px)", overflowY: "auto" }}>{depositBox}</div>
      </div>
    );
  };

  // "Your loans": both cirBTC borrow markets, with collateral, debt, rate and how close each is to liquidation.
  const activeLoans = (Object.keys(MARKETS) as BorrowAsset[]).filter((k) => loans[k] && (loans[k]!.coll > 0n || loans[k]!.debt > 0n));
  const loanLtv = (l: Loan) => { const v = (l.coll * l.price) / ORACLE_SCALE; return v > 0n ? Number(l.debt) / Number(v) : l.debt > 0n ? Infinity : 0; };
  const openMarket = (k: BorrowAsset) => {
    if (k !== borrowAsset) { setBorrowAsset(k); setMkt(null); setPrice(null); setRate(null); setPos({ borrowShares: 0n, collateral: 0n }); }
    const l = loans[k];
    setBorrowAction(l && l.debt > 0n ? "repay" : "collateral"); reset(); setBorrowOpen(true);
    try { window.scrollTo({ top: 0 }); } catch { /* fine */ }
  };
  const pairLogo = (k: BorrowAsset, size: number) => (
    <span style={{ position: "relative", width: size * 1.55, height: size, flexShrink: 0, display: "inline-block" }}>
      <span style={{ position: "absolute", left: 0, top: 0 }}><TokenOnChain symbol="cirBTC" chain="arc" size={size} /></span>
      <span style={{ position: "absolute", left: size * 0.55, top: 0, borderRadius: 999, boxShadow: "0 0 0 2px #FFFFFF" }}><TokenOnChain symbol={k} chain="arc" size={size} /></span>
    </span>
  );
  const BCOLS = "minmax(0, 1.8fr) minmax(0, 1fr) minmax(0, 0.9fr) minmax(0, 1.1fr) 84px";

  // ---- Borrow: market list ----
  const borrowList = () => {
    const totColl = activeLoans.reduce((t, k) => t + loans[k]!.coll, 0n);
    const debtParts = activeLoans.filter((k) => loans[k]!.debt > 0n).map((k) => `${MARKETS[k].cur}${usd(u6(loans[k]!.debt))}`);
    const maxLtv = activeLoans.reduce((t, k) => Math.max(t, loanLtv(loans[k]!)), 0);
    const marketRow = (k: BorrowAsset) => {
      const mk = MARKETS[k]; const sm = mkts[k]; const l = loans[k];
      const lltvPct = `${((Number(mk.params.lltv) / 1e18) * 100).toFixed(0)}%`;
      const apyEl = <span style={{ fontSize: 15, fontWeight: 800, color: INK, textAlign: "right" }}>{sm ? pct(sm.apy) : "…"}</span>;
      const avail = sm ? compact(u6(sm.available), mk.cur) : "…";
      const yours = l && (l.debt > 0n || l.coll > 0n) ? `${mk.cur}${usd(u6(l.debt))} debt` : "—";
      const name = (
        <span style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          {pairLogo(k, 30)}
          <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: INK }}>cirBTC → {k}</span>
            <span style={{ fontSize: 11.5, color: MUTED }}>Collateral cirBTC · Borrow {k}</span>
          </span>
        </span>
      );
      const label = (t: string) => <span style={{ fontSize: 11, color: MUTED }}>{t}</span>;
      if (isMobile) {
        return (
          <button key={k} type="button" onClick={() => openMarket(k)}
            style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%", padding: 14, borderRadius: 16, border: `1px solid ${LINE}`, background: "rgba(255,255,255,0.92)", cursor: "pointer", textAlign: "left" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 10, width: "100%" }}>{name}<span style={{ marginLeft: "auto" }}>{apyEl}</span></span>
            <span style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, width: "100%", paddingTop: 10, borderTop: "1px solid #E9EDFB" }}>
              <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>{label("Available")}<span style={{ fontSize: 13, fontWeight: 700, color: INK }}>{avail}</span></span>
              <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>{label("Liquidation LTV")}<span style={{ fontSize: 13, fontWeight: 700, color: INK }}>{lltvPct}</span></span>
              <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>{label("Your loan")}<span style={{ fontSize: 13, fontWeight: 700, color: yours === "—" ? "#8A8798" : BLUE }}>{yours}</span></span>
            </span>
          </button>
        );
      }
      const pass = { pointerEvents: "none" as const };
      return (
        <div key={k} className="ff-vault-row" style={{ position: "relative", display: "grid", gridTemplateColumns: BCOLS, alignItems: "center", gap: 12, padding: 14, borderBottom: "1px solid #E9EDFB" }}>
          <button type="button" onClick={() => openMarket(k)} aria-label={`Open cirBTC to ${k} market`}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none", background: "transparent", cursor: "pointer", padding: 0, borderRadius: 12 }} />
          <span style={pass}>{name}</span>
          <span style={{ ...pass, fontSize: 13.5, fontWeight: 700, color: INK }}>{avail}</span>
          <span style={{ ...pass, fontSize: 13.5, fontWeight: 700, color: INK }}>{lltvPct}</span>
          <span style={{ ...pass, fontSize: 13.5, fontWeight: 700, color: yours === "—" ? "#8A8798" : BLUE }}>{yours}</span>
          <span style={{ ...pass, textAlign: "right" }}>{apyEl}</span>
        </div>
      );
    };
    const forexRow = () => {
      const apy = forex ? `${((Math.exp(forex.rate) - 1) * 100).toFixed(2)}%` : "…";
      const avail = forex ? compact(forex.available) : "…";
      const ltv = forex ? `${(forex.cf * 100).toFixed(0)}% max LTV` : "…";
      const name = (
        <span style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <TokenOnChain symbol="EURC" chain="arc" size={30} />
          <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: INK, display: "flex", alignItems: "center", gap: 6 }}>EURC → USDC <span style={{ fontSize: 10, fontWeight: 800, color: "#FFFFFF", background: BLUE, borderRadius: 999, padding: "1px 7px" }}>NEW</span></span>
            <span style={{ fontSize: 11.5, color: MUTED, display: "flex", alignItems: "center", gap: 5 }}><img src="/logos/aave.svg" alt="" width={18} height={10} /> Aave Forex · Collateral EURC · Borrow USDC</span>
          </span>
        </span>
      );
      const open = () => { setForexOpen(true); };
      if (isMobile) {
        return (
          <button key="forex" type="button" onClick={open}
            style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%", padding: 14, borderRadius: 16, border: `1px solid ${LINE}`, background: "rgba(255,255,255,0.92)", cursor: "pointer", textAlign: "left" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 10, width: "100%" }}>{name}<span style={{ marginLeft: "auto", fontSize: 15, fontWeight: 800, color: INK }}>{apy}</span></span>
            <span style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, width: "100%", paddingTop: 10, borderTop: "1px solid #E9EDFB", fontSize: 13, fontWeight: 700, color: INK }}>
              <span>{avail}</span><span>{ltv}</span>
            </span>
          </button>
        );
      }
      const pass = { pointerEvents: "none" as const };
      return (
        <div key="forex" className="ff-vault-row" style={{ position: "relative", display: "grid", gridTemplateColumns: BCOLS, alignItems: "center", gap: 12, padding: 14, borderBottom: "1px solid #E9EDFB" }}>
          <button type="button" onClick={open} aria-label="Open EURC to USDC market on Aave"
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none", background: "transparent", cursor: "pointer", padding: 0, borderRadius: 12 }} />
          <span style={pass}>{name}</span>
          <span style={{ ...pass, fontSize: 13.5, fontWeight: 700, color: INK }}>{avail}</span>
          <span style={{ ...pass, fontSize: 13.5, fontWeight: 700, color: INK }}>{forex ? `${(forex.cf * 100).toFixed(0)}%` : "…"}</span>
          <span style={{ ...pass, fontSize: 13.5, fontWeight: 700, color: "#8A8798" }}>—</span>
          <span style={{ ...pass, textAlign: "right", fontSize: 15, fontWeight: 800, color: INK }}>{apy}</span>
        </div>
      );
    };
    return (
      <section style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 21, fontWeight: 800, color: BLUE, letterSpacing: "-0.01em" }}>Borrow on</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px 3px 4px", borderRadius: 999, background: "#FFFFFF", border: `1px solid ${LINE}`, fontSize: 14, fontWeight: 700, color: INK }}>
              <img src={ARC_LOGO} alt="" width={22} height={22} style={{ borderRadius: 999 }} />Arc
            </span>
          </div>
          <button type="button" aria-label="Refresh" onClick={() => setTick((t) => t + 1)} style={{ border: `1px solid ${LINE}`, background: "#FFFFFF", color: BLUE, borderRadius: 999, width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><RefreshCw size={14} /></button>
        </div>
        {owner && activeLoans.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, padding: "12px 16px", borderRadius: 14, background: "linear-gradient(135deg, #2F4DE8 0%, #6C8BFF 100%)", color: "#FFFFFF" }}>
            <div><div style={{ fontSize: 11, opacity: 0.9 }}>Collateral</div><div style={{ fontSize: 15, fontWeight: 800 }}>{b8(totColl).toFixed(6)} cirBTC</div></div>
            <div><div style={{ fontSize: 11, opacity: 0.9 }}>Total debt</div><div style={{ fontSize: 15, fontWeight: 800 }}>{debtParts.length ? debtParts.join(" + ") : "0"}</div></div>
            <div><div style={{ fontSize: 11, opacity: 0.9 }}>Highest LTV</div><div style={{ fontSize: 15, fontWeight: 800 }}>{Number.isFinite(maxLtv) ? `${(maxLtv * 100).toFixed(1)}%` : "—"}</div></div>
          </div>
        )}
        {isMobile ? (
          <div role="list" aria-label="Markets" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {(Object.keys(MARKETS) as BorrowAsset[]).map((k) => <div role="listitem" key={k}>{marketRow(k)}</div>)}
            <div role="listitem">{forexRow()}</div>
          </div>
        ) : (
          <div role="table" aria-label="Markets" style={{ display: "flex", flexDirection: "column" }}>
            <style>{`.ff-vault-row { border-radius: 12px; transition: background 0.15s; } .ff-vault-row:hover { background: #F3F6FF; } .ff-vault-row:has(> button:focus-visible) { outline: 2px solid ${BLUE}; outline-offset: -2px; }`}</style>
            <div role="row" style={{ display: "grid", gridTemplateColumns: BCOLS, gap: 12, padding: "0 14px 10px", borderBottom: `1px solid ${LINE}`, fontSize: 12, fontWeight: 600, color: MUTED }}>
              <span>Market</span><span>Available</span><span>Liquidation LTV</span><span>Your loan</span><span style={{ textAlign: "right" }}>Borrow APY</span>
            </div>
            {(Object.keys(MARKETS) as BorrowAsset[]).map((k) => marketRow(k))}
            {forexRow()}
          </div>
        )}
        <p style={{ margin: 0, fontSize: 11, color: "#8A8798", textAlign: "center" }}>Borrow rates are variable. FlowFi keeps you under a 70% safe limit. Tap a market to borrow or manage a loan.</p>
      </section>
    );
  };

  // ---- Borrow: one market's page. Same actions and checks as before; only the layout is new. ----
  const marketPage = () => {
    const k = borrowAsset;
    const lltvPct = `${((Number(M.params.lltv) / 1e18) * 100).toFixed(0)}%`;
    const tile = (t: string, v: string, big = false) => (
      <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "12px 14px", borderRadius: 14, background: "rgba(255,255,255,0.14)" }}>
        <span style={{ fontSize: 12, opacity: 0.85 }}>{t}</span>
        <span style={{ fontSize: big ? 26 : 20, fontWeight: 800, letterSpacing: "-0.01em" }}>{v}</span>
      </div>
    );
    const tiles = [
      tile("Borrow APY", pct(borrowApy), true),
      tile("Available", compact(u6(available), lc)),
      tile("BTC (oracle)", btcPrice !== null ? `${lc}${usd(btcPrice, 0)}` : "—"),
      tile("Your debt", `${lc}${usd(u6(debt))}`),
    ];
    const chip = (content: React.ReactNode) => (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: INK, background: "#FFFFFF", border: `1px solid ${LINE}`, padding: "4px 10px", borderRadius: 999 }}>{content}</span>
    );
    const header = (
      <section style={{ ...card, gap: 14 }}>
        <button type="button" onClick={() => { if (step !== "sending") { setBorrowOpen(false); reset(); } }} disabled={step === "sending"}
          style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 6, minHeight: 36, padding: "0 12px", borderRadius: 999, border: `1px solid ${LINE}`, background: "#FFFFFF", color: BLUE, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
          <ArrowLeft size={15} />All markets
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
          {pairLogo(k, 44)}
          <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: isMobile ? 21 : 26, fontWeight: 800, color: INK, letterSpacing: "-0.02em" }}>cirBTC → {k}</h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {chip(<><span style={{ display: "inline-flex", padding: 3, borderRadius: 999, background: "#2F4DE8" }}><img src="/logos/morpho.svg" alt="" width={10} height={9} /></span>Morpho market</>)}
              {chip(<><TokenOnChain symbol="cirBTC" chain="arc" size={16} />Collateral cirBTC</>)}
              {chip(<><TokenOnChain symbol={k} chain="arc" size={16} />Borrow {k}</>)}
            </div>
          </div>
        </div>
        <p style={{ margin: 0, fontSize: 14, color: MUTED, lineHeight: 1.6 }}>Put up cirBTC as collateral and borrow {k} against it, without selling your bitcoin. The rate is variable and set by the market.</p>
      </section>
    );
    const stats = (
      <section style={{ ...hero, padding: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${isMobile ? 2 : 4}, minmax(0, 1fr))`, gap: 10 }}>{tiles}</div>
      </section>
    );
    const position = owner ? (
      <section style={card}>
        {sectionTitle(Landmark, "Your position")}
        {row("Collateral", `${b8(pos.collateral).toFixed(8)} cirBTC (${lc}${usd(u6(collValueOf(pos.collateral)))})`)}
        {row("Debt", `${usd(u6(debt))} ${loanSym}`, true)}
        {row("Liquidation price", liqPriceOf(pos.collateral, debt) !== null ? `${lc}${usd(liqPriceOf(pos.collateral, debt)!, 0)} per BTC` : "—")}
        {ltvBar(ltv, amt > 0n ? newLtv : null)}
      </section>
    ) : null;
    const actionBox = (
      <section style={{ ...card, gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 17, fontWeight: 800, color: BLUE }}>Manage loan</span>
          <button type="button" aria-label="Refresh" onClick={() => setTick((t) => t + 1)} style={{ border: `1px solid ${LINE}`, background: "#FFFFFF", color: BLUE, borderRadius: 999, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><RefreshCw size={13} /></button>
        </div>
        {loadErr && <div style={{ padding: "10px 12px", borderRadius: 10, fontSize: 13, background: "#FDECEC", color: "#B91C1C" }}>{loadErr}</div>}
        {!owner ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center", color: MUTED, fontSize: 13.5 }}>
            Connect a browser wallet to borrow.
            {onConnect && <button type="button" onClick={onConnect} style={{ ...primary(true), maxWidth: 260 }}>Connect wallet</button>}
          </div>
        ) : (<>
          {segmented([{ k: "collateral", t: "Add collateral" }, { k: "borrow", t: "Borrow" }, { k: "repay", t: "Repay" }, { k: "withdraw", t: "Withdraw" }], borrowAction, setBorrowAction, "Borrow action")}
          {amt > 0n && (borrowAction === "borrow" || borrowAction === "withdraw") && liqPriceOf(newColl, newDebt) !== null && (
            <p style={{ margin: 0, fontSize: 12, color: MUTED }}>After this, you get liquidated if BTC falls to {lc}{usd(liqPriceOf(newColl, newDebt)!, 0)}.</p>
          )}
          {amountBox()}
          <p style={{ margin: 0, fontSize: 11.5, color: MUTED }}>Market utilization {(utilization * 100).toFixed(1)}%. Borrow rate is variable and rises when the market is nearly fully borrowed.</p>
        </>)}
        <div style={{ display: "flex", justifyContent: "center" }}>{createElement("powered-by-morpho", { theme: "light" })}</div>
        <p style={{ margin: 0, fontSize: 11.5, color: MUTED, textAlign: "center", lineHeight: 1.5 }}>Non-custodial: your collateral goes from your wallet straight to the Morpho market. FlowFi never holds it.</p>
      </section>
    );
    const rng = rangeFor("morpho", chartRange);
    const chart = apyChartCard({
      hist: history[`borrow-${k}-${rng}`], rng, ranges: MORPHO_RANGES,
      title: "Borrow APY history", subtitle: "Variable borrow rate", avgColor: BLUE,
      missing: "Borrow rate history isn't available for this market yet.",
    });
    const step3 = (n: number, title: string, text: string) => (
      <div style={{ display: "flex", gap: 12 }}>
        <span style={{ width: 28, height: 28, flexShrink: 0, borderRadius: 999, background: "#EEF1FE", color: BLUE, fontSize: 13, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{n}</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: INK }}>{title}</span>
          <span style={{ fontSize: 13, color: MUTED, lineHeight: 1.5 }}>{text}</span>
        </div>
      </div>
    );
    const how = (
      <section style={card}>
        <span style={{ fontSize: 17, fontWeight: 800, color: INK }}>How it works</span>
        {step3(1, "Add cirBTC as collateral", "Your cirBTC goes into the Morpho market and stays yours. It backs your loan.")}
        {step3(2, `Borrow ${k}`, `Borrow up to FlowFi's 70% safe limit. The market liquidates at ${lltvPct} loan-to-value.`)}
        {step3(3, "Repay anytime", "Repay part or all of the loan whenever you want, then withdraw your collateral.")}
      </section>
    );
    const facts = (
      <section style={{ ...card, gap: 10 }}>
        <span style={{ fontSize: 17, fontWeight: 800, color: INK }}>Details</span>
        {row("Protocol", "Morpho")}
        {row("Collateral", "cirBTC on Arc")}
        {row("Loan asset", `${k} on Arc`)}
        {row("Liquidation LTV", lltvPct)}
        {row("FlowFi safe limit", "70%")}
        {row("Utilization", `${(utilization * 100).toFixed(1)}%`)}
        {row("FlowFi fee", "None")}
      </section>
    );
    const risks = (
      <section style={{ ...card, gap: 8 }}>
        <span style={{ fontSize: 17, fontWeight: 800, color: INK }}>Risks to know</span>
        <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
          {[["Liquidation", `If BTC falls and your loan reaches ${lltvPct} of your collateral's value, part of your cirBTC is sold to repay it.`],
            ["Variable rate", "The borrow rate moves with demand and rises sharply when the market is nearly fully borrowed."],
            ["Price feed", "Your loan's health is measured with the market's BTC price oracle, which can differ briefly from exchange prices."],
            ["Smart contracts", "Your collateral sits in Morpho's smart contracts, which carry technical risk."]].map(([t, x]) => (
            <li key={t} style={{ fontSize: 13, color: MUTED, lineHeight: 1.5 }}><b style={{ color: INK }}>{t}.</b> {x}</li>
          ))}
        </ul>
      </section>
    );
    return isMobile ? (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>{header}{stats}{actionBox}{position}{chart}{how}{facts}{risks}</div>
    ) : (
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 380px", gap: 16, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>{header}{stats}{position}{chart}{how}{facts}{risks}</div>
        <div style={{ position: "sticky", top: 16, maxHeight: "calc(100vh - 32px)", overflowY: "auto" }}>{actionBox}</div>
      </div>
    );
  };

  return (
    // Earn: one wide column (the vault list). Borrow: form (up to 520px) and "Your loans" card (340px) side by side,
    // the card wrapping below when the page is too narrow for both.
    <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", flexWrap: "wrap", gap: 20, alignItems: "flex-start", justifyContent: "center", width: "100%", maxWidth: 1040, margin: "0 auto" }}>
    <div style={{ display: "flex", flexDirection: "column", gap: 14, flex: "1 1 460px", maxWidth: 1040, width: "100%", minWidth: 0 }}>
      {segmented([{ k: "earn", t: "Earn" }, { k: "borrow", t: "Borrow" }], mode, setMode, "Earn or borrow")}

      {isEarn && !panelOpen && aaveBanner && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", borderRadius: 14, background: "#FFFFFF", border: `1px solid ${LINE}`, fontSize: 13, color: INK, boxShadow: "0 10px 30px -22px rgba(61,90,241,0.6)" }}>
          <img src="/logos/aave.svg" alt="" width={24} height={13} style={{ flexShrink: 0 }} />
          <span style={{ cursor: "pointer" }} onClick={() => { const a = VAULTS.find((v) => v.kind === "aave"); if (a) { setEarnAsset(a.asset); openVault(a.key); } }}>
            <b style={{ color: BLUE }}>New:</b> Aave V4 is now live on FlowFi. Earn on your USDC with Aave.
          </span>
          <button type="button" aria-label="Close" onClick={closeAaveBanner} style={{ marginLeft: "auto", border: "none", background: "none", color: "#8A8798", cursor: "pointer", display: "flex", padding: 2 }}><X size={16} /></button>
        </div>
      )}

      {isEarn ? (panelOpen ? vaultPage() : earnList()) : forexOpen ? <AaveForexBorrow owner={owner} provider={provider} onBack={() => { setForexOpen(false); setTick((t) => t + 1); }} /> : (borrowOpen ? marketPage() : borrowList())}



      {((!isEarn && !borrowOpen && !forexOpen) || (isEarn && !panelOpen && earnVaults.some((v) => v.kind === "morpho"))) && <div style={{ display: "flex", justifyContent: "center" }}>{createElement("powered-by-morpho", { theme: "light" })}</div>}

      {!(isEarn && panelOpen) && !(!isEarn && (borrowOpen || forexOpen)) && (
        <p style={{ margin: 0, fontSize: 11.5, color: MUTED, textAlign: "center", lineHeight: 1.5 }}>
          Non-custodial: your funds stay under your control, FlowFi never holds them.
          Borrowing carries liquidation risk if your collateral's price falls.
        </p>
      )}

      {showAck && (
        <div role="dialog" aria-modal="true" aria-labelledby="morpho-ack-title" onClick={() => setShowAck(false)}
          style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(22,21,28,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...card, background: "#FFFFFF", maxWidth: 440, width: "100%", gap: 14 }}>
            <span id="morpho-ack-title" style={{ fontSize: 17, fontWeight: 700, color: INK }}>Before you use Morpho</span>
            <p style={{ margin: 0, fontSize: 13.5, color: INK, lineHeight: 1.55 }}>
              Accessing the Morpho Protocol through this app is governed by FlowFi's{" "}
              <a href={TERMS_URL} target="_blank" rel="noopener noreferrer" style={{ color: BLUE, fontWeight: 600 }}>Terms of Use</a> and{" "}
              <a href={MORPHO_DISCLAIMER_URL} target="_blank" rel="noopener noreferrer" style={{ color: BLUE, fontWeight: 600 }}>Morpho's Disclaimer</a>.
              By using it, you acknowledge that you have read and understood these terms and the risks involved.
            </p>
            <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13, color: INK, cursor: "pointer" }}>
              <input type="checkbox" checked={ackChecked} onChange={(e) => setAckChecked(e.target.checked)} style={{ marginTop: 2, width: 16, height: 16, accentColor: BLUE }} />
              I have read and understood these terms and the risks involved.
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={() => setShowAck(false)} style={{ flex: 1, height: 44, borderRadius: 12, border: `1px solid ${LINE}`, background: "#FFFFFF", color: INK, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
              <button type="button" onClick={acceptAck} disabled={!ackChecked} style={{ ...primary(ackChecked), flex: 1, height: 44 }}>Accept and continue</button>
            </div>
          </div>
        </div>
      )}
    </div>
    </div>
  );

  function amountBox() {
    return (<>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <label htmlFor="morpho-amount" style={label}>{walletLine}</label>
        <button type="button" onClick={setMax} disabled={step === "sending"} style={{ border: "none", background: "#E3E8FD", color: BLUE, fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999, cursor: "pointer" }}>MAX</button>
      </div>
      <div style={{ position: "relative" }}>
        <input id="morpho-amount" inputMode="decimal" value={amount} placeholder="0.00" disabled={step === "sending"} style={{ ...input, paddingRight: 110 }}
          onChange={(e) => { if (/^\d*\.?\d*$/.test(e.target.value)) { setAmount(e.target.value); if (step !== "sending") { setStep("idle"); setMsg(null); } } }} />
        <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: INK }}>
          <TokenOnChain symbol={tokenSymbol} chain="arc" size={20} />{tokenSymbol}
        </span>
      </div>
      {msg && step !== "idle" && (
        <div style={{ padding: "10px 12px", borderRadius: 10, fontSize: 13, background: step === "done" ? "#E7F7EF" : step === "error" ? "#FDECEC" : "#F5F7FF", color: step === "done" ? "#0B7A53" : step === "error" ? "#B91C1C" : INK }}>
          {msg}{" "}
          {hash && <a href={`https://arc.etherscan.io/tx/${hash}`} target="_blank" rel="noopener noreferrer" style={{ color: BLUE, fontWeight: 600 }}>View tx ↗</a>}
        </div>
      )}
      <button type="button" onClick={start} disabled={!can} style={primary(can)}>{btn}</button>
    </>);
  }
}
