# FlowFi

**AI-powered Stablecoin Operating System**

Payments. Bridge. Swaps. Perpetuals. Lending. Token Launch.
All inside one application — built natively for [Arc](https://www.arc.io), Circle's stablecoin-native Layer-1.

---

## Why FlowFi is different

- ✓ **No wrapped USDC** — every balance is native, on the chain it lives on
- ✓ **Real CCTP V2** — Circle's actual burn/attest/mint protocol, not a synthetic bridge
- ✓ **AI executes transactions** — natural language in, signed on-chain transaction out
- ✓ **Permissionless liquidity pools** — anyone can create a pool for any token pair
- ✓ **On-chain perpetuals** — leveraged BTC/ETH trading with live PnL, fully on-chain state
- ✓ **Seedless wallets** — Circle Developer-Controlled Wallets, no browser extension required
- ✓ **Built specifically for Arc** — not a multi-chain app with Arc bolted on

---

## By the numbers

| | |
|---|---|
| **7** verified smart contracts | **5** financial primitives |
| **4** supported chains | **20x** max leverage |
| **100%** on-chain execution | **1** address across all 4 chains |

---

## Why Arc?

FlowFi is designed around stablecoins, not speculation.

Arc provides native stablecoin infrastructure, first-party Circle integrations (CCTP, Developer-Controlled Wallets, USDC as gas), and a clean developer experience that lets financial primitives — swaps, lending, perpetuals, escrow — live in a single coherent ecosystem instead of being stitched together across incompatible chains.

Building on Arc means FlowFi never has to explain away a bridge risk, a wrapped-asset discount, or a "why is gas paid in a random token" question. USDC is the base layer, not an afterthought.

---

## What's inside

| Feature | What it does |
|---|---|
| **AI Copilot** | Type what you want — "swap 10 USDC to EURC", "open a 5x BTC long" — Copilot parses it and executes the on-chain transaction |
| **Smart Swap** | USDC ⇄ EURC with an AI advisor that reads real pool liquidity and warns before a swap moves the price too much |
| **Bridge (CCTP V2)** | Genuine cross-chain USDC transfer via Circle's official burn/attest/mint protocol — Arc, Ethereum Sepolia, Base Sepolia, Arbitrum Sepolia |
| **Perpetuals** | Long/short BTC and ETH up to 20x leverage, live pricing, on-chain PnL and liquidation tracking |
| **Lending & Borrowing** | Supply USDC to earn interest, or post EURC as collateral to borrow — 75% max LTV, liquidation at 85% |
| **Liquidity Pools** | Permissionless AMM — create a pool for any token pair, add/remove liquidity, swap directly against it |
| **Token Launch** | Deploy your own ERC-20 on Arc and pair it with liquidity in one flow |
| **Circle Wallet** | Create a wallet with no seed phrase and no browser extension — one address, works across all four supported chains |
| **Stablecoin Analytics** | Live, on-chain TVL and distribution across every FlowFi contract |

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
| **Landing** | ![Landing](./screenshots/1-LANDING.png) |
| **Home** | ![Home](./screenshots/2-HOME.png) |
| **Dashboard** | ![Dashboard](./screenshots/3-DASHBOARD.png) |
| **Portfolio** | ![Portfolio](./screenshots/4-PORTFOLIO.png) |
| **Swap** | ![Swap](./screenshots/5-SWAP.png) |
| **Bridge** | ![Bridge](./screenshots/6-BRIDGE.png) |
| **Send** | ![Send](./screenshots/7-SEND.png) |
| **Lending** | ![Lending](./screenshots/8-LENDING.png) |
| **Perpetuals** | ![Perpetuals](./screenshots/9-PERPETUALS.png) |
| **Token Launch** | ![Token Launch](./screenshots/10-TOKENLAUNCH.png) |
| **Liquidity Pools** | ![Liquidity Pools](./screenshots/11-LIQUIDITYPOOLS.png) |
| **Circle Wallet** | ![Circle Wallet](./screenshots/12-CIRCLEWALLET.png) |
| **History** | ![History](./screenshots/13-HISTORY.png) |

---

## Smart contracts (Arc Testnet)

| Contract | Address |
|---|---|
| Swap (fixed-rate USDC/EURC) | `0x6eA72BC31Ed6a6700306aFc92a5165c17230E3e1` |
| Lending | `0xD3e0171CaCd799E49155eE48981841E9a9d225ab` |
| Perpetuals | `0x3B4cE1734087e1c67474Ff42982063febE3E4B20` |
| Pool Factory (permissionless AMM) | `0xE610D2f76547c2a3073e1273E7BFA80d395eCDf8` |
| Token Factory | `0x481E8919f79A4DA6446EA78cEa70037acB9c85A1` |
| USDC (Arc native) | `0x3600000000000000000000000000000000000000` |
| EURC | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` |

All contracts are verified and viewable on [Arcscan](https://testnet.arcscan.app).

---

## Tech stack

- **Frontend** — React, TypeScript, Vite
- **Chain interaction** — [viem](https://viem.sh)
- **Wallets** — EIP-6963 (MetaMask, Rabby, etc.) and Circle Developer-Controlled Wallets
- **Bridging** — Circle CCTP V2
- **AI** — Claude Sonnet, used for natural-language transaction parsing and swap risk analysis
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

## Roadmap

- [ ] Mainnet deployment
- [ ] Mobile app
- [ ] Cross-chain intent engine
- [ ] Oracle-backed perpetuals pricing (currently client-submitted, testnet-only)
- [ ] Wallet abstraction / account abstraction support
- [ ] Expanded permissionless pool tooling (concentrated liquidity)
- [ ] Native yield routing across lending and liquidity positions

---

## Disclaimer

FlowFi runs entirely on Arc Testnet. All tokens are test assets with no monetary value. Perpetuals pricing is submitted client-side for demo purposes and is **not** sourced from a decentralized oracle — do not use this for anything beyond testnet exploration.
