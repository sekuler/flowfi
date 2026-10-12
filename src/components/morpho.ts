import { parseAbi } from "viem";

// Morpho on Arc MAINNET (chain 5042). Every address below was checked onchain on 2026-09-27
// (idToMarketParams on Morpho Blue + asset() on each vault):
//  - market 0xc2db…815d = loan USDC (0x3600…), collateral cirBTC (0x171A…), AdaptiveCurveIRM, LLTV 86%
//  - Galaxy USDC and Keyrock Prime USDC vaults both have asset() = USDC
// FlowFi has no contract here: the user's own wallet calls Morpho and the vaults directly.
// Mainnet only -- testnet cirBTC (contracts.ts) is a different token and will not work with this market.
export const MORPHO_BLUE = "0x34CD04070dD72b14E241112F6d83812Df5Af7fCD" as const;
export const MARKET_ID = "0xc2db905f174e5defcce01d321b09f15f78856a36a21b90cc7e1abbc29225815d" as const;
export const USDC = "0x3600000000000000000000000000000000000000" as const;
export const CIRBTC = "0x171A4217b86A807A64eB94757Db6849fb4bDbAA0" as const;
export const EURC = "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1" as const;

export const MARKET_PARAMS = {
  loanToken: USDC,
  collateralToken: CIRBTC,
  oracle: "0x2AA87fF48933Ce6aBA240BEE916Fc2e6Ec1e51Ab",
  irm: "0xF02615d094Fc02fC031C35fe705e175aA4653f20",
  lltv: 860000000000000000n, // 86%
} as const;

// EURC vaults (Morpho VaultV2, underlying EURC) checked on arc.etherscan.io on 2026-09-30.
// Borrow markets (cirBTC collateral). Both verified onchain on 2026-09-30 with idToMarketParams.
export const MARKETS = {
  USDC: { id: MARKET_ID, params: MARKET_PARAMS, loan: USDC, cur: "$" },
  EURC: {
    id: "0x6ea1ea96a1cc671615f3a3bdf51481c5b79e362a8b634396e680d1070137daf4" as `0x${string}`,
    params: { loanToken: EURC, collateralToken: CIRBTC, oracle: "0x6945246777DfdF4744D957323857F797Ec19Ca1e", irm: "0xF02615d094Fc02fC031C35fe705e175aA4653f20", lltv: 860000000000000000n },
    loan: EURC,
    cur: "€",
  },
} as const;
export type BorrowAsset = keyof typeof MARKETS;

// kind "morpho": an ERC-4626 Morpho vault at `address`. logo: the curator's/protocol's official mark (from their X accounts / Aave brand kit), null when we have none.
// kind "aave": Aave V4 Main Spoke at `address` (also the spender to approve), reserve AAVE_USDC_RESERVE_ID.
export const VAULTS = [
  { key: "galaxy", name: "Galaxy USDC", curator: "Galaxy", logo: "/logos/galaxy.jpg", asset: "USDC", kind: "morpho", address: "0x8E357432CC12ff425c36432F312968aEb16112AF" },
  { key: "keyrock", name: "Keyrock Prime USDC", curator: "Keyrock", logo: "/logos/keyrock.jpg", asset: "USDC", kind: "morpho", address: "0x5bEfAb92a5A3D60F578Cb51EEb4e4FD50a1e3123" },
  { key: "bitwise", name: "Bitwise Premium RWA USDC", curator: "Bitwise", logo: "/logos/bitwise.png", asset: "USDC", kind: "morpho", address: "0x7610094B846657dCF166D59e42973db52c7015F9" },
  { key: "aave-usdc", name: "Aave USDC", curator: "Aave", logo: "/logos/aave.svg", asset: "USDC", kind: "aave", address: "0xB843bdC3a87A05E77E07Df9FE48928b3A34b134d" },
  { key: "steakhouse-eurc", name: "Steakhouse Prime EURC", curator: "Steakhouse", logo: "/logos/steakhouse.jpg", asset: "EURC", kind: "morpho", address: "0xbeef00be37BdE921BAE06fad223125BAB16c41D1" },
  { key: "gauntlet-eurc", name: "Gauntlet EURC Prime", curator: "Gauntlet", logo: "/logos/gauntlet.png", asset: "EURC", kind: "morpho", address: "0x05863F54B05e96092069eF30c9Ca6060336e50B9" },
] as const;

// ---- Aave V4 on Arc (USDC only; EURC supply APY is ~0 there) ----
// Addresses: Aave address book (bgd-labs/aave-address-book, AaveV4Arc.sol). Reserve 0 on the Main Spoke is USDC
// (Aave V4 API + onchain Withdraw event). Spoke.supply pulls tokens from msg.sender (so the Spoke is the spender)
// and withdraw sends min(amount, user's full balance), so "withdraw all" passes maxUint256 and leaves no dust.
export const AAVE_CORE_HUB = "0x17288dfc86205301064577b98B02b81017e6F79C" as const;
export const AAVE_MAIN_SPOKE = "0xB843bdC3a87A05E77E07Df9FE48928b3A34b134d" as const;
export const AAVE_USDC_RESERVE_ID = 0n;

