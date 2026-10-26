import { useState, useEffect } from "react";
import { createPublicClient, createWalletClient, custom, http, erc20Abi, formatUnits, parseUnits, maxUint256, parseAbi } from "viem";
import type { EIP1193Provider } from "viem";
import { ArrowLeft, RefreshCw, ExternalLink } from "lucide-react";
import { arcMainnet, ARC_MAINNET_CHAIN_ID_HEX } from "../chains";
import { TokenOnChain } from "./AssetLogos";
import { useIsMobile } from "../useIsMobile";

// Aave V4 Forex Spoke on Arc: supply EURC as collateral, borrow USDC against it.
// Address: Aave address book (bgd-labs/aave-address-book, src/AaveV4Arc.sol, AaveV4ArcSpokes.FOREX_SPOKE).
// Function signatures and math: Aave V4 source (aave/aave-v4, src/spoke/interfaces/ISpoke.sol, src/spoke/Spoke.sol).
// Reserve ids are not hard-coded: they are found onchain by matching each reserve's underlying token.
// Spoke.supply / Spoke.repay pull tokens from the caller (the Spoke is the spender to approve).
// Supplying does not turn collateral on by itself, so setUsingAsCollateral(true) follows the first supply.
// Browser wallet only: the user's wallet calls Aave directly, FlowFi holds nothing and adds no fee.

export const AAVE_FOREX_SPOKE = "0x4164EBCAF74670aa74C8D4F59de6157c0780F1bB" as const;
const EURC = "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1" as const;
const USDC = "0x3600000000000000000000000000000000000000" as const;
const DEC = 6; // EURC and USDC (ERC-20 side) both use 6 decimals
const GAS_BUFFER = 50_000n; // keep 0.05 USDC for gas (gas on Arc is paid in USDC)
const SAFE = 0.7; // MAX borrow uses at most 70% of the borrowing limit (same safe limit as the Morpho markets)
const WAD = 10n ** 18n;

const SPOKE_ABI = parseAbi([
  "struct Reserve { address underlying; address hub; uint16 assetId; uint8 decimals; uint24 collateralRisk; uint8 flags; uint32 dynamicConfigKey; }",
  "struct DynamicReserveConfig { uint16 collateralFactor; uint32 maxLiquidationBonus; uint16 liquidationFee; }",
  "struct UserAccountData { uint256 riskPremium; uint256 avgCollateralFactor; uint256 healthFactor; uint256 totalCollateralValue; uint256 totalDebtValueRay; uint256 activeCollateralCount; uint256 borrowCount; }",
  "function getReserveCount() view returns (uint256)",
  "function getReserve(uint256 reserveId) view returns (Reserve)",
  "function getDynamicReserveConfig(uint256 reserveId, uint32 dynamicConfigKey) view returns (DynamicReserveConfig)",
  "function getUserReserveStatus(uint256 reserveId, address user) view returns (bool, bool)",
  "function getUserSuppliedAssets(uint256 reserveId, address user) view returns (uint256)",
  "function getUserTotalDebt(uint256 reserveId, address user) view returns (uint256)",
  "function getUserAccountData(address user) view returns (UserAccountData)",
  "function ORACLE() view returns (address)",
  "function supply(uint256 reserveId, uint256 amount, address onBehalfOf) returns (uint256, uint256)",
  "function withdraw(uint256 reserveId, uint256 amount, address onBehalfOf) returns (uint256, uint256)",
  "function borrow(uint256 reserveId, uint256 amount, address onBehalfOf) returns (uint256, uint256)",
  "function repay(uint256 reserveId, uint256 amount, address onBehalfOf) returns (uint256, uint256)",
  "function setUsingAsCollateral(uint256 reserveId, bool usingAsCollateral, address onBehalfOf)",
  "error ReservePaused()",
  "error ReserveFrozen()",
  "error ReserveNotBorrowable()",
  "error HealthFactorBelowThreshold()",
  "error MustNotLeaveDust()",
]);
const ORACLE_ABI = parseAbi(["function getReservePrice(uint256 reserveId) view returns (uint256)"]);
const HUB_ABI = parseAbi([
  "function getAssetLiquidity(uint256 assetId) view returns (uint256)",
  "function getAssetDrawnRate(uint256 assetId) view returns (uint256)",
  "struct SpokeConfig { uint40 addCap; uint40 drawCap; uint24 riskPremiumThreshold; bool active; bool halted; }",
  "function getSpokeConfig(uint256 assetId, address spoke) view returns (SpokeConfig)",
  "function getSpokeTotalOwed(uint256 assetId, address spoke) view returns (uint256)",
]);
const MAX_CAP = 2n ** 40n - 1n; // Hub.MAX_ALLOWED_SPOKE_CAP = type(uint40).max (no cap)

