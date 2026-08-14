// Manually curated tokenomics + unlock data, gathered one coin at a time
// from DeFiLlama unlock pages (linked by the project owner) plus manual
// notes for the specific "next unlock" figures DeFiLlama's JS-rendered
// chart doesn't expose to a simple page fetch.
//
// Price/market cap/volume are NEVER stored here — those always come live
// from CoinGecko elsewhere in the app. This file only holds the slower-
// moving supply/allocation/unlock facts that are safe to keep static
// until manually updated.
//
// HOW TO ADD A NEW TOKEN:
// 1. Get the DeFiLlama unlocks page link (defillama.com/unlocks/<slug>)
// 2. Give Claude the link — it fetches circulating/max supply + allocation breakdown
// 3. Give Claude the "next unlock" date/amount by reading the chart yourself
// 4. Claude adds a new entry below

export interface TokenUnlockInfo {
  coingeckoId: string; // must match CoinGecko's coin id so this can be matched to live price data
  name: string;
  symbol: string;
  circulatingSupply: string; // as of the date recorded, not live
  maxSupply: string; // "Unlimited" if uncapped
  allocationBreakdown: Record<string, string>; // e.g. { "Insiders": "26.7%", "Farming": "23.5%" }
  // Three distinct, honest states — never conflate "we haven't entered data
  // yet" with "this token genuinely has no fixed unlock schedule".
  unlockStatus:
    | { type: "not_yet_provided" } // we haven't gathered the specific next-unlock figures yet
    | { type: "no_fixed_schedule"; note: string } // e.g. ongoing linear mining emission, no cliff/unlock event
    | { type: "scheduled"; date: string; amount: string; percentOfCirculating: string };
  source: string; // the DeFiLlama link this was gathered from
  recordedAt: string; // "YYYY-MM-DD" — when this snapshot was taken, so staleness is visible
}