export const AAVE_SPOKE_ABI = parseAbi([
  "struct Reserve { address underlying; address hub; uint16 assetId; uint8 decimals; uint24 collateralRisk; uint8 flags; uint32 dynamicConfigKey; }",
  "function getReserve(uint256 reserveId) view returns (Reserve)",
  "function getReserveSuppliedAssets(uint256 reserveId) view returns (uint256)",
  "function getUserSuppliedAssets(uint256 reserveId, address user) view returns (uint256)",
  "function supply(uint256 reserveId, uint256 amount, address onBehalfOf) returns (uint256, uint256)",
  "function withdraw(uint256 reserveId, uint256 amount, address onBehalfOf) returns (uint256, uint256)",
  "error ReservePaused()",
  "error ReserveFrozen()",
]);

// Supply APY from Aave's V4 API (api.v4.aave.com/graphql). Query and field names checked against the API's own schema;
// summary.supplyApy.value is a fraction (0.0091 = 0.91%). Picks the Main Spoke USDC row; null when unavailable.
export async function fetchAaveUsdcApy(): Promise<number | null> {
  try {
    const query = `query { reserves(request: { query: { chainIds: [5042] }, filter: ALL, orderBy: { supplyApy: DESC } }) {
      spoke { address } asset { underlying { address } } summary { supplyApy { value } } } }`;
    const r = await fetch("https://api.v4.aave.com/graphql", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }) });
    const j = await r.json();
    const row = (j?.data?.reserves ?? []).find((x: any) =>
      String(x?.spoke?.address).toLowerCase() === AAVE_MAIN_SPOKE.toLowerCase() &&
      String(x?.asset?.underlying?.address).toLowerCase() === USDC.toLowerCase());
    const v = Number(row?.summary?.supplyApy?.value);
    return Number.isFinite(v) ? v : null;
  } catch { return null; }
}
export type EarnAsset = (typeof VAULTS)[number]["asset"];

export const USDC_DECIMALS = 6;
export const CIRBTC_DECIMALS = 8;
export const WAD = 10n ** 18n;
export const ORACLE_SCALE = 10n ** 36n; // Morpho oracle price: 1 collateral unit in loan units, scaled 1e36
// FlowFi's own ceiling for new borrows and collateral withdrawals, well under the 86% liquidation line.
export const SAFE_LTV_PCT = 70n;

export const MORPHO_ABI = parseAbi([
  "struct MarketParams { address loanToken; address collateralToken; address oracle; address irm; uint256 lltv; }",
  "function market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)",
  "function position(bytes32 id, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
  "function supplyCollateral(MarketParams marketParams, uint256 assets, address onBehalf, bytes data)",
  "function borrow(MarketParams marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver) returns (uint256, uint256)",
  "function repay(MarketParams marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data) returns (uint256, uint256)",
  "function withdrawCollateral(MarketParams marketParams, uint256 assets, address onBehalf, address receiver)",
]);

export const IRM_ABI = parseAbi([
  "struct MarketParams { address loanToken; address collateralToken; address oracle; address irm; uint256 lltv; }",
  "struct Market { uint128 totalSupplyAssets; uint128 totalSupplyShares; uint128 totalBorrowAssets; uint128 totalBorrowShares; uint128 lastUpdate; uint128 fee; }",
  "function borrowRateView(MarketParams marketParams, Market market) view returns (uint256)",
]);

export const ORACLE_ABI = parseAbi(["function price() view returns (uint256)"]);

export const VAULT_ABI = parseAbi([
  "function asset() view returns (address)",
  "function totalAssets() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function maxWithdraw(address owner) view returns (uint256)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "function deposit(uint256 assets, address receiver) returns (uint256)",
  "function withdraw(uint256 assets, address receiver, address owner) returns (uint256)",
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256)",
]);

// Morpho's share math (SharesMathLib): 1e6 virtual shares and 1 virtual asset.
export function toAssetsUp(shares: bigint, totalAssets: bigint, totalShares: bigint) {
  const d = totalShares + 1_000_000n;
  return (shares * (totalAssets + 1n) + d - 1n) / d;
}