// USDC this market can still lend: the Hub's free liquidity, limited by the Forex Spoke's own draw cap
// (Hub._validateDraw: drawCap * 10^decimals >= owed + amount). The Hub's liquidity is shared by every Aave market on Arc.
async function availableToBorrow(usdc: Res): Promise<bigint> {
  const id = BigInt(usdc.assetId);
  const [liq, cfg, owed] = await Promise.all([
    pc.readContract({ address: usdc.hub, abi: HUB_ABI, functionName: "getAssetLiquidity", args: [id] }),
    pc.readContract({ address: usdc.hub, abi: HUB_ABI, functionName: "getSpokeConfig", args: [id, AAVE_FOREX_SPOKE] }),
    pc.readContract({ address: usdc.hub, abi: HUB_ABI, functionName: "getSpokeTotalOwed", args: [id, AAVE_FOREX_SPOKE] }),
  ]);
  if (!cfg.active || cfg.halted) return 0n;
  const cap = BigInt(cfg.drawCap);
  if (cap === MAX_CAP) return liq;
  return minB(liq, pos0(cap * 10n ** BigInt(DEC) - owed));
}

const BLUE = "#3D5AF1";
const INK = "#16151C";
const MUTED = "#5E5B6B";
const LINE = "#DCE2F7";

const pc = createPublicClient({ chain: arcMainnet, transport: http() });
const n6 = (v: bigint) => Number(formatUnits(v, DEC));
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pos0 = (v: bigint) => (v > 0n ? v : 0n);
const minB = (a: bigint, b: bigint) => (a < b ? a : b);

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

type Res = { id: bigint; hub: `0x${string}`; assetId: number; flags: number; cf: number };
type State = {
  eurc: Res; usdc: Res;
  oracle: `0x${string}`;
  pE: bigint; pU: bigint; // oracle prices
  liquidity: bigint; drawnRate: bigint;
  walletE: bigint; walletU: bigint;
  supplied: bigint; collOn: boolean; debt: bigint;
  hf: bigint; collValue: bigint; avgCf: bigint; debtValueRay: bigint;
};
type Action = "supply" | "borrow" | "repay" | "withdraw";

// Summary for the Borrow market list (no wallet needed).
export async function fetchForexSummary(): Promise<{ available: number; rate: number; cf: number } | null> {
  try {
    const { eurc, usdc } = await findReserves();
    const [liq, rate] = await Promise.all([
      availableToBorrow(usdc),
      pc.readContract({ address: usdc.hub, abi: HUB_ABI, functionName: "getAssetDrawnRate", args: [BigInt(usdc.assetId)] }),
    ]);
    return { available: n6(liq), rate: Number(rate) / 1e27, cf: eurc.cf / 10000 };
  } catch { return null; }
}

