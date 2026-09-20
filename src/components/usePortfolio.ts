import { useState, useEffect } from "react";

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

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

// Shared by Home and Dashboard so both pages always show the same net worth, chart and 7-day change.
export function usePortfolio(address: string, balances: MainnetBalances) {
  const [series, setSeries] = useState<Snap[]>([]);
  const [prices, setPrices] = useState<{ btc: number | null; eur: number | null }>({ btc: null, eur: null });

  useEffect(() => {
    fetch("/api/coingecko-proxy?path=" + encodeURIComponent("/simple/price?ids=bitcoin,euro-coin&vs_currencies=usd"))
      .then((r) => r.json())
      .then((d) => setPrices({ btc: d?.bitcoin?.usd ?? null, eur: d?.["euro-coin"]?.usd ?? null }))
      .catch(() => setPrices({ btc: null, eur: null }));
  }, []);

  const usdcVal = Number(balances.usdc ?? 0);
  const eurcAmt = Number(balances.eurc ?? 0);
  // EURC is priced in dollars from the live EUR rate; if the rate is unavailable it is left out of the dollar total
  // rather than guessed at 1:1.
  const eurcVal = prices.eur !== null ? eurcAmt * prices.eur : 0;
  const usycVal = Number(balances.usyc ?? 0);
  const cirbtcAmt = Number(balances.cirbtc ?? 0);
  const cirbtcVal = prices.btc !== null ? cirbtcAmt * prices.btc : 0;
  // Arc's native (gas) balance and the ERC-20 USDC balance are the SAME
  // underlying USDC shown two ways, not separate money -- confirmed live
  // (both read 5.11 for the same address). Only usdcVal (ERC-20) counts
  // toward net worth; balances.native is kept around for display only.
  const total = usdcVal + eurcVal + usycVal + cirbtcVal;

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
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const ref = [...series].reverse().find((p) => p.date <= cutoff);
  const change = ref && ref.value > 0 && total > 0 ? { abs: total - ref.value, pct: ((total - ref.value) / ref.value) * 100 } : null;

  const distribution = [
    { label: "USDC", value: usdcVal, color: "#3B82F6", amount: balances.usdc ?? "0" },
    { label: "EURC", value: eurcVal, color: "#22C55E", amount: balances.eurc ?? "0" },
    { label: "USYC", value: usycVal, color: "#F59E0B", amount: balances.usyc ?? "0" },
    { label: "cirBTC", value: cirbtcVal, color: "#C2410C", amount: balances.cirbtc ?? "0" },
  ].filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
  const top = distribution[0];
  const topPct = top && total > 0 ? (top.value / total) * 100 : 0;

  // Everything the wallet holds, including tokens whose dollar value isn't known right now (value = null).
  const holdings = [
    { label: "USDC", amount: balances.usdc ?? "0", n: usdcVal, value: usdcVal as number | null, color: "#3B82F6" },
    { label: "EURC", amount: balances.eurc ?? "0", n: eurcAmt, value: (prices.eur !== null ? eurcVal : null) as number | null, color: "#22C55E" },
    { label: "USYC", amount: balances.usyc ?? "0", n: usycVal, value: usycVal as number | null, color: "#F59E0B" },
    { label: "cirBTC", amount: balances.cirbtc ?? "0", n: cirbtcAmt, value: (prices.btc !== null ? cirbtcVal : null) as number | null, color: "#C2410C" },
  ].filter((h) => h.n > 0).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  return { total, cirbtcAmt, eurcAmt, holdings, distribution, top, topPct, chartPoints, hasChart, change };
}
