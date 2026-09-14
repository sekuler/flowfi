# FlowFi

Native USDC on Arc: Circle Wallet, Gateway unified balance, CCTP V2.

**App:** [flowfi.finance](https://flowfi.finance) · **Repo:** [github.com/sekuler/flowfi](https://github.com/sekuler/flowfi)

One loop: connect a wallet → check your balance → swap or move cross-chain.

| | |
|---|---|
| **Circle Wallet** | Seedless — sign in with email |
| **Gateway** | One USDC balance across 4 chains |
| **CCTP V2** | Official burn/attest/mint |
| **Safe 2-of-3** | Owns every privileged contract |

[![CI](https://github.com/sekuler/flowfi/actions/workflows/ci.yml/badge.svg)](https://github.com/sekuler/flowfi/actions/workflows/ci.yml)

> **Testnet.** Everything below runs on Arc Testnet with testnet USDC/EURC — no real funds are involved. Mainnet transition is in progress; see [SECURITY.md](./SECURITY.md) for what's still open before that happens.

---

## What's inside

| Feature | What it does |
|---|---|
| **Circle Wallet** | FlowFi provisions a Developer-Controlled Wallet and tracks its per-chain wallet IDs — no seed phrase, no browser extension, one consistent address surfaced across all four supported chains. Can be used as your only login, or alongside a browser wallet |
| **Bridge & Gateway** | One page, two modes. Bridge: genuine cross-chain USDC transfer via Circle's official burn/attest/mint CCTP V2 protocol — Arc, Ethereum Sepolia, Base Sepolia, Arbitrum Sepolia. Gateway: a unified USDC balance via Circle's Gateway protocol — deposit once, held as one pooled balance instead of four separate on-chain balances. Both work from either a browser wallet or the Circle Wallet |
| **Smart Swap** | USDC ⇄ EURC with an AI advisor that reads real pool liquidity and warns before a swap moves the price too much |
| **Permissionless Token Launch** | Deploy your own ERC-20 on Arc and open its own trading pool immediately — no waiting on anyone's approval, scoped so it never touches the curated pools' security model |
| **Liquidity Pools** | Testnet-only showcase pool (USDC/EURC) demonstrating the swap rail — anyone can add/remove liquidity or swap against it. Not FlowFi's mainnet product surface; mainnet swaps route to external liquidity instead |
| **Stablecoin Analytics** | Live, on-chain TVL and distribution across every FlowFi contract |
| **AI Copilot** | Type what you want — "swap 10 USDC to EURC", "send 20 USDC to 0x..." — Copilot parses it and executes the on-chain transaction. An interface over the settlement rail above, not the product itself |
| **AI Market Analysis** | Ask "analyze BTC" or "analyze Morpho" and get real technical analysis (RSI, EMA, MACD, pivot support/resistance across 1H/4H/1D/1W/1M) and tokenomics/unlock data — all numbers computed server-side from live data, with the AI only writing the interpretive summary, never the figures |

---

## Smart contracts (Arc Testnet)

The live product surface only — every `onlyOwner` contract here is owned by a 2-of-3 Safe multisig (`0xa50FFedfC93eDB81F8Bcc23507db8aDdE7EE8Be0`), not a single wallet. Superseded/legacy versions (still live on-chain, no longer where the app sends traffic) are documented separately in [`contracts/LEGACY.md`](./contracts/LEGACY.md), not deleted from the record.

| Contract | Address |
|---|---|
| Pool Factory v4c *(current — where new pools actually get created)* | `0xD2dC496dcf4e6D8c9CFc710AC5C9A6Dc941CBbB0` |
| Launch Pool Factory *(permissionless, but only for tokens minted through Token Factory below — see [`contracts/README.md`](./contracts/README.md); not yet independently reviewed)* | `0x2b3B2E69C14DA2558E3ce6e2d58c04b2147E5ec0` |
| Token Factory (v2) | `0x1Fe800a2663988C043e4a9A393651f18Cd49D998` |
| Escrow v4 *(deployed and verified, not yet wired to the app)* | `0xDDDe5a4E691F6ce6826CB85F09466E799FCFabfB` |
| USDC (Arc native) | `0x3600000000000000000000000000000000000000` |
| EURC | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` |
| CCTP V2 TokenMessengerV2 *(Circle-official)* | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` |
| CCTP V2 MessageTransmitterV2 *(Circle-official)* | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` |
| Gateway Wallet *(Circle-official)* | `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` |
| Gateway Minter *(Circle-official)* | `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B` |

All verified and viewable on [Arcscan](https://testnet.arcscan.app). Full security review: [`SECURITY.md`](./SECURITY.md). CCTP/Gateway addresses confirmed against [Arc's official contract addresses page](https://docs.arc.io/arc/references/contract-addresses) and [Circle Gateway docs](https://developers.circle.com/gateway).

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

All transactions were confirmed successful on their respective explorers as of this writing. See [`docs/demo.md`](./docs/demo.md) for a full walkthrough.

---

## Why Arc?

FlowFi is designed around stablecoins, not speculation.

Being honest about it: CCTP V2 and Circle Developer-Controlled Wallets aren't Arc-exclusive — they work on other supported EVM chains too. What's actually Arc-specific is what happens after funds arrive. USDC is Arc's native gas asset, not a wrapped placeholder bolted onto a general-purpose chain — so cross-chain USDC becomes immediately productive the moment it lands, with no synthetic-asset discount and no "why is gas a random token" friction to explain away.

FlowFi is built around that arrival point — bridging, swaps, and token tools all settle through the same native-USDC rail, instead of being stitched together across incompatible chains and bridge providers.

There's a second, independent reason Arc specifically: it runs on Malachite, a consensus engine built for sub-second deterministic finality — once a transaction confirms, it's final, no reorg risk. That's not a Circle-product claim that applies elsewhere; it's Arc's own chain-level property, and it's why FlowFi doesn't need to hedge language like "should be confirmed" around settlement.

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
| **Home** | ![Landing](./screenshots/1%20-%20Landing.png) |
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

FlowFi's contracts have been through a manual security review, not a professional third-party audit. Deliberate design trade-offs from that review (no oracle on ArcSwap's pricing, no TWAP on pools, no admin kill-switch on individual pools by design) are documented in full — not hidden — in [`SECURITY.md`](./SECURITY.md).

---

## Roadmap

- [ ] Mainnet deployment (pending a professional third-party security audit)
- [ ] Cross-chain intent engine — extend the CCTP V2 settlement flow to route multi-step actions automatically
- [ ] Native yield routing across liquidity positions, built on the same settlement rail

**Not on the roadmap:** Perpetuals was fully removed (app, Copilot, and frontend code) after a security review found no oracle backs the pricing. A contract from that era is still deployed and verified on Arcscan for historical/audit reference, but there's no plan to rebuild the feature without a real decentralized oracle integration.

---

## Disclaimer

FlowFi runs entirely on Arc Testnet. All tokens are test assets with no monetary value. An earlier Perpetuals contract remains deployed and verified on Arcscan for historical reference — it was fully removed from the app and isn't reachable through the product; if you interact with its bytecode directly, be aware its pricing was client-submitted with no decentralized oracle behind it.
