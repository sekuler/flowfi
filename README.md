# FlowFi

**Where cross-chain USDC becomes productive**

FlowFi treats Arc as the destination, not just another chain to bridge into. USDC is Arc's native gas asset, not a wrapped placeholder — so funds arriving via CCTP V2 through a Circle Developer-Controlled Wallet are immediately usable for swaps, lending, and payments, with no synthetic-asset risk in between. Swap, lending, and token tools are built around that arrival point, not bolted onto it — all inside one application on [Arc](https://www.arc.io), Circle's stablecoin-native Layer-1.

**Live:** [flowfi.finance](https://flowfi.finance) · **Repo:** [github.com/sekuler/flowfi](https://github.com/sekuler/flowfi)

---

## Why FlowFi is different

- ✓ **No wrapped USDC** — every balance is native, on the chain it lives on
- ✓ **Real CCTP V2** — Circle's actual burn/attest/mint protocol, not a synthetic bridge
- ✓ **AI executes transactions** — natural language in, signed on-chain transaction out
- ✓ **AI market analysis** — real RSI/EMA/MACD/support-resistance computed server-side from live data, not AI-generated numbers
- ✓ **Permissionless liquidity pools** — anyone can create a pool for any token pair
- ✓ **Seedless wallets** — Circle Developer-Controlled Wallets, no browser extension required
- ✓ **Built specifically for Arc** — not a multi-chain app with Arc bolted on

---

## By the numbers

| | |
|---|---|
| **6** verified smart contracts | **5** financial primitives |
| **4** supported chains | **8** contracts security-reviewed |
| **100%** on-chain execution | **1** address across all 4 chains |

---

## Why Arc?

FlowFi is designed around stablecoins, not speculation.

Being honest about it: CCTP V2 and Circle Developer-Controlled Wallets aren't Arc-exclusive — they work on other supported EVM chains too. What's actually Arc-specific is what happens after funds arrive. USDC is Arc's native gas asset, not a wrapped placeholder bolted onto a general-purpose chain — so cross-chain USDC becomes immediately productive the moment it lands, with no synthetic-asset discount and no "why is gas a random token" friction to explain away.

FlowFi is built around that arrival point — bridging, swaps, lending, and token tools all settle through the same native-USDC rail, instead of being stitched together across incompatible chains and bridge providers.

---

## What's inside

| Feature | What it does |
|---|---|
| **Bridge (CCTP V2)** | Genuine cross-chain USDC transfer via Circle's official burn/attest/mint protocol — Arc, Ethereum Sepolia, Base Sepolia, Arbitrum Sepolia |
| **Circle Wallet** | FlowFi provisions a Developer-Controlled Wallet and tracks its per-chain wallet IDs — no seed phrase, no browser extension, one consistent address surfaced across all four supported chains |
| **Smart Swap** | USDC ⇄ EURC with an AI advisor that reads real pool liquidity and warns before a swap moves the price too much |
| **Lending & Borrowing** | Supply USDC to earn interest, or post EURC as collateral to borrow — 75% max LTV, liquidation at 85% |
| **Liquidity Pools** | Permissionless AMM — create a pool for any token pair, add/remove liquidity, swap directly against it |
| **Token Launch** | Deploy your own ERC-20 on Arc and pair it with liquidity in one flow |
| **Stablecoin Analytics** | Live, on-chain TVL and distribution across every FlowFi contract |
| **AI Copilot** | Type what you want — "swap 10 USDC to EURC", "send 20 USDC to 0x..." — Copilot parses it and executes the on-chain transaction. An interface over the settlement rail above, not the product itself |
| **AI Market Analysis** | Ask "analyze BTC" or "analyze Morpho" and get real technical analysis (RSI, EMA, MACD, pivot support/resistance across 1H/4H/1D/1W/1M) and tokenomics/unlock data — all numbers computed server-side from live data, with the AI only writing the interpretive summary, never the figures |
| **Perpetuals** *(disabled, code retained)* | Long/short BTC and ETH up to 20x leverage. Removed from navigation after a security review found no oracle backs the pricing — the contract and code remain in the repo, but the feature isn't reachable in the app or via Copilot |

---

## Architecture

```
┌─────────────────────────────────────────────┐
│                  Frontend                    │
│        React + TypeScript + viem             │
└──────────────────┬────────────────────────────┘
                    │
        ┌───────────┼────────────┐
        │           │            │
┌───────▼──────┐ ┌──▼─────────┐ ┌▼─────────────┐
│ Browser Wallet│ │Circle Wallet│ │  AI Copilot  │
│ (EIP-6963)    │ │(no seed phr)│ │(Claude Sonnet)│
└───────┬──────┘ └──┬─────────┘ └┬─────────────┘
        │           │            │
        └───────────┼────────────┘
                     │
       ┌─────────────▼──────────────┐
       │      Arc Testnet (L1)       │
       │  Swap · Lending · Perps ·   │
       │  TokenFactory · PoolFactory │
       └─────────────┬───────────────┘
                      │ CCTP V2
       ┌──────────────┼───────────────┐
       │              │               │
┌──────▼─────┐ ┌──────▼─────┐ ┌───────▼──────┐
│ Eth Sepolia│ │Base Sepolia│ │Arbitrum Sepolia│
└────────────┘ └────────────┘ └────────────────┘
```

---

## Screenshots

| | |
|---|---|
| **Landing** | ![Landing](./screenshots/1-%20Landing.png) |
| **Home** | ![Home](./screenshots/2%20-%20Home.png) |
| **Dashboard** | ![Dashboard](./screenshots/3%20-%20Dashboard.png) |
| **Portfolio** | ![Portfolio](./screenshots/4%20-%20Portfolio.png) |
| **Swap** | ![Swap](./screenshots/5%20-%20Swap.png) |
| **Bridge** | ![Bridge](./screenshots/6%20-%20Bridge.png) |
| **Send** | ![Send](./screenshots/7%20-%20Send.png) |
| **Lending** | ![Lending](./screenshots/8%20-%20Lending.png) |
| **Token Launch** | ![Token Launch](./screenshots/10%20-%20TokenLaunch.png) |
| **Liquidity Pools** | ![Liquidity Pools](./screenshots/11%20-%20Liquidity%20pools.png) |
| **Circle Wallet** | ![Circle Wallet](./screenshots/12%20-%20Circle%20wallet.png) |
| **History** | ![History](./screenshots/13%20-%20History.png) |

---

## Smart contracts (Arc Testnet)

| Contract | Address |
|---|---|
| Swap v2 (fixed-rate USDC/EURC) | `0x13bD5D32509bC5D03811B3e5F86952a8C2BD0521` |
| Lending v2 | `0x5d52D4c13FBEBB7FCd4852bD4876D2A12a7B100a` |
| Pool Factory v2 (permissionless AMM) | `0x23782643650D73b2Bb145B9145D62D743bF25CB0` |
| Escrow v3 *(deployed and verified, not yet wired to the app)* | `0xCe6c2B0EAbC86974c653020467c05Ce5e1eB418C` |
| Token Factory | `0x481E8919f79A4DA6446EA78cEa70037acB9c85A1` |
| Perpetuals *(disabled, code retained — see Known Limitations)* | `0x3B4cE1734087e1c67474Ff42982063febE3E4B20` |
| USDC (Arc native) | `0x3600000000000000000000000000000000000000` |
| EURC | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` |

6 FlowFi-deployed contracts, all verified and viewable on [Arcscan](https://testnet.arcscan.app). A full security review covered these plus 2 legacy/superseded versions (an earlier Swap-pool factory and AMM) — see `kontrat-denetim-raporu.md` for the complete 8-contract audit.

### Circle CCTP V2 infrastructure (Arc Testnet, official — not FlowFi-deployed)

FlowFi's bridge calls Circle's real, official CCTP V2 contracts directly — not a custom or wrapped bridge:

| Contract | Address |
|---|---|
| TokenMessengerV2 | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` |
| MessageTransmitterV2 | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` |

Source: [Arc's official contract addresses page](https://docs.arc.io/arc/references/contract-addresses).

---

## Verified receipts — real transaction hashes

Every claim above is checkable on-chain. Rather than asking anyone to take our word for it, here are real transaction hashes from live demo runs — click through to Arcscan to see them settle.

**Demo 1 — Cross-chain bridge (Ethereum Sepolia → Arc)**
| Step | Tx hash |
|---|---|
| Source burn (Ethereum Sepolia) | [`0x2920de716bea703082e373d6b711354f6ce4d5076a1783fdb73e0094adfecc51`](https://sepolia.etherscan.io/tx/0x2920de716bea703082e373d6b711354f6ce4d5076a1783fdb73e0094adfecc51) |
| Destination mint (Arc) | [`0x77a9b887dadd47dd6a80d029d8aedee659f730e529ab4a624dd8518226d61695`](https://testnet.arcscan.app/tx/0x77a9b887dadd47dd6a80d029d8aedee659f730e529ab4a624dd8518226d61695) |

**Demo 2 — Circle Developer-Controlled Wallet executing a swap on Arc**
| Step | Tx hash |
|---|---|
| On-chain execution | [`0x0226fc2c8b4cd4000bd25c6aea358f553aed9e69cc69b36582c0b2c7568146c0`](https://testnet.arcscan.app/tx/0x0226fc2c8b4cd4000bd25c6aea358f553aed9e69cc69b36582c0b2c7568146c0) |

**Demo 3 — Financial action on Arc (Lending supply, 25 USDC)**
| Step | Tx hash |
|---|---|
| Contract execution | [`0x970457d689c4507a8e9085b095ede0b374adf7b1dadabd254edcf25aebeb0374`](https://testnet.arcscan.app/tx/0x970457d689c4507a8e9085b095ede0b374adf7b1dadabd254edcf25aebeb0374) |

All four transactions were confirmed successful on their respective explorers as of this writing.

---

## Data sources

FlowFi's market analysis never uses AI-generated numbers — every figure comes from a real source:

| Data | Source | Notes |
|---|---|---|
| Price, market cap, volume, supply | [CoinGecko](https://coingecko.com) | Free tier |
| RSI, EMA, MACD, support/resistance | Computed server-side | Standard formulas, real historical OHLCV — not AI-generated |
| Token unlock/vesting schedules | 57 tokens manually curated from [DeFiLlama](https://defillama.com), cross-checked against official project docs — plus live data from the DropsTab API for any token they track | Manual list is the fallback; DropsTab is checked first |

If a data point isn't available from a real source, FlowFi says so rather than guessing.

---

## Tech stack

- **Frontend** — React, TypeScript, Vite
- **Chain interaction** — [viem](https://viem.sh)
- **Wallets** — EIP-6963 (MetaMask, Rabby, etc.) and Circle Developer-Controlled Wallets
- **Bridging** — Circle CCTP V2
- **AI** — Claude Sonnet, used for natural-language transaction parsing, swap risk analysis, and market analysis summaries (never for computing the underlying numbers)
- **Charts** — lightweight-charts
- **Hosting** — Vercel

---

## Running locally

```bash
git clone https://github.com/sekuler/flowfi.git
cd flowfi
npm install

cp .env.example .env
# then fill in:
# VITE_ANTHROPIC_KEY=
# CIRCLE_API_KEY=
# CIRCLE_ENTITY_SECRET=

npm run dev
```

The app runs on Arc Testnet by default — no mainnet funds are ever involved. Get test USDC from [faucet.circle.com](https://faucet.circle.com).

---

## Known Limitations

FlowFi's contracts have been through a manual security review (not a professional third-party audit) — several deliberate design trade-offs came out of that review, documented here rather than hidden:

- **ArcSwap and ArcLending price the USDC/EURC pair without an oracle.** ArcSwap's exchange rate is owner-set; ArcLending assumes both tokens hold their ~$1 peg. Neither reads a live price feed. This is a known simplification for the testnet stage — a real oracle (Chainlink/Pyth) is a prerequisite before either contract should touch real funds.
- **ArcFactoryV2 pools have no TWAP.** Spot-price swaps on thin/low-liquidity pools carry real sandwich and price-impact risk, same as any constant-product AMM without time-weighted pricing. Use `minAmountOut` and be mindful of pool depth.
- **ArcFactoryV2 has no admin kill-switch, by design.** The factory and its pools are fully permissionless — no owner, no pause. That's a deliberate trade-off in favor of trustlessness, not an oversight: adding a pause here would undercut the "no one can freeze your pool" guarantee that makes a permissionless AMM meaningful in the first place. If you'd rather have a pausable, guarded pool, use the ArcAMM (legacy, fixed USDC/EURC pair) contract instead.

Full audit notes (all 8 contracts, category-by-category) are in `kontrat-denetim-raporu.md` in this repo.

---

## Roadmap

- [ ] Mainnet deployment (pending a professional third-party security audit)
- [ ] Cross-chain intent engine — extend the CCTP V2 settlement flow to route multi-step actions automatically
- [ ] Native yield routing across lending and liquidity positions, built on the same settlement rail

**Not on the mainnet roadmap:** Perpetuals is frozen in an experimental state — no decentralized oracle (Stork/Pyth) is integrated, so pricing isn't independently verified. It stays available on testnet for exploration but won't ship to mainnet without a real oracle integration.

---

## Disclaimer

FlowFi runs entirely on Arc Testnet. All tokens are test assets with no monetary value. Perpetuals pricing is submitted client-side for demo purposes and is **not** sourced from a decentralized oracle — do not use this for anything beyond testnet exploration.
