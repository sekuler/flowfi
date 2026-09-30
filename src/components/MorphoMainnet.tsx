import { useState, useEffect, createElement } from "react";
import { createPublicClient, createWalletClient, custom, http, erc20Abi, formatUnits, parseUnits } from "viem";
import type { EIP1193Provider } from "viem";
import { PiggyBank, Landmark, RefreshCw } from "lucide-react";
import { arcMainnet, ARC_MAINNET_CHAIN_ID_HEX } from "../chains";
import { TokenOnChain } from "./AssetLogos";
import {
  MORPHO_BLUE, MARKETS, type BorrowAsset, USDC, CIRBTC, EURC, VAULTS, type EarnAsset, USDC_DECIMALS, CIRBTC_DECIMALS,
  WAD, ORACLE_SCALE, SAFE_LTV_PCT, MORPHO_ABI, IRM_ABI, ORACLE_ABI, VAULT_ABI, toAssetsUp, fetchVaultApy,
} from "./morpho";

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

type Mkt = { totalSupplyAssets: bigint; totalSupplyShares: bigint; totalBorrowAssets: bigint; totalBorrowShares: bigint; lastUpdate: bigint; fee: bigint };
// assetOk: the vault's onchain asset() matches the token FlowFi thinks it is (checked on every load).
type VaultState = { tvl: bigint; shares: bigint; assets: bigint; maxW: bigint; assetOk: boolean };
type EarnAction = "deposit" | "withdraw";
type BorrowAction = "collateral" | "borrow" | "repay" | "withdraw";