// Vault net APY from Morpho's public API. Tries the V1 (MetaMorpho) and V2 vault queries; null when unavailable.
export async function fetchVaultApy(address: string): Promise<number | null> {
  const queries = [
    { q: `query($a:String!,$c:Int!){ vaultByAddress(address:$a, chainId:$c){ state{ netApy } } }`, pick: (d: any) => d?.vaultByAddress?.state?.netApy },
    { q: `query($a:String!,$c:Int!){ vaultV2ByAddress(address:$a, chainId:$c){ netApy } }`, pick: (d: any) => d?.vaultV2ByAddress?.netApy },
  ];
  for (const { q, pick } of queries) {
    try {
      const r = await fetch("https://api.morpho.org/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, variables: { a: address, c: 5042 } }),
      });
      const j = await r.json();
      const v = pick(j?.data);
      if (typeof v === "number" && Number.isFinite(v)) return v;
    } catch { /* try the next query */ }
  }
  return null;
}

// Extra vault facts for the vault page, from Morpho's public API (field names from docs.morpho.org, Morpho Vaults API:
// V2 liquidityUsd, performanceFee, managementFee, metadata.description; V1 liquidity.usd, metadata.description).
// Each group is asked separately so one missing field doesn't hide the rest; anything unavailable stays null.
export type ExposureItem = { symbol: string; logo: string | null; usd: number; idle?: boolean };
export type VaultDetails = { liquidityUsd: number | null; performanceFee: number | null; managementFee: number | null; description: string | null; totalAssetsUsd: number | null; exposure: ExposureItem[] | null };
async function morphoQuery(query: string, address: string): Promise<any> {
  try {
    const r = await fetch("https://api.morpho.org/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { a: address, c: 5042 } }),
    });
    const j = await r.json();
    return j?.data ?? null;
  } catch { return null; }
}
const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
export async function fetchVaultDetails(address: string): Promise<VaultDetails> {
  const [a, b, c, d, e] = await Promise.all([
    morphoQuery(`query($a:String!,$c:Int!){ vaultV2ByAddress(address:$a, chainId:$c){ liquidityUsd totalAssetsUsd } }`, address),
    morphoQuery(`query($a:String!,$c:Int!){ vaultV2ByAddress(address:$a, chainId:$c){ performanceFee managementFee } }`, address),
    morphoQuery(`query($a:String!,$c:Int!){ vaultV2ByAddress(address:$a, chainId:$c){ metadata{ description } } }`, address),
    morphoQuery(`query($a:String!,$c:Int!){ vaultByAddress(address:$a, chainId:$c){ liquidity{ usd } metadata{ description } } }`, address),
    // Exposure: idle assets + each Morpho market the vault supplies to (via its MorphoMarketV1Adapter), by collateral.
    // Field names from Morpho's own API types (@morpho-org/blue-api-sdk): VaultV2.idleAssetsUsd, VaultV2.adapters.items,
    // MorphoMarketV1Adapter.positions.items, MarketPosition.state.supplyAssetsUsd, Market.collateralAsset { symbol logoURI }.
    morphoQuery(`query($a:String!,$c:Int!){ vaultV2ByAddress(address:$a, chainId:$c){ idleAssetsUsd asset{ symbol logoURI }
      adapters{ items{ __typename ... on MorphoMarketV1Adapter { positions{ items{ state{ supplyAssetsUsd } market{ collateralAsset{ symbol logoURI } } } } } } } } }`, address),
  ]);
  const v2a = a?.vaultV2ByAddress, v2b = b?.vaultV2ByAddress, v2c = c?.vaultV2ByAddress, v1 = d?.vaultByAddress;
  const desc = v2c?.metadata?.description ?? v1?.metadata?.description;
  let exposure: ExposureItem[] | null = null;
  const v2e = e?.vaultV2ByAddress;
  if (v2e) {
    const byCollateral = new Map<string, ExposureItem>();
    for (const ad of v2e.adapters?.items ?? []) {
      for (const p of ad?.positions?.items ?? []) {
        const usd = numOrNull(p?.state?.supplyAssetsUsd);
        const col = p?.market?.collateralAsset;
        if (usd === null || usd <= 0 || typeof col?.symbol !== "string") continue;
        const cur = byCollateral.get(col.symbol);
        byCollateral.set(col.symbol, { symbol: col.symbol, logo: typeof col.logoURI === "string" ? col.logoURI : null, usd: (cur?.usd ?? 0) + usd });
      }
    }
    const list = [...byCollateral.values()].sort((x, y) => y.usd - x.usd);
    const idle = numOrNull(v2e.idleAssetsUsd);
    if (idle !== null && idle > 0 && typeof v2e.asset?.symbol === "string") list.push({ symbol: v2e.asset.symbol, logo: typeof v2e.asset.logoURI === "string" ? v2e.asset.logoURI : null, usd: idle, idle: true });
    exposure = list.length ? list : null;
  }
  return {
    totalAssetsUsd: numOrNull(v2a?.totalAssetsUsd),
    exposure,
    liquidityUsd: numOrNull(v2a?.liquidityUsd) ?? numOrNull(v1?.liquidity?.usd),
    performanceFee: numOrNull(v2b?.performanceFee),
    managementFee: numOrNull(v2b?.managementFee),
    description: typeof desc === "string" && desc.trim() ? desc.trim() : null,
  };
}

