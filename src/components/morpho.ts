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

export const VAULTS = [
  { key: "galaxy", name: "Galaxy USDC", curator: "Galaxy", asset: "USDC", address: "0x8E357432CC12ff425c36432F312968aEb16112AF" },
  { key: "keyrock", name: "Keyrock Prime USDC", curator: "Keyrock", asset: "USDC", address: "0x5bEfAb92a5A3D60F578Cb51EEb4e4FD50a1e3123" },
  { key: "steakhouse-eurc", name: "Steakhouse Prime EURC", curator: "Steakhouse", asset: "EURC", address: "0xbeef00be37BdE921BAE06fad223125BAB16c41D1" },
  { key: "gauntlet-eurc", name: "Gauntlet EURC Prime", curator: "Gauntlet", asset: "EURC", address: "0x05863F54B05e96092069eF30c9Ca6060336e50B9" },
] as const;
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