let reservesPromise: Promise<{ eurc: Res; usdc: Res }> | null = null;
function findReserves() {
  if (!reservesPromise) {
    reservesPromise = (async () => {
      const count = await pc.readContract({ address: AAVE_FOREX_SPOKE, abi: SPOKE_ABI, functionName: "getReserveCount" });
      const found: Partial<Record<"eurc" | "usdc", Res>> = {};
      for (let i = 0n; i < count; i++) {
        const r = await pc.readContract({ address: AAVE_FOREX_SPOKE, abi: SPOKE_ABI, functionName: "getReserve", args: [i] });
        const u = r.underlying.toLowerCase();
        const key = u === EURC.toLowerCase() ? "eurc" : u === USDC.toLowerCase() ? "usdc" : null;
        if (!key || found[key]) continue;
        const dc = await pc.readContract({ address: AAVE_FOREX_SPOKE, abi: SPOKE_ABI, functionName: "getDynamicReserveConfig", args: [i, r.dynamicConfigKey] });
        found[key] = { id: i, hub: r.hub, assetId: r.assetId, flags: r.flags, cf: dc.collateralFactor };
      }
      if (!found.eurc || !found.usdc) throw new Error("EURC or USDC reserve not found on the Aave Forex market.");
      return { eurc: found.eurc, usdc: found.usdc };
    })().catch((e) => { reservesPromise = null; throw e; });
  }
  return reservesPromise;
}