// APY history for the vault page chart, from Morpho's public API (docs.morpho.org, Morpho Vaults API):
// V2 historicalState.avgNetApy(options, lookbackHours) and V1 historicalState.netApy(options), points { x, y }.
// x is read as a unix timestamp (seconds; milliseconds are converted), y as a fraction like netApy. null when unavailable.
export type ApyPoint = { t: number; apy: number };
export async function fetchVaultApyHistory(address: string, days: number): Promise<ApyPoint[] | null> {
  const end = Math.floor(Date.now() / 1000);
  const options = { startTimestamp: end - days * 86400, endTimestamp: end, interval: "DAY" };
  const queries = [
    { q: `query($a:String!,$c:Int!,$o:TimeseriesOptions){ vaultV2ByAddress(address:$a, chainId:$c){ historicalState{ avgNetApy(options:$o, lookbackHours:24){ x y } } } }`, pick: (d: any) => d?.vaultV2ByAddress?.historicalState?.avgNetApy },
    { q: `query($a:String!,$c:Int!,$o:TimeseriesOptions){ vaultByAddress(address:$a, chainId:$c){ historicalState{ netApy(options:$o){ x y } } } }`, pick: (d: any) => d?.vaultByAddress?.historicalState?.netApy },
  ];
  for (const { q, pick } of queries) {
    try {
      const r = await fetch("https://api.morpho.org/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, variables: { a: address, c: 5042, o: options } }),
      });
      const j = await r.json();
      const raw = pick(j?.data);
      if (!Array.isArray(raw)) continue;
      const pts = raw
        .map((p: any) => ({ t: Number(p?.x), apy: Number(p?.y) }))
        .filter((p: ApyPoint) => Number.isFinite(p.t) && Number.isFinite(p.apy))
        .map((p: ApyPoint) => ({ t: p.t > 1e12 ? Math.floor(p.t / 1000) : p.t, apy: p.apy }))
        .sort((a: ApyPoint, b: ApyPoint) => a.t - b.t);
      if (pts.length >= 2) return pts;
    } catch { /* try the next query */ }
  }
  return null;
}

// Aave V4 supply APY history for the Aave page chart, from Aave's V4 API: supplyApyHistory(request: { reserve, window })
// returning { date, avgRate { value } } (query and variables from aave.com/docs/aave-v4/liquidity/reserves; avgRate.value read
// as a fraction like summary.supplyApy.value). `reserve` is the API's own reserve id, looked up from the reserves list.
// Windows: LAST_DAY is from Aave's docs example; LAST_WEEK and LAST_MONTH follow the documented TimeWindow names
// (LastWeek, ...). Anything the API rejects just comes back null and the chart says it isn't available.
let aaveUsdcReserveId: string | null = null;
async function aaveQuery(query: string, variables?: unknown): Promise<any> {
  const r = await fetch("https://api.v4.aave.com/graphql", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }) });
  const j = await r.json();
  return j?.data ?? null;
}
export async function fetchAaveUsdcApyHistory(window: "LAST_DAY" | "LAST_WEEK" | "LAST_MONTH"): Promise<ApyPoint[] | null> {
  try {
    if (!aaveUsdcReserveId) {
      const d = await aaveQuery(`query { reserves(request: { query: { chainIds: [5042] }, filter: ALL, orderBy: { supplyApy: DESC } }) {
        id spoke { address } asset { underlying { address } } } }`);
      const row = (d?.reserves ?? []).find((x: any) =>
        String(x?.spoke?.address).toLowerCase() === AAVE_MAIN_SPOKE.toLowerCase() &&
        String(x?.asset?.underlying?.address).toLowerCase() === USDC.toLowerCase());
      if (typeof row?.id !== "string") return null;
      aaveUsdcReserveId = row.id;
    }
    const d = await aaveQuery(`query ($request: SupplyApyHistoryRequest!) { supplyApyHistory(request: $request) { date avgRate { value } } }`,
      { request: { reserve: aaveUsdcReserveId, window } });
    const raw = d?.supplyApyHistory;
    if (!Array.isArray(raw)) return null;
    const pts = raw
      .map((p: any) => {
        const t = typeof p?.date === "number" ? p.date : Date.parse(String(p?.date));
        return { t: t > 1e12 ? Math.floor(t / 1000) : t, apy: Number(p?.avgRate?.value) };
      })
      .filter((p: ApyPoint) => Number.isFinite(p.t) && Number.isFinite(p.apy))
      .sort((a: ApyPoint, b: ApyPoint) => a.t - b.t);
    return pts.length >= 2 ? pts : null;
  } catch { return null; }
}
