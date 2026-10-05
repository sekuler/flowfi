import { useState, useEffect } from "react";
import { createPublicClient, http, formatUnits } from "viem";
import { arcMainnet } from "../chains";
import { VAULTS, MARKETS, MORPHO_BLUE, MORPHO_ABI, VAULT_ABI, toAssetsUp, AAVE_SPOKE_ABI, AAVE_USDC_RESERVE_ID } from "./morpho";

export interface MainnetBalances {
  usdc: string | null;
  eurc?: string | null;
  usyc?: string | null;
  cirbtc?: string | null;
  native?: string | null;
}

export type Snap = { date: string; value: number };

// Fixed en-US formatting so numbers read the same ("2.92", "1,234.56") whatever language the browser is set to.
export function money(n: number, digits = 2) {
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// Money the user has outside the wallet itself: Morpho Earn vaults, Morpho borrow positions
// (cirBTC collateral and the loan against it) and the Circle Gateway USDC balance. Without these,
// depositing into Earn or Gateway made net worth look like it dropped.
type Positions = { earnUsd: number; earnEur: number; collBtc: number; debtUsd: number; debtEur: number; gatewayUsd: number };
const NO_POSITIONS: Positions = { earnUsd: 0, earnEur: 0, collBtc: 0, debtUsd: 0, debtEur: 0, gatewayUsd: 0 };
const GATEWAY_DOMAINS = [26, 6, 0, 3]; // Arc, Base, Ethereum, Arbitrum

async function loadPositions(owner: `0x${string}`): Promise<Positions> {
  const pc = createPublicClient({ chain: arcMainnet, transport: http() });
  const p = { ...NO_POSITIONS };
  await Promise.all([
    ...VAULTS.map(async (v) => {
      if (v.kind === "aave") {
        const assets = await pc.readContract({ address: v.address, abi: AAVE_SPOKE_ABI, functionName: "getUserSuppliedAssets", args: [AAVE_USDC_RESERVE_ID, owner] });
        p.earnUsd += Number(formatUnits(assets, 6));
        return;
      }
      const shares = await pc.readContract({ address: v.address, abi: VAULT_ABI, functionName: "balanceOf", args: [owner] });
      if (shares === 0n) return;
      const assets = await pc.readContract({ address: v.address, abi: VAULT_ABI, functionName: "convertToAssets", args: [shares] });
      const n = Number(formatUnits(assets, 6));
      if (v.asset === "EURC") p.earnEur += n; else p.earnUsd += n;
    }).map((x) => x.catch(() => {})),
    ...(Object.keys(MARKETS) as (keyof typeof MARKETS)[]).map(async (k) => {
      const m = MARKETS[k];
      const pos = await pc.readContract({ address: MORPHO_BLUE, abi: MORPHO_ABI, functionName: "position", args: [m.id, owner] });
      p.collBtc += Number(formatUnits(pos[2], 8));
      if (pos[1] === 0n) return;
      const mk = await pc.readContract({ address: MORPHO_BLUE, abi: MORPHO_ABI, functionName: "market", args: [m.id] });
      const debt = Number(formatUnits(toAssetsUp(pos[1], mk[2], mk[3]), 6));
      if (k === "EURC") p.debtEur += debt; else p.debtUsd += debt;
    }).map((x) => x.catch(() => {})),
    (async () => {
      const r = await fetch("https://gateway-api.circle.com/v1/balances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "USDC", sources: GATEWAY_DOMAINS.map((domain) => ({ domain, depositor: owner })) }),
      });
      if (!r.ok) return;
      const d = await r.json();
      for (const b of d?.balances ?? []) p.gatewayUsd += Number(b.balance) || 0;
    })().catch(() => {}),
  ]);
  return p;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

// Shared by Home and Dashboard so both pages always show the same net worth, chart and 7-day change.
export function usePortfolio(address: string, balances: MainnetBalances) {
  const [series, setSeries] = useState<Snap[]>([]);
  const [prices, setPrices] = useState<{ btc: number | null; eur: number | null; usyc: number | null }>({ btc: null, eur: null, usyc: null });

  useEffect(() => {
    fetch("/api/coingecko-proxy?path=" + encodeURIComponent("/simple/price?ids=bitcoin,euro-coin,hashnote-usyc&vs_currencies=usd"))
      .then((r) => r.json())
      .then((d) => setPrices({ btc: d?.bitcoin?.usd ?? null, eur: d?.["euro-coin"]?.usd ?? null, usyc: d?.["hashnote-usyc"]?.usd ?? null }))
      .catch(() => setPrices({ btc: null, eur: null, usyc: null }));
  }, []);

  // Earn / borrow / Gateway positions, reloaded whenever the wallet balances refresh.
  const [pos, setPos] = useState<Positions>(NO_POSITIONS);
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    loadPositions(address as `0x${string}`).then((p) => { if (!cancelled) setPos(p); });
    return () => { cancelled = true; };
  }, [address, balances.usdc]);

  const usdcVal = Number(balances.usdc ?? 0);
  const eurcAmt = Number(balances.eurc ?? 0);
  // EURC is priced in dollars from the live EUR rate; if the rate is unavailable it is left out of the dollar total
  // rather than guessed at 1:1.
  const eurcVal = prices.eur !== null ? eurcAmt * prices.eur : 0;
  const usycAmt = Number(balances.usyc ?? 0);
  // USYC is a money-market fund share worth more than $1, so it is priced from its live rate too (left out if unavailable).
  const usycVal = prices.usyc !== null ? usycAmt * prices.usyc : 0;
  const cirbtcAmt = Number(balances.cirbtc ?? 0);
  const cirbtcVal = prices.btc !== null ? cirbtcAmt * prices.btc : 0;
  // Arc's native (gas) balance and the ERC-20 USDC balance are the SAME
  // underlying USDC shown two ways, not separate money -- confirmed live
  // (both read 5.11 for the same address). Only usdcVal (ERC-20) counts
  // toward net worth; balances.native is kept around for display only.
  const earnVal = pos.earnUsd + (prices.eur !== null ? pos.earnEur * prices.eur : 0);
  const collVal = prices.btc !== null ? pos.collBtc * prices.btc : 0;
  const gatewayVal = pos.gatewayUsd;
  const debtVal = pos.debtUsd + (prices.eur !== null ? pos.debtEur * prices.eur : 0);
  // gross = everything owned; total (net worth) = gross minus what's borrowed on Morpho.
  const gross = usdcVal + eurcVal + usycVal + cirbtcVal + earnVal + collVal + gatewayVal;
  const total = gross - debtVal;

  // Daily snapshots of net worth, recorded in this browser (there is no historical balance API).
  const seriesKey = `flowfi-portfolio-series-mainnet-${address}`;
  useEffect(() => {
    if (!address) return;
    let saved: Snap[] = [];
    try {
      const parsed = JSON.parse(localStorage.getItem(seriesKey) ?? "[]");
      if (Array.isArray(parsed)) saved = parsed.filter((p) => p && typeof p.date === "string" && typeof p.value === "number");
    } catch { /* ignore */ }
    if (total > 0) {
      const today = todayKey();
      const last = saved[saved.length - 1];
      if (last && last.date === today) last.value = total;
      else saved.push({ date: today, value: total });
      saved = saved.slice(-60);
      try { localStorage.setItem(seriesKey, JSON.stringify(saved)); } catch { /* ignore */ }
    }
    setSeries(saved);
  }, [address, total]);

  const chartPoints = series.slice(-30).map((p) => p.value);
  const hasChart = chartPoints.length >= 2;
  // "7-day change" compares against the newest snapshot that is at least 7 days old. It is a balance
  // change, so deposits and withdrawals count too, not only price movement.
  // Day granularity, so computing it once when the hook mounts is enough.
  const [cutoff] = useState(() => new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10));
  const ref = [...series].reverse().find((p) => p.date <= cutoff);
  const change = ref && ref.value > 0 && total > 0 ? { abs: total - ref.value, pct: ((total - ref.value) / ref.value) * 100 } : null;

  const distribution = [
    { label: "USDC", value: usdcVal, color: "#3B82F6", amount: balances.usdc ?? "0" },
    { label: "EURC", value: eurcVal, color: "#22C55E", amount: balances.eurc ?? "0" },
    { label: "USYC", value: usycVal, color: "#F59E0B", amount: balances.usyc ?? "0" },
    { label: "cirBTC", value: cirbtcVal, color: "#C2410C", amount: balances.cirbtc ?? "0" },
    { label: "Earn", value: earnVal, color: "#6366F1", amount: "" },
    { label: "cirBTC collateral", value: collVal, color: "#9A3412", amount: "" },
    { label: "Gateway", value: gatewayVal, color: "#0EA5E9", amount: "" },
  ].filter((d) => d.value > 0 || d.label === "cirBTC").sort((a, b) => b.value - a.value); // cirBTC is always listed, even at 0
  const top = distribution[0];
  const topPct = top && gross > 0 ? (top.value / gross) * 100 : 0;

  // Everything the wallet holds, including tokens whose dollar value isn't known right now (value = null).
  const holdings = [
    { label: "USDC", amount: balances.usdc ?? "0", n: usdcVal, value: usdcVal as number | null, color: "#3B82F6" },
    { label: "EURC", amount: balances.eurc ?? "0", n: eurcAmt, value: (prices.eur !== null ? eurcVal : null) as number | null, color: "#22C55E" },
    { label: "USYC", amount: balances.usyc ?? "0", n: usycAmt, value: (prices.usyc !== null ? usycVal : null) as number | null, color: "#F59E0B" },
    { label: "cirBTC", amount: balances.cirbtc ?? "0", n: cirbtcAmt, value: (prices.btc !== null ? cirbtcVal : null) as number | null, color: "#C2410C" },
  ].filter((h) => h.n > 0 || h.label === "cirBTC").sort((a, b) => (b.value ?? 0) - (a.value ?? 0)); // cirBTC is always listed, even at 0

  return { total, gross, debt: debtVal, cirbtcAmt, eurcAmt, holdings, distribution, top, topPct, chartPoints, hasChart, change };
}