export const TOKEN_UNLOCKS: TokenUnlockInfo[] = [
  {
    coingeckoId: "pendle",
    name: "Pendle",
    symbol: "PENDLE",
    circulatingSupply: "172.08M PENDLE",
    maxSupply: "Unlimited",
    allocationBreakdown: {
      "Insiders": "26.7%",
      "Farming": "23.5%",
      "Other": "20.5%",
      "Noncirculating": "16%",
      "Private Sale": "13.3%",
    },
    unlockStatus: { type: "not_yet_provided" },
    source: "https://defillama.com/unlocks/pendle",
    recordedAt: "2026-08-11",
  },
  {
    coingeckoId: "dogecoin",
    name: "Dogecoin",
    symbol: "DOGE",
    circulatingSupply: "155.449B DOGE",
    maxSupply: "Unlimited",
    allocationBreakdown: {
      "Farming (mining)": "100%",
    },
    unlockStatus: {
      type: "no_fixed_schedule",
      note: "Ongoing linear mining emission — roughly 22.5M DOGE (~$1.6M) per day, projected to continue for about 22 more years (until block 12.5M). No cliff unlocks or scheduled token releases exist for DOGE.",
    },
    source: "https://defillama.com/unlocks/dogecoin",
    recordedAt: "2026-08-11",
  },
  {
    coingeckoId: "solana",
    name: "Solana",
    symbol: "SOL",
    circulatingSupply: "582.48M SOL",
    maxSupply: "Unlimited",
    allocationBreakdown: {
      "Ecosystem": "29.3%",
      "Private Sale": "27.4%",
      "Staking": "22.8%",
      "Insiders": "19.3%",
      "Public Sale": "1.2%",
    },
    unlockStatus: {
      type: "no_fixed_schedule",
      note: "Ongoing daily staking rewards emission — roughly 58,629 SOL (~$4.45M) per day, about 0.25% of circulating supply per day. Based on an initial 8% annual rate declining ~15% per year toward a 1.5% terminal rate. No large one-time cliff unlocks are scheduled for SOL — it's continuous, not event-based.",
    },
    source: "https://defillama.com/unlocks/solana",
    recordedAt: "2026-08-11",
  },
  {
    coingeckoId: "aave",
    name: "Aave",
    symbol: "AAVE",
    circulatingSupply: "15.42M AAVE",
    maxSupply: "16M AAVE",
    allocationBreakdown: {
      "Staking": "70.4%",
      "Farming": "29.6%",
    },
    unlockStatus: { type: "not_yet_provided" },
    source: "https://defillama.com/unlocks/aave",
    recordedAt: "2026-08-11",
  },
  {
    coingeckoId: "aptos",
    name: "Aptos",
    symbol: "APT",
    circulatingSupply: "846.03M APT",
    maxSupply: "2.1B APT",
    allocationBreakdown: {
      "Noncirculating": "39.8%",
      "Staking": "24.7%",
      "Insiders": "20.8%",
      "Private Sale": "14.7%",
    },
    unlockStatus: {
      type: "no_fixed_schedule",
      note: "Monthly recurring unlock, typically around the 12th of each month, roughly 11-14.4M APT per event (declining slowly over time), released to Community/Foundation/Core Contributors/Investors. Cross-checked against 3 independent sources (DeFiLlama, Tokenomist, Tokenomics.com) — the schedule runs for a very long time (sources vary: 2044 vs 2050 as the final vest date), not a single cliff event. Next known event: ~Sep 12, 2026, ~14.36M APT (~0.7% of total supply).",
    },
    source: "https://defillama.com/unlocks/aptos",
    recordedAt: "2026-08-11",
  },
  {
    coingeckoId: "sui",
    name: "Sui",
    symbol: "SUI",
    circulatingSupply: "4.075B SUI",
    maxSupply: "10B SUI",
    allocationBreakdown: {
      "Private Sale": "34.4%",
      "Noncirculating": "23.2%",
      "Staking": "19.3%",
      "Public Sale": "14.2%",
      "Insiders": "8.8%",
    },
    unlockStatus: {
      type: "no_fixed_schedule",
      note: "Monthly recurring unlock, typically around the 1st of each month, to Early Contributors and Community Reserve — DeFiLlama's own notes confirm these are monthly with gradually decreasing amounts (roughly 20-25M SUI per month currently). Schedule runs through approximately 2030, not a single event. Next known event: ~Sep 1, 2026.",
    },
    source: "https://defillama.com/unlocks/sui-foundation",
    recordedAt: "2026-08-11",
  },
  {
    coingeckoId: "pudgy-penguins",
    name: "Pudgy Penguins",
    symbol: "PENGU",
    circulatingSupply: "62.86B PENGU",
    maxSupply: "88.889B PENGU",
    allocationBreakdown: {
      "Liquidity": "64.9%",
      "Insiders": "33.3%",
      "Airdrop": "1.8%",
    },
    unlockStatus: {
      type: "no_fixed_schedule",
      note: "Ongoing linear vesting for Team and Company allocations only (locked 1 year, then linear over 3 years starting Dec 17, 2025) — roughly 23.75M PENGU (~$150,834) per day combined. All other allocations were unlocked at TGE.",
    },
    source: "https://defillama.com/unlocks/pudgy-penguins",
    recordedAt: "2026-08-11",
  },
  {
    coingeckoId: "megaeth",
    name: "MegaETH",
    symbol: "MEGA",
    circulatingSupply: "1.13B MEGA",
    maxSupply: "10B MEGA",
    allocationBreakdown: {
      "KPI Staking Rewards": "53.3%",
      "VC Allocation": "14.7%",
      "Team and Advisors": "9.5%",
      "Foundation/Eco Reserve": "7.5%",
      "Public Sale (Sonar)": "5%",
      "Echo Round": "5%",
      "Fluffle Round": "2.5%",
    },
    unlockStatus: {
      type: "no_fixed_schedule",
      note: "Complex, multi-cohort schedule extending into 2030 — not a single date. The largest bucket (53.3%, KPI Staking Rewards) is released based on the network hitting performance KPIs, not a fixed calendar. Other cohorts vary: Echo Round investors get 20% at TGE then a 1-year cliff + 3-year vest; Fluffle Round gets 50% at TGE + 6-month linear vest; Team/Advisors and VC allocations vest over multiple years. Next known event per DeFiLlama: ~June 23, 2026, Echo Round.",
    },
    source: "https://defillama.com/unlocks/megaeth-bridge (cross-checked against MegaETH's own token page — corrected from an earlier single-date record)",
    recordedAt: "2026-08-12",
  },
  {
    coingeckoId: "worldcoin-wld",
    name: "Worldcoin",
    symbol: "WLD",
    circulatingSupply: "3.585B WLD",
    maxSupply: "10B WLD",
    allocationBreakdown: {
      "Public Sale": "69.9%",
      "Private Sale": "14.6%",
      "Insiders": "12.4%",
      "Noncirculating": "3%",
    },
    unlockStatus: {
      type: "no_fixed_schedule",
      note: "Ongoing linear Community allocation unlock — roughly 1.6M WLD (~$489,008) per day, running until around July 2029. This is 17.5% of total supply, 48.8% of current float.",
    },
    source: "https://defillama.com/unlocks/worldcoin",
    recordedAt: "2026-08-11",
  },
  {
    coingeckoId: "virtual-protocol",
    name: "Virtuals Protocol",
    symbol: "VIRTUAL",
    circulatingSupply: "657.91M VIRTUAL",
    maxSupply: "1B VIRTUAL",
    allocationBreakdown: {
      "Airdrop": "60%",
      "Ecosystem": "35%",
      "Liquidity": "5%",
    },
    unlockStatus: {
      type: "no_fixed_schedule",
      note: "All allocations were fully distributed at TGE on Dec 24, 2023. No further scheduled unlocks exist. The Ecosystem allocation (35%) sits in a DAO-controlled multisig and is only deployed after governance approval, not on a fixed schedule.",
    },
    source: "https://defillama.com/unlocks/virtuals-protocol",
    recordedAt: "2026-08-11",
  },
  {
    coingeckoId: "lido-dao",
    name: "Lido",
    symbol: "LDO",
    circulatingSupply: "836.31M LDO",
    maxSupply: "1B LDO",
    allocationBreakdown: {
      "Insiders": "41.2%",
      "Farming": "36.8%",
      "Private Sale": "22%",
    },
    unlockStatus: {
      type: "no_fixed_schedule",
      note: "The tracked linear vesting (Investors, Initial Developers, Founders & Future Employees, Validators & Signature Holders) started Dec 17, 2021 and ran linearly over 1 year, so it has already fully completed. No further scheduled unlock events are currently tracked for LDO.",
    },
    source: "https://defillama.com/protocol/unlocks/lido",
    recordedAt: "2026-08-11",
  },
  {
    coingeckoId: "litecoin",
    name: "Litecoin",
    symbol: "LTC",
    circulatingSupply: "77.49M LTC",
    maxSupply: "84M LTC",
    allocationBreakdown: {
      "Farming (mining)": "100%",
    },
    unlockStatus: {
      type: "no_fixed_schedule",
      note: "Fixed-supply, mined asset with a halving schedule (like Bitcoin) — block reward halves roughly every 4 years. No vesting/insider unlock schedule exists; new supply comes only from mining rewards until the 84M cap is reached.",
    },
    source: "https://defillama.com/token/LTC (DeFiLlama's own Unlocks section for this page requires a paid subscription — the mining/halving info above is general public knowledge, not from that gated section)",
    recordedAt: "2026-08-11",
  },
  {
    coingeckoId: "ondo-finance",
    name: "Ondo Finance",
    symbol: "ONDO",
    circulatingSupply: "4.869B ONDO",
    maxSupply: "10B ONDO",
    allocationBreakdown: {
      "Noncirculating": "58.2%",
      "Insiders": "27.1%",
      "Private Sale": "10.6%",
      "Public Sale": "4.1%",
    },
    unlockStatus: {
      type: "scheduled",
      date: "2027-01-18",
      amount: "~1.94B ONDO (~35.1% of market cap — the largest single unlock in ONDO's schedule; released to Ecosystem Growth)",
      percentOfCirculating: "~19.4% of total supply in this one event",
    },
    source: "https://defillama.com/unlocks/ondo-finance (cross-checked against Tokenomist and Tokenomics.com — corrected date from Jan 17 to Jan 18, and amount from ~1.71B to ~1.94B ONDO)",
    recordedAt: "2026-08-12",
  },
  {
    coingeckoId: "eigencloud",
    name: "EigenCloud",
    symbol: "EIGEN",
    circulatingSupply: "741.23M EIGEN",
    maxSupply: "Unlimited",
    allocationBreakdown: {
      "Private Sale": "28.7%",
      "Insiders": "24.8%",
      "Airdrop": "22.2%",
      "Farming": "16%",
      "Ecosystem": "8.2%",
    },
    unlockStatus: {
      type: "no_fixed_schedule",
      note: "Confirmed via Eigen Foundation docs and cross-checked with DropsTab/Tokenomist: 4% monthly release of Investors + Early Contributors allocations (after a 1-year cliff), ~36.82M EIGEN per month (19.75M investors, 17.07M team). Started Sep 30, 2025, completing 100% by September 30, 2027. Not a single event — this repeats every month until then.",
    },
    source: "https://defillama.com/unlocks/eigencloud (cross-checked against Eigen Foundation docs)",
    recordedAt: "2026-08-12",
  },
  {
    coingeckoId: "ether-fi",
    name: "ether.fi",
    symbol: "ETHFI",
    circulatingSupply: "973.47M ETHFI",
    maxSupply: "1B ETHFI",
    allocationBreakdown: {
      "Private Sale": "34.8%",
      "Airdrop": "19.9%",
      "Insiders": "19%",
      "Farming": "15%",
      "Noncirculating": "7.3%",
      "Liquidity": "4%",
    },
    unlockStatus: {
      type: "no_fixed_schedule",
      note: "Ongoing linear Core Contributors unlock, started Mar 13, 2026, running over 1 year (roughly 442,714 ETHFI, ~$169,040, per day) — 16.2% of total supply, 16.64% of float. Currently in progress, ending around March 2027.",
    },
    source: "https://defillama.com/protocol/unlocks/ether.fi",
    recordedAt: "2026-08-11",
  },
  {
    coingeckoId: "ethena",
    name: "Ethena",
    symbol: "ENA",
    circulatingSupply: "9.828B ENA",
    maxSupply: "15B ENA",
    allocationBreakdown: {
      "Noncirculating": "29.5%",
      "Insiders": "27.1%",
      "Private Sale": "22.6%",
      "Airdrop": "20.8%",
    },
    unlockStatus: {
      type: "no_fixed_schedule",
      note: "Monthly recurring cliff unlock (roughly the 1st-6th of each month), running until ~April 2028. IMPORTANT: independent trackers disagree significantly on the exact size of the next unlock — Tokenomics.com says ~275M ENA, Messari says ~333M ENA, CoinGecko says ~40.63M ENA. Treat any single exact figure with caution; only the recurring monthly pattern and the ~2028 end date are consistently confirmed across sources.",
    },
    source: "https://defillama.com/protocol/unlocks/ethena (next-unlock date/amount cross-checked against CoinGecko's own listing, which was more current)",
    recordedAt: "2026-08-11",
  },
  {
    coingeckoId: "rocket-pool",
    name: "Rocket Pool",
    symbol: "RPL",
    circulatingSupply: "22.7M RPL",
    maxSupply: "22.7M RPL (dynamically inflating, see note)",
    allocationBreakdown: {
      "Private Sale": "42.8%",
      "Public Sale": "24.6%",
      "Staking": "15.9%",
      "Insiders": "11.9%",
      "Noncirculating": "4.8%",
    },
    unlockStatus: {
      type: "no_fixed_schedule",
      note: "Uses an ongoing compound inflation model — roughly 5% annually, minted in ~28-day intervals, split among Node Operators, Trusted Node Operators (oDAO), and the Protocol DAO treasury (currently ~70/15/15, adjustable by governance). No single scheduled cliff unlock — new supply is continuously minted.",
    },
    source: "https://defillama.com/protocol/unlocks/rocket-pool",
    recordedAt: "2026-08-11",
  },
  {
    coingeckoId: "raydium",
    name: "Raydium",
    symbol: "RAY",
    circulatingSupply: "269.51M RAY",
    maxSupply: "555M RAY",
    allocationBreakdown: {
      "Ecosystem": "38.6%",
      "Insiders": "36%",
      "Farming": "15.2%",
      "Liquidity": "10.3%",
    },
    unlockStatus: {
      type: "no_fixed_schedule",
      note: "The tracked Team/Community/Advisors linear vesting started Feb 21, 2022 and ran over 2 years, so it has already completed. Separately, Raydium's mining reserve is still actively emitting roughly 1.9M RAY per year on an ongoing basis (per Raydium's own docs), not a single scheduled cliff.",
    },
    source: "https://defillama.com/protocol/unlocks/raydium",
    recordedAt: "2026-08-11",
  },
  {
    coingeckoId: "hyperliquid",
    name: "Hyperliquid",
    symbol: "HYPE",
    circulatingSupply: "222.45M HYPE",
    maxSupply: "1B HYPE",
    allocationBreakdown: {
      "Airdrop": "79.9%",
      "Noncirculating": "16.2%",
      "Staking": "2.5%",
      "Insiders": "1.4%",
    },
    unlockStatus: {
      type: "no_fixed_schedule",
      note: "Ongoing periodic Core Contributors vesting tracked directly from on-chain transfers (most recent tranche: 433,024 HYPE, ~$23.63M, Aug 6, 2026) — no single fixed date. DeFiLlama's own notes state most vesting schedules are expected to complete between 2027-2028, some continuing after.",
    },
    source: "https://defillama.com/protocol/unlocks/hyperliquid",
    recordedAt: "2026-08-11",
  },
  {
    coingeckoId: "gmx",
    name: "GMX",
    symbol: "GMX",
    circulatingSupply: "10.45M GMX",
    maxSupply: "13.25M GMX",
    allocationBreakdown: {
      "Migration": "47.8%",
      "Liquidity": "15.9%",
      "Staking": "10.3%",
      "Insiders": "10%",
      "Noncirculating": "8%",
      "Farming": "8%",
    },
    unlockStatus: {
      type: "no_fixed_schedule",
      note: "The tracked Uniswap Pool unlock event (Sep 2, 2021) already completed years ago. Ongoing mechanism: esGMX is distributed to stakers, GLP LPs, and affiliates, then each holder individually vests it into GMX over 1 year via vester contracts — a continuous, per-user process rather than a single scheduled cliff.",
    },
    source: "https://defillama.com/protocol/unlocks/gmx",
    recordedAt: "2026-08-11",
  },
  {
    coingeckoId: "morpho",
    name: "Morpho",
    symbol: "MORPHO",
    circulatingSupply: "656.23M MORPHO",
    maxSupply: "1B MORPHO",
    allocationBreakdown: {
      "Insiders": "67.8%",
      "Ecosystem": "25.8%",
      "Farming": "5%",
      "Liquidity": "1.3%",
    },
    unlockStatus: {
      type: "no_fixed_schedule",
      note: "Confirmed from Morpho's own official docs: ongoing linear vesting across multiple cohorts, not a single event. Founders (15.2%): 2-year linear vest, fully vested by May 17, 2028. Strategic Partners Cohort 3 (6.7%): 2-year linear vest, fully vested by Nov 21, 2027. Strategic Partners Cohort 2 (16.8%) fully vested already (by Oct 3, 2025).",
    },
    source: "https://docs.morpho.org/learn/governance/morpho-token/ (official docs — corrected from an earlier single-date record)",
    recordedAt: "2026-08-12",
  },
  {
    coingeckoId: "uniswap",
    name: "Uniswap",
    symbol: "UNI",
    circulatingSupply: "624.31M UNI",
    maxSupply: "1B UNI",
    allocationBreakdown: {
      "Farming": "45.3%",
      "Insiders": "21.8%",
      "Private Sale": "17.9%",
      "Airdrop": "14.9%",
    },
    unlockStatus: {
      type: "no_fixed_schedule",
      note: "The tracked Team/Investors/Advisors linear vesting started Sep 14, 2020 and ran over 4 years, so it has already fully completed. No further scheduled unlock events are currently tracked for UNI.",
    },
    source: "https://defillama.com/protocol/unlocks/uniswap",
    recordedAt: "2026-08-11",
  },
  {
    coingeckoId: "curve-dao-token",
    name: "Curve Finance",
    symbol: "CRV",
    circulatingSupply: "1.547B CRV",
    maxSupply: "3.03B CRV",
    allocationBreakdown: {
      "Farming": "52.4%",
      "Insiders": "41.3%",
      "Noncirculating": "6.3%",
    },
    unlockStatus: {
      type: "no_fixed_schedule",
      note: "Ongoing linear Community emission, labeled by DeFiLlama as '(Ongoing)' — roughly 376,143 CRV (~$104,387) per day, 8.88% of float. Started Aug 13, 2025 over a 1-year period; may continue in further tranches beyond this one.",
    },
    source: "https://defillama.com/protocol/unlocks/curve-finance",
    recordedAt: "2026-08-11",
  },
  {
    coingeckoId: "across-protocol",
    name: "Across",
    symbol: "ACX",
    circulatingSupply: "704.66M ACX",
    maxSupply: "1B ACX",
    allocationBreakdown: {
      "Farming": "44.2%",
      "Private Sale": "35.8%",
      "Insiders": "20%",
    },
    unlockStatus: {
      type: "no_fixed_schedule",
      note: "Ongoing monthly Risk Labs Team vesting (~150M ACX total, 4-year linear vest from the token's Nov 2022 launch), expected to substantially complete around November 2026. Separate investor tranches had their own 1-year cliffs, most already completed by late 2025.",
    },
    source: "https://defillama.com/unlocks/across (cross-checked against Across/Risk Labs public statements — corrected from a single-date record)",
    recordedAt: "2026-08-12",
  },
  {
    coingeckoId: "jupiter",
    name: "Jupiter",
    symbol: "JUP",
    circulatingSupply: "3.32B JUP",
    maxSupply: "7B JUP (reduced from 10B after a 3B burn in Jan 2025; further burns bring reported total supply to ~6.86B)",
    allocationBreakdown: {
      "Airdrop": "49.2%",
      "Insiders": "35.9%",
      "Public Sale": "7.2%",
      "Launch": "2.9%",
      "Community": "2.9%",
      "Liquidity": "1.9%",
    },
    unlockStatus: {
      type: "no_fixed_schedule",
      note: "A DAO-passed 'Net-Zero' proposal (Feb 2026) took JUP net emissions to effectively zero: Team Reserve emissions are paused indefinitely, Jupuary distribution was postponed with tokens returned to the Community Cold Multisig, and Mercurial Stakeholders vesting was accelerated. Most remaining allocations (Community Reserves, Strategic Reserve, Team, Jupuary) are marked TBD with no defined unlock schedule pending future DAO votes.",
    },
    source: "https://defillama.com/protocol/unlocks/jupiter",
    recordedAt: "2026-08-11",
  },
  {
    coingeckoId: "meteora",
    name: "Meteora",
    symbol: "MET",
    circulatingSupply: "543.71M MET",
    maxSupply: "1B MET",
    allocationBreakdown: {
      "Airdrop": "82.7%",
      "Ecosystem": "7.8%",
      "Public Sale": "5.5%",
      "Insiders": "4%",
    },
    unlockStatus: {
      type: "no_fixed_schedule",
      note: "Ongoing linear Team unlock (labeled '(Ongoing)' by DeFiLlama) — roughly 83,300 MET (~$13,274) per day, started Nov 22, 2025, running over ~6 years. At TGE (Oct 23, 2025), 48% of supply was released immediately with no vesting; the remaining 52% (Team + Ecosystem Reserve) is on 6-year linear vesting.",
    },
    source: "https://defillama.com/protocol/unlocks/meteora",
    recordedAt: "2026-08-11",
  },
  {
    coingeckoId: "aerodrome-finance",
    name: "Aerodrome Finance",
    symbol: "AERO",
    circulatingSupply: "972.79M AERO",
    maxSupply: "Unlimited (infinite supply — no fixed cap)",
    allocationBreakdown: {
      "Gauge Emissions": "67.34%",
      "Airdrop": "9.61%",
      "Rebase": "5.07%",
      "Protocol Grants": "2.40%",
      "Voter Incentives": "1.92%",
      "Genesis Liquidity Pool": "0.48%",
    },
    unlockStatus: {
      type: "no_fixed_schedule",
      note: "Weekly (every Thursday 00:00 UTC) Gauge Emissions release, amount determined by veAERO voter governance rather than a fixed schedule. Since Epoch 67, emissions are controlled by the 'Aero Fed', where voters decide to increase, decrease, or hold rates. Supply is uncapped, so this is genuinely ongoing rather than a finite unlock.",
    },
    source: "https://defillama.com/unlocks/aerodrome",
    recordedAt: "2026-08-11",
  },
  {
    coingeckoId: "dodo",
    name: "DODO",
    symbol: "DODO",
    circulatingSupply: "1B DODO",
    maxSupply: "1B DODO",
    allocationBreakdown: {
      "Public Sale": "100%",
    },
    unlockStatus: {
      type: "no_fixed_schedule",
      note: "The tracked Team & Consultants / Seed Investors linear vesting started Aug 15, 2021 and ran over 2 years, so it has already fully completed. Circulating supply currently equals max supply (1B), meaning no locked tokens remain.",
    },
    source: "https://defillama.com/protocol/unlocks/dodo",
    recordedAt: "2026-08-11",
  },
  {
    coingeckoId: "thorchain",
    name: "RUNE",
    symbol: "RUNE",
    circulatingSupply: "338.19M RUNE",
    maxSupply: "354.05M RUNE (post-burn cap of 500M, reduced from original ~968M in 2019; further ~145.8M burned since)",
    allocationBreakdown: {
      "Insiders": "30.2%",
      "Public Sale": "21.8%",
      "Staking": "21.4%",
      "Ecosystem": "17.7%",
      "Private Sale": "8.9%",
    },
    unlockStatus: {
      type: "no_fixed_schedule",
      note: "All investor/team/community allocations were fully vested by 2023. Remaining emission is ongoing node & pool block rewards from the reserve (small, continuous — e.g. 1 RUNE tracked in the most recent event), not a scheduled cliff.",
    },
    source: "https://defillama.com/protocol/unlocks/thorchain-dex",
    recordedAt: "2026-08-11",
  },
  {
    coingeckoId: "pancakeswap",
    name: "PancakeSwap",
    symbol: "CAKE",
    circulatingSupply: "321.6M CAKE",
    maxSupply: "400M CAKE (soft target — CAKE is deflationary via ongoing burns and is not expected to reach the cap)",
    allocationBreakdown: {
      "Farming": "91.9%",
      "Noncirculating": "4.7%",
      "Staking": "3.4%",
    },
    unlockStatus: {
      type: "no_fixed_schedule",
      note: "Ongoing daily farming/staking/lottery incentive emissions (DeFiLlama tracks 225+ recurring events) — not a single scheduled cliff. CAKE emissions have been reduced over time (from 40/block originally to ~1.8/block) and the team runs active burn programs to keep supply deflationary.",
    },
    source: "https://defillama.com/protocol/unlocks/pancakeswap",
    recordedAt: "2026-08-11",
  },
];

export function getTokenUnlockInfo(coingeckoId: string): TokenUnlockInfo | null {
  return TOKEN_UNLOCKS.find((t) => t.coingeckoId === coingeckoId) ?? null;
}