const usd = (n: number, d = 2) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const compact = (n: number, cur = "$") => n >= 1e6 ? `${cur}${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${cur}${(n / 1e3).toFixed(1)}K` : `${cur}${usd(n)}`;
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

  useEffect(() => {
    VAULTS.forEach((v) => { fetchVaultApy(v.address).then((a) => setApy((s) => ({ ...s, [v.key]: a }))); });
  }, []);

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
  const liqPriceOf = (c: bigint, d: bigint) => (c > 0n && d > 0n ? u6(d) / (b8(c) * 0.86) : null);

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
    if (acked) { run(); return; }
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

      if (isEarn) {
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
  const stat = (k: string, v: string) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 11.5, opacity: 0.8 }}>{k}</span>
      <span style={{ fontSize: 17, fontWeight: 700 }}>{v}</span>
    </div>
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 520, margin: "0 auto" }}>
      {segmented([{ k: "earn", t: "Earn" }, { k: "borrow", t: "Borrow" }], mode, setMode, "Earn or borrow")}

      {/* Hero: market numbers for the chosen side */}
      <section style={hero}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <span style={{ fontSize: 13, fontWeight: 600, opacity: 0.9 }}>{isEarn ? vault.name : `cirBTC / ${loanSym} market`} · Morpho</span>
          <button type="button" aria-label="Refresh" onClick={() => setTick((t) => t + 1)} style={{ border: "none", background: "rgba(255,255,255,0.18)", color: "#FFFFFF", borderRadius: 999, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><RefreshCw size={14} /></button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
          {isEarn ? (<>
            {stat("Net APY", pct(apy[vaultKey] ?? null))}
            {stat("Vault size", compact(u6(vs.tvl), cur))}
            {stat("Your deposit", `${cur}${usd(u6(vs.assets))}`)}
          </>) : (<>
            {stat("Borrow APY", pct(borrowApy))}
            {stat("Available", compact(u6(available), lc))}
            {stat("BTC (oracle)", btcPrice !== null ? `${lc}${usd(btcPrice, 0)}` : "—")}
          </>)}
        </div>
      </section>

      {loadErr && <div style={{ padding: "10px 12px", borderRadius: 10, fontSize: 13, background: "#FDECEC", color: "#B91C1C" }}>{loadErr}</div>}

      {!owner ? (
        <div style={{ ...card, alignItems: "center", textAlign: "center", color: MUTED, fontSize: 13.5 }}>
          Connect a browser wallet to {isEarn ? "earn on your USDC or EURC" : "borrow USDC or EURC against cirBTC"}.
          {onConnect && <button type="button" onClick={onConnect} style={{ ...primary(true), maxWidth: 260 }}>Connect wallet</button>}
        </div>
      ) : isEarn ? (
        <section style={card}>
          {sectionTitle(PiggyBank, `Earn on ${earnAsset}`)}
          <span style={label}>Asset</span>
          <div role="radiogroup" aria-label="Asset" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
            {(["USDC", "EURC"] as const).map((a) => {
              const on = a === earnAsset;
              return (
                <button key={a} type="button" role="radio" aria-checked={on} disabled={step === "sending"}
                  onClick={() => { setEarnAsset(a); setVaultKey(VAULTS.find((v) => v.asset === a)!.key); reset(); }}
                  style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 48, padding: "6px 12px", borderRadius: 12, border: on ? `1.5px solid ${BLUE}` : `1px solid ${LINE}`, background: on ? "#EEF1FE" : "rgba(255,255,255,0.85)", cursor: "pointer" }}>
                  <TokenOnChain symbol={a} chain="arc" size={26} />
                  <span style={{ fontSize: 14, fontWeight: 700, color: on ? BLUE : INK }}>{a}</span>
                </button>
              );
            })}
          </div>
          <span style={label}>Vault</span>
          <div role="radiogroup" aria-label="Vault" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
            {earnVaults.map((v) => {
              const on = v.key === vaultKey;
              return (
                <button key={v.key} type="button" role="radio" aria-checked={on} disabled={step === "sending"} onClick={() => { setVaultKey(v.key); reset(); }}
                  style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4, padding: "10px 12px", borderRadius: 12, border: on ? `1.5px solid ${BLUE}` : `1px solid ${LINE}`, background: on ? "#EEF1FE" : "rgba(255,255,255,0.85)", cursor: "pointer", textAlign: "left" }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: on ? BLUE : INK }}>{v.name}</span>
                  <span style={{ fontSize: 12, color: MUTED }}>APY {pct(apy[v.key] ?? null)} · {compact(u6(vaults[v.key]?.tvl ?? 0n), cur)}</span>
                </button>
              );
            })}
          </div>
          {segmented([{ k: "deposit", t: "Deposit" }, { k: "withdraw", t: "Withdraw" }], earnAction, setEarnAction, "Deposit or withdraw")}
          {!vs.assetOk && <p style={{ margin: 0, fontSize: 12, color: "#B91C1C" }}>This vault didn't pass FlowFi's safety check, so deposits are paused. Withdrawals still work.</p>}
          {withdrawLimited && earnAction === "withdraw" && <p style={{ margin: 0, fontSize: 12, color: "#B45309" }}>The vault's funds are mostly lent out right now, so only part of your deposit can be withdrawn at once.</p>}
          {amountBox()}
        </section>
      ) : (
        <>
          <section style={card}>
            {sectionTitle(Landmark, "Your position")}
            {segmented([{ k: "USDC", t: "Borrow USDC" }, { k: "EURC", t: "Borrow EURC" }], borrowAsset, (k) => { setBorrowAsset(k); setMkt(null); setPrice(null); setRate(null); setPos({ borrowShares: 0n, collateral: 0n }); }, "Borrow asset")}
            <p style={{ margin: 0, fontSize: 11.5, color: MUTED }}>Each market keeps its own cirBTC collateral and debt.</p>
            {row("Collateral", `${b8(pos.collateral).toFixed(8)} cirBTC (${lc}${usd(u6(collValueOf(pos.collateral)))})`)}
            {row("Debt", `${usd(u6(debt))} ${loanSym}`, true)}
            {row("Liquidation price", liqPriceOf(pos.collateral, debt) !== null ? `${lc}${usd(liqPriceOf(pos.collateral, debt)!, 0)} per BTC` : "—")}
            {ltvBar(ltv, amt > 0n ? newLtv : null)}
          </section>
          <section style={card}>
            {segmented([{ k: "collateral", t: "Add collateral" }, { k: "borrow", t: "Borrow" }, { k: "repay", t: "Repay" }, { k: "withdraw", t: "Withdraw" }], borrowAction, setBorrowAction, "Borrow action")}
            {amt > 0n && (borrowAction === "borrow" || borrowAction === "withdraw") && liqPriceOf(newColl, newDebt) !== null && (
              <p style={{ margin: 0, fontSize: 12, color: MUTED }}>After this, you get liquidated if BTC falls to {lc}{usd(liqPriceOf(newColl, newDebt)!, 0)}.</p>
            )}
            {amountBox()}
            <p style={{ margin: 0, fontSize: 11.5, color: MUTED }}>Market utilization {(utilization * 100).toFixed(1)}%. Borrow rate is variable and rises when the market is nearly fully borrowed.</p>
          </section>
        </>
      )}

      <div style={{ display: "flex", justifyContent: "center" }}>{createElement("powered-by-morpho", { theme: "light" })}</div>

      <p style={{ margin: 0, fontSize: 11.5, color: MUTED, textAlign: "center", lineHeight: 1.5 }}>
        Non-custodial: your funds stay under your control, FlowFi never holds them.
        Borrowing carries liquidation risk if BTC falls.
      </p>

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