export default function AaveForexBorrow({ owner, provider, onBack }: { owner?: `0x${string}`; provider?: EIP1193Provider; onBack: () => void }) {
  const isMobile = useIsMobile();
  const [s, setS] = useState<State | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [action, setAction] = useState<Action>("supply");
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { eurc, usdc } = await findReserves();
        const oracle = await pc.readContract({ address: AAVE_FOREX_SPOKE, abi: SPOKE_ABI, functionName: "ORACLE" });
        const [pE, pU, liquidity, drawnRate] = await Promise.all([
          pc.readContract({ address: oracle, abi: ORACLE_ABI, functionName: "getReservePrice", args: [eurc.id] }),
          pc.readContract({ address: oracle, abi: ORACLE_ABI, functionName: "getReservePrice", args: [usdc.id] }),
          availableToBorrow(usdc),
          pc.readContract({ address: usdc.hub, abi: HUB_ABI, functionName: "getAssetDrawnRate", args: [BigInt(usdc.assetId)] }),
        ]);
        let walletE = 0n, walletU = 0n, supplied = 0n, collOn = false, debt = 0n, hf = maxUint256, collValue = 0n, avgCf = 0n, debtValueRay = 0n;
        if (owner) {
          const [we, wu, sup, st, d, acc] = await Promise.all([
            pc.readContract({ address: EURC, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
            pc.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
            pc.readContract({ address: AAVE_FOREX_SPOKE, abi: SPOKE_ABI, functionName: "getUserSuppliedAssets", args: [eurc.id, owner] }),
            pc.readContract({ address: AAVE_FOREX_SPOKE, abi: SPOKE_ABI, functionName: "getUserReserveStatus", args: [eurc.id, owner] }),
            pc.readContract({ address: AAVE_FOREX_SPOKE, abi: SPOKE_ABI, functionName: "getUserTotalDebt", args: [usdc.id, owner] }),
            pc.readContract({ address: AAVE_FOREX_SPOKE, abi: SPOKE_ABI, functionName: "getUserAccountData", args: [owner] }),
          ]);
          walletE = we; walletU = wu; supplied = sup; collOn = st[0]; debt = d;
          hf = acc.healthFactor; collValue = acc.totalCollateralValue; avgCf = acc.avgCollateralFactor; debtValueRay = acc.totalDebtValueRay;
        }
        if (!cancelled) { setS({ eurc, usdc, oracle, pE, pU, liquidity, drawnRate, walletE, walletU, supplied, collOn, debt, hf, collValue, avgCf, debtValueRay }); setLoadErr(null); }
      } catch (e: unknown) {
        if (!cancelled) setLoadErr((e as { shortMessage?: string; message?: string }).shortMessage || (e as Error).message || "Could not load the Aave Forex market.");
      }
    })();
    return () => { cancelled = true; };
  }, [owner, tick]);

  useEffect(() => { setAmount(""); setStep("idle"); setMsg(null); setHash(null); }, [action]);

  // ---- math (mirrors Spoke._processUserAccountData) ----
  // Value = amount * price * 10^(18 - decimals). Borrow limit = sum(collateral value * collateral factor).
  const vMul = 10n ** BigInt(18 - DEC);
  const eurcValue = (amt: bigint) => (s ? amt * s.pE * vMul : 0n);
  const usdcValue = (amt: bigint) => (s ? amt * s.pU * vMul : 0n);
  const cfE = s ? BigInt(s.eurc.cf) : 0n; // BPS
  const collateralE = s && s.collOn ? s.supplied : 0n;
  const limitValue = (coll: bigint) => (eurcValue(coll) * cfE) / 10000n;
  const debtValue = (d: bigint) => usdcValue(d);
  const hfFor = (coll: bigint, d: bigint) => (d === 0n ? Infinity : Number((limitValue(coll) * WAD) / debtValue(d)) / 1e18);

  const isFrozen = (f: number) => (f & 0x01) !== 0 || (f & 0x02) !== 0;
  const eurcBlocked = s ? isFrozen(s.eurc.flags) : false;
  const usdcBlocked = s ? isFrozen(s.usdc.flags) || (s.usdc.flags & 0x04) === 0 : false;

  // Max amounts per action
  let maxRaw = 0n;
  if (s) {
    if (action === "supply") maxRaw = s.walletE;
    if (action === "borrow") {
      const room = limitValue(collateralE) * BigInt(Math.round(SAFE * 100)) / 100n - debtValue(s.debt);
      const byLimit = s.pU > 0n ? pos0(room) / (s.pU * vMul) : 0n;
      maxRaw = minB(byLimit, s.liquidity);
    }
    if (action === "repay") maxRaw = minB(s.debt, pos0(s.walletU - GAS_BUFFER));
    if (action === "withdraw") {
      if (s.debt === 0n) maxRaw = s.supplied;
      else {
        // keep health factor >= 1/SAFE after withdrawing
        const needLimit = (debtValue(s.debt) * 100n) / BigInt(Math.round(SAFE * 100));
        const needColl = s.pE > 0n && cfE > 0n ? (needLimit * 10000n) / cfE / (s.pE * vMul) + 1n : s.supplied;
        maxRaw = pos0(s.supplied - needColl);
      }
    }
  }

  let amt = 0n;
  try { amt = amount.trim() ? parseUnits(amount.trim(), DEC) : 0n; } catch { amt = 0n; }
  const newColl = action === "supply" ? collateralE + amt : action === "withdraw" ? pos0(collateralE - amt) : collateralE;
  const newDebt = s ? (action === "borrow" ? s.debt + amt : action === "repay" ? pos0(s.debt - amt) : s.debt) : 0n;
  const hfNow = s ? hfFor(collateralE, s.debt) : Infinity;
  const hfAfter = s ? hfFor(newColl, newDebt) : Infinity;
  const repayAll = action === "repay" && s && amt >= s.debt && s.debt > 0n;
  const withdrawAll = action === "withdraw" && s && s.debt === 0n && amt >= s.supplied && s.supplied > 0n;

  let problem: string | null = null;
  if (s && amount.trim()) {
    if (amt === 0n) problem = "Enter a valid amount.";
    else if (action === "supply" && eurcBlocked) problem = "EURC supply is paused on Aave right now.";
    else if (action === "borrow" && usdcBlocked) problem = "USDC borrowing is paused on Aave right now.";
    else if (action === "borrow" && collateralE === 0n) problem = "Supply EURC first. It is your collateral.";
    else if (action === "supply" && amt > s.walletE) problem = "Not enough EURC in your wallet.";
    else if (action === "repay" && s.debt === 0n) problem = "You have no USDC loan here.";
    else if (action === "repay" && minB(amt, s.debt) > pos0(s.walletU - GAS_BUFFER)) problem = "Not enough USDC in your wallet (keep a little for gas).";
    else if (action === "withdraw" && amt > s.supplied) problem = "More than you supplied.";
    else if ((action === "borrow" || action === "withdraw") && amt > maxRaw) problem = `Over the safe limit. Max ${money(n6(maxRaw))} ${action === "borrow" ? "USDC" : "EURC"}.`;
  }
  const can = !!owner && !!provider && !!s && amt > 0n && !problem && step !== "sending";

  async function send(to: `0x${string}`, data: { abi: typeof SPOKE_ABI | typeof erc20Abi; functionName: string; args: readonly unknown[] }) {
    const wc = createWalletClient({ account: owner!, chain: arcMainnet, transport: custom(provider!) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = await wc.writeContract({ address: to, ...(data as any) });
    setHash(h);
    const r = await pc.waitForTransactionReceipt({ hash: h });
    if (r.status === "reverted") throw new Error("The transaction reverted onchain.");
  }
  async function approveIfNeeded(token: `0x${string}`, need: bigint, sym: string) {
    const cur = await pc.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [owner!, AAVE_FOREX_SPOKE] });
    if (cur >= need) return;
    setMsg(`Approve ${sym} in your wallet...`);
    await send(token, { abi: erc20Abi, functionName: "approve", args: [AAVE_FOREX_SPOKE, need] });
  }

  async function start() {
    if (!can || !s) return;
    setStep("sending"); setMsg(null); setHash(null);
    try {
      await switchToArc(provider!);
      if (action === "supply") {
        await approveIfNeeded(EURC, amt, "EURC");
        setMsg("Confirm the EURC supply in your wallet...");
        await send(AAVE_FOREX_SPOKE, { abi: SPOKE_ABI, functionName: "supply", args: [s.eurc.id, amt, owner!] });
        if (!s.collOn) {
          setMsg("Turn EURC on as collateral in your wallet...");
          await send(AAVE_FOREX_SPOKE, { abi: SPOKE_ABI, functionName: "setUsingAsCollateral", args: [s.eurc.id, true, owner!] });
        }
        setMsg(`${money(n6(amt))} EURC supplied as collateral.`);
      } else if (action === "borrow") {
        setMsg("Confirm the USDC borrow in your wallet...");
        await send(AAVE_FOREX_SPOKE, { abi: SPOKE_ABI, functionName: "borrow", args: [s.usdc.id, amt, owner!] });
        setMsg(`${money(n6(amt))} USDC borrowed. It is in your wallet.`);
      } else if (action === "repay") {
        // Repay all: interest keeps growing every second, so approve a small margin and pass maxUint256
        // (the Spoke caps the repayment at the actual debt).
        const need = repayAll ? s.debt + s.debt / 1000n + 10_000n : amt;
        await approveIfNeeded(USDC, need, "USDC");
        setMsg("Confirm the repayment in your wallet...");
        await send(AAVE_FOREX_SPOKE, { abi: SPOKE_ABI, functionName: "repay", args: [s.usdc.id, repayAll ? maxUint256 : amt, owner!] });
        setMsg(repayAll ? "Loan fully repaid." : `${money(n6(amt))} USDC repaid.`);
      } else {
        setMsg("Confirm the withdrawal in your wallet...");
        await send(AAVE_FOREX_SPOKE, { abi: SPOKE_ABI, functionName: "withdraw", args: [s.eurc.id, withdrawAll ? maxUint256 : amt, owner!] });
        setMsg(withdrawAll ? "All your EURC is back in your wallet." : `${money(n6(amt))} EURC withdrawn.`);
      }
      setStep("done"); setAmount(""); setTick((t) => t + 1);
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string };
      setStep("error"); setMsg(err.shortMessage || err.message || "Transaction failed.");
      setTick((t) => t + 1);
    }
  }

  const card = { background: "rgba(255,255,255,0.78)", border: "1px solid rgba(255,255,255,0.95)", borderRadius: 22, padding: "1.25rem", boxShadow: "0 16px 40px -24px rgba(36,58,150,0.35)", display: "flex", flexDirection: "column" as const, gap: 12 };
  const primary = (on: boolean) => ({ width: "100%", height: 48, borderRadius: 12, border: "none", background: on ? BLUE : "rgba(61,90,241,0.10)", color: on ? "#FFFFFF" : "#8A93B8", fontSize: 15, fontWeight: 600, cursor: on ? "pointer" : "not-allowed" });
  const stat = (k: string, v: string, sub?: string) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "10px 12px", borderRadius: 14, background: "#FFFFFF", border: `1px solid ${LINE}` }}>
      <span style={{ fontSize: 11.5, color: MUTED }}>{k}</span>
      <span style={{ fontSize: 16, fontWeight: 800, color: INK }}>{v}</span>
      {sub && <span style={{ fontSize: 11, color: MUTED }}>{sub}</span>}
    </div>
  );
  const hfText = (h: number) => (h === Infinity ? "—" : h > 100 ? ">100" : h.toFixed(2));
  const hfColor = (h: number) => (h === Infinity || h >= 1.5 ? "#0B7A53" : h >= 1.15 ? "#B45309" : "#B91C1C");

  const tokenOf: Record<Action, "EURC" | "USDC"> = { supply: "EURC", withdraw: "EURC", borrow: "USDC", repay: "USDC" };
  const sym = tokenOf[action];
  const labels: Record<Action, string> = { supply: "Supply EURC", borrow: "Borrow USDC", repay: "Repay", withdraw: "Withdraw EURC" };
  const btn = step === "sending" ? "Waiting for wallet..." : !owner ? "Connect wallet" : !amount ? "Enter an amount" : problem ? problem.split(".")[0] : `${labels[action]}${action === "repay" ? " USDC" : ""}`;
  const walletLine = !s ? "" : action === "supply" ? `Wallet: ${money(n6(s.walletE))} EURC`
    : action === "borrow" ? `Safe max: ${money(n6(maxRaw))} USDC`
    : action === "repay" ? `Debt: ${money(n6(s.debt))} USDC`
    : `Supplied: ${money(n6(s.supplied))} EURC`;
  const rateApy = s ? Math.exp(Number(s.drawnRate) / 1e27) - 1 : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button type="button" onClick={onBack} aria-label="Back to markets" style={{ width: 36, height: 36, borderRadius: 999, border: `1px solid ${LINE}`, background: "#FFFFFF", color: BLUE, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><ArrowLeft size={16} /></button>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <TokenOnChain symbol="EURC" chain="arc" size={28} />
          <span style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 18, fontWeight: 800, color: INK }}>EURC → USDC</span>
            <span style={{ fontSize: 12, color: MUTED, display: "flex", alignItems: "center", gap: 5 }}><img src="/logos/aave.svg" alt="" width={20} height={11} /> Aave V4 Forex market</span>
          </span>
        </span>
        <button type="button" aria-label="Refresh" onClick={() => setTick((t) => t + 1)} style={{ marginLeft: "auto", border: `1px solid ${LINE}`, background: "#FFFFFF", color: BLUE, borderRadius: 999, width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><RefreshCw size={14} /></button>
      </div>

      {loadErr && <div style={{ padding: "10px 12px", borderRadius: 12, background: "#FDECEC", color: "#B91C1C", fontSize: 13 }}>{loadErr}</div>}

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) 380px", gap: 16, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <section style={card}>
            <span style={{ fontSize: 14, fontWeight: 700, color: INK }}>Borrow dollars against your euros</span>
            <p style={{ margin: 0, fontSize: 13, color: MUTED, lineHeight: 1.55 }}>
              Supply EURC as collateral and borrow USDC without selling your EURC. Repay any time to unlock it again.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
              {stat("Borrow rate", rateApy === null ? "…" : `${(rateApy * 100).toFixed(2)}%`, "variable, base")}
              {stat("Available", s ? `$${money(n6(s.liquidity))}` : "…", "USDC to borrow")}
              {stat("Max LTV", s ? `${(s.eurc.cf / 100).toFixed(0)}%` : "…", "of EURC value")}
            </div>
          </section>

          {owner && s && (s.supplied > 0n || s.debt > 0n) && (
            <section style={card}>
              <span style={{ fontSize: 14, fontWeight: 700, color: INK }}>Your position</span>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
                {stat("Collateral", `${money(n6(s.supplied))} EURC`, s.collOn ? undefined : "not used as collateral")}
                {stat("Debt", `${money(n6(s.debt))} USDC`)}
                <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "10px 12px", borderRadius: 14, background: "#FFFFFF", border: `1px solid ${LINE}` }}>
                  <span style={{ fontSize: 11.5, color: MUTED }}>Health factor</span>
                  <span style={{ fontSize: 16, fontWeight: 800, color: hfColor(hfNow) }}>{hfText(hfNow)}</span>
                  <span style={{ fontSize: 11, color: MUTED }}>below 1.00 = liquidation</span>
                </div>
              </div>
            </section>
          )}

          <section style={{ ...card, gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: INK }}>Good to know</span>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: MUTED, lineHeight: 1.6 }}>
              <li>If EUR falls against USD, your loan gets closer to liquidation. Watch your health factor.</li>
              <li>The rate is variable and can change. Your own rate can be a little higher than the base rate.</li>
              <li>FlowFi adds no fee. Your wallet signs every step.</li>
            </ul>
            <a href={`https://arc.etherscan.io/address/${AAVE_FOREX_SPOKE}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: BLUE, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}>Aave Forex market contract <ExternalLink size={12} /></a>
          </section>
        </div>

        <section style={{ ...card, position: isMobile ? "static" : "sticky", top: 16 }}>
          <div role="tablist" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 4, padding: 4, borderRadius: 14, background: "#EEF1FE" }}>
            {(["supply", "borrow", "repay", "withdraw"] as Action[]).map((a) => (
              <button key={a} type="button" role="tab" aria-selected={action === a} onClick={() => step !== "sending" && setAction(a)}
                style={{ height: 36, borderRadius: 10, border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: action === a ? 700 : 500, background: action === a ? "#FFFFFF" : "transparent", color: action === a ? BLUE : MUTED }}>
                {a === "supply" ? "Supply" : a === "borrow" ? "Borrow" : a === "repay" ? "Repay" : "Withdraw"}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: MUTED }}>{walletLine}</span>
            <button type="button" onClick={() => setAmount(maxRaw > 0n ? formatUnits(maxRaw, DEC) : "")} disabled={step === "sending" || !s}
              style={{ border: "none", background: "#E3E8FD", color: BLUE, fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999, cursor: "pointer" }}>MAX</button>
          </div>
          <div style={{ position: "relative" }}>
            <input inputMode="decimal" value={amount} placeholder="0.00" disabled={step === "sending"}
              onChange={(e) => { const v = e.target.value.replace(",", "."); if (/^\d*\.?\d{0,6}$/.test(v)) { setAmount(v); if (step !== "sending") { setStep("idle"); setMsg(null); } } }}
              style={{ width: "100%", boxSizing: "border-box", height: 56, padding: "0 110px 0 14px", borderRadius: 14, border: `1px solid ${LINE}`, fontSize: 22, fontWeight: 600, color: INK, background: "#FFFFFF" }} />
            <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: INK }}>
              <TokenOnChain symbol={sym} chain="arc" size={20} />{sym}
            </span>
          </div>
          {s && amt > 0n && !problem && (action !== "supply" || s.debt > 0n) && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: MUTED }}>
              <span>Health factor</span>
              <span><b style={{ color: hfColor(hfNow) }}>{hfText(hfNow)}</b> → <b style={{ color: hfColor(hfAfter) }}>{hfText(hfAfter)}</b></span>
            </div>
          )}
          {problem && amount.trim() && <div style={{ fontSize: 12.5, color: "#B91C1C" }}>{problem}</div>}
          {msg && step !== "idle" && (
            <div style={{ padding: "10px 12px", borderRadius: 10, fontSize: 13, background: step === "done" ? "#E7F7EF" : step === "error" ? "#FDECEC" : "#F5F7FF", color: step === "done" ? "#0B7A53" : step === "error" ? "#B91C1C" : INK }}>
              {msg}{" "}
              {hash && <a href={`https://arc.etherscan.io/tx/${hash}`} target="_blank" rel="noopener noreferrer" style={{ color: BLUE, fontWeight: 600 }}>View tx ↗</a>}
            </div>
          )}
          <button type="button" onClick={start} disabled={!can} style={primary(can)}>{btn}</button>
          {action === "supply" && s && !s.collOn && <p style={{ margin: 0, fontSize: 11.5, color: MUTED }}>First supply takes one extra signature to turn EURC on as collateral.</p>}
        </section>
      </div>
    </div>
  );
}
