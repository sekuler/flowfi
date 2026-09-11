# FlowFi

**Where cross-chain USDC becomes productive**

FlowFi treats Arc as the destination, not just another chain to bridge into. USDC is Arc's native gas asset, not a wrapped placeholder — so funds arriving via CCTP V2 through a Circle Developer-Controlled Wallet are immediately usable for swaps and payments, with no synthetic-asset risk in between. Swap and token tools are built around that arrival point, not bolted onto it — all inside one application on [Arc](https://www.arc.io), Circle's stablecoin-native Layer-1.

**Live:** [flowfi.finance](https://flowfi.finance) · **Repo:** [github.com/sekuler/flowfi](https://github.com/sekuler/flowfi)

---

## Why FlowFi is different

- ✓ **No wrapped USDC** — every balance is native, on the chain it lives on
- ✓ **Real CCTP V2** — Circle's actual burn/attest/mint protocol, not a synthetic bridge
- ✓ **AI executes transactions** — natural language in, signed on-chain transaction out
- ✓ **AI market analysis** — real RSI/EMA/MACD/support-resistance computed server-side from live data, not AI-generated numbers
- ✓ **Curated liquidity pools** — FlowFi creates pools for major assets (USDC, EURC, cirBTC, and more); anyone can add/remove liquidity or swap against any of them
- ✓ **Seedless wallets** — Circle Developer-Controlled Wallets, no browser extension required
- ✓ **Built specifically for Arc** — not a multi-chain app with Arc bolted on

---

## By the numbers

| | |
|---|---|
| **1** settlement flow | **4** connected chains |
| Native USDC — no wrapped assets | **8** contracts security-reviewed |
| **100%** on-chain execution | Circle-signed, seedless |

---

## Why Arc?

FlowFi is designed around stablecoins, not speculation.

Being honest about it: CCTP V2 and Circle Developer-Controlled Wallets aren't Arc-exclusive — they work on other supported EVM chains too. What's actually Arc-specific is what happens after funds arrive. USDC is Arc's native gas asset, not a wrapped placeholder bolted onto a general-purpose chain — so cross-chain USDC becomes immediately productive the moment it lands, with no synthetic-asset discount and no "why is gas a random token" friction to explain away.

FlowFi is built around that arrival point — bridging, swaps, and token tools all settle through the same native-USDC rail, instead of being stitched together across incompatible chains and bridge providers.

There's a second, independent reason Arc specifically: it runs on Malachite, a consensus engine built for sub-second deterministic finality — once a transaction confirms, it's final, no reorg risk. That's not a Circle-product claim that applies elsewhere; it's Arc's own chain-level property, and it's why FlowFi doesn't need to hedge language like "should be confirmed" around settlement.

---

## What's inside

| Feature | What it does |
|---|---|
| **Bridge & Gateway** | One page, two modes. Bridge: genuine cross-chain USDC transfer via Circle's official burn/attest/mint CCTP V2 protocol — Arc, Ethereum Sepolia, Base Sepolia, Arbitrum Sepolia. Gateway: a unified USDC balance via Circle's Gateway protocol — deposit once, held as one pooled balance instead of four separate on-chain balances. Both work from either a browser wallet or the Circle Wallet |
| **Circle Wallet** | FlowFi provisions a Developer-Controlled Wallet and tracks its per-chain wallet IDs — no seed phrase, no browser extension, one consistent address surfaced across all four supported chains. Can be used as your only login, or alongside a browser wallet |
| **Smart Swap** | USDC ⇄ EURC with an AI advisor that reads real pool liquidity and warns before a swap moves the price too much |
| **Liquidity Pools** | FlowFi creates pools for major assets (USDC, EURC, cirBTC, and more) — anyone can add/remove liquidity or swap against any of them |
| **Token Launch** | Deploy your own ERC-20 on Arc — fixed 1,000,000 supply, minted to your wallet |
| **Stablecoin Analytics** | Live, on-chain TVL and distribution across every FlowFi contract |
| **AI Copilot** | Type what you want — "swap 10 USDC to EURC", "send 20 USDC to 0x..." — Copilot parses it and executes the on-chain transaction. An interface over the settlement rail above, not the product itself |
| **AI Market Analysis** | Ask "analyze BTC" or "analyze Morpho" and get real technical analysis (RSI, EMA, MACD, pivot support/resistance across 1H/4H/1D/1W/1M) and tokenomics/unlock data — all numbers computed server-side from live data, with the AI only writing the interpretive summary, never the figures |

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
       │  Swap · TokenFactory ·      │
       │      PoolFactory            │
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
| **Landing** | ![Landing](./screenshots/1%20-%20Landing.png) |
| **Portfolio** | ![Portfolio](./screenshots/2%20-%20Portfolio.png) |
| **Swap** | ![Swap](./screenshots/3%20-%20Swap.png) |
| **Bridge** | ![Bridge](./screenshots/4%20-%20Bridge.png) |
| **Circle Wallet** | ![Circle Wallet](./screenshots/5%20-%20Circle%20Wallet.png) |
| **Liquidity Pools** | ![Liquidity Pools](./screenshots/6%20-%20Liquidity%20Pools.png) |
| **Launch Token** | ![Launch Token](./screenshots/7%20-%20Launch%20Token.png) |
| **Dashboard** | ![Dashboard](./screenshots/8%20-%20Dashboard.png) |
| **Stablecoin Analytics** | ![Stablecoin Analytics](./screenshots/9%20-%20Stablecoin%20Analytics.png) |
| **History** | ![History](./screenshots/10%20-%20History.png) |

---

## Smart contracts (Arc Testnet)

| Contract | Address |
|---|---|
| Swap v5 (fixed-rate USDC/EURC) | `0x3CD201DA3DdDF2d0E9fcBC606a32E821099dEAC1` |
| Pool Factory v2 *(legacy — pools created here keep working, but no new pools are created here)* | `0x23782643650D73b2Bb145B9145D62D743bF25CB0` |
| Pool Factory v3 *(legacy — same reasoning as v2)* | `0x5ee0c6cc6879728a4835826D87b28702f8993559` |
| Pool Factory v4 | `0x57B451D60F09222C2bb6c828FFE3703069A532Ed` |
| Escrow v4 *(deployed and verified, not yet wired to the app)* | `0xDDDe5a4E691F6ce6826CB85F09466E799FCFabfB` |
| Token Factory | `0x481E8919f79A4DA6446EA78cEa70037acB9c85A1` |
| USDC (Arc native) | `0x3600000000000000000000000000000000000000` |
| EURC | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` |

6 FlowFi-deployed contracts, all verified and viewable on [Arcscan](https://testnet.arcscan.app). A full security review covered these plus 2 legacy/superseded versions (an earlier Swap-pool factory and AMM) — see [`SECURITY.md`](./SECURITY.md) for the complete review.

### Circle CCTP V2 infrastructure (Arc Testnet, official — not FlowFi-deployed)

FlowFi's bridge calls Circle's real, official CCTP V2 contracts directly — not a custom or wrapped bridge:

| Contract | Address |
|---|---|
| TokenMessengerV2 | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` |
| MessageTransmitterV2 | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` |

Source: [Arc's official contract addresses page](https://docs.arc.io/arc/references/contract-addresses).

### Circle Gateway infrastructure (official — not FlowFi-deployed)

FlowFi's Gateway panel calls Circle's real Gateway Wallet contract directly. The same address is deployed identically across every supported EVM testnet (Arc, Ethereum Sepolia, Base Sepolia, Arbitrum Sepolia, and others) — confirmed live via `GET /v1/info` on Circle's Gateway API:

| Contract | Address |
|---|---|
| Gateway Wallet | `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` |
| Gateway Minter | `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B` |

Source: [Circle Gateway docs](https://developers.circle.com/gateway) and live `gateway-api-testnet.circle.com/v1/info`.

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

All transactions were confirmed successful on their respective explorers as of this writing.

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
# ANTHROPIC_API_KEY=       (server-side only — no VITE_ prefix, or it gets bundled into client-side JS)
# CIRCLE_API_KEY=
# CIRCLE_ENTITY_SECRET=
# DROPSTAB_API_KEY=        (optional — live token unlock data; falls back to the manual list without it)
# ARC_RPC_URL=             (optional — a keyed RPC provider for Arc Testnet; falls back to the public RPC)
# UPSTASH_REDIS_REST_URL=  (optional — shared rate limiting for /api/claude and /api/dropstab;
# UPSTASH_REDIS_REST_TOKEN= rate limiting is off entirely, not approximated, if unset)

npm run dev
```

The app runs on Arc Testnet by default — no mainnet funds are ever involved. Get test USDC from [faucet.circle.com](https://faucet.circle.com).

---

## Testing

Contracts have a Foundry test suite covering the fixes documented in [`SECURITY.md`](./SECURITY.md) — the ArcEscrow refund loophole, ArcSwap's withdrawLiquidity/setRate restrictions, and ArcPool's fee-on-transfer and non-standard-token (USDT-style) handling — plus happy-path coverage for each contract.

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup

forge install foundry-rs/forge-std --no-git --no-commit
forge test -vv
```

CI ([`.github/workflows/ci.yml`](./.github/workflows/ci.yml)) runs this suite plus a frontend type-check (`tsc --noEmit`) on every push and pull request to `main`.

---

## Known Limitations

FlowFi's contracts have been through a manual security review (not a professional third-party audit) — several deliberate design trade-offs came out of that review, documented here rather than hidden:

- **ArcSwap prices the USDC/EURC pair without an oracle.** The exchange rate is owner-set and doesn't read a live price feed. This is a known simplification for the testnet stage — a real oracle (Chainlink/Pyth) is a prerequisite before the contract should touch real funds.
- **ArcFactoryV2 pools have no TWAP.** Spot-price swaps on thin/low-liquidity pools carry real sandwich and price-impact risk, same as any constant-product AMM without time-weighted pricing. Use `minAmountOut` and be mindful of pool depth.
- **Individual ArcPool contracts have no admin kill-switch, by design.** Once a pool exists, `addLiquidity`/`removeLiquidity`/`swap`/`sync()` are fully permissionless — no owner, no pause, for anyone interacting with that pool. That's a deliberate trade-off in favor of trustlessness: adding a pause here would undercut the "no one can freeze your funds" guarantee that matters once you've put liquidity in. **Creating a *new* pool is a different matter** — as of ArcFactoryV2 v4, `createPool()` is `onlyOwner`. FlowFi curates which assets get a pool (USDC, EURC, cirBTC, and similar); this was previously permissionless (v2/v3) but a mainnet-readiness review closed it — see [`SECURITY.md`](./SECURITY.md) for the reasoning.

Security notes (self-review, not an audit): [`./SECURITY.md`](./SECURITY.md)

---

## Roadmap

- [ ] Mainnet deployment (pending a professional third-party security audit)
- [ ] Cross-chain intent engine — extend the CCTP V2 settlement flow to route multi-step actions automatically
- [ ] Native yield routing across liquidity positions, built on the same settlement rail

**Not on the roadmap:** Perpetuals was fully removed (app, Copilot, and frontend code) after a security review found no oracle backs the pricing. A contract from that era is still deployed and verified on Arcscan for historical/audit reference, but there's no plan to rebuild the feature without a real decentralized oracle integration.

---

## Disclaimer

FlowFi runs entirely on Arc Testnet. All tokens are test assets with no monetary value. An earlier Perpetuals contract remains deployed and verified on Arcscan for historical reference — it was fully removed from the app and isn't reachable through the product; if you interact with its bytecode directly, be aware its pricing was client-submitted with no decentralized oracle behind it.
