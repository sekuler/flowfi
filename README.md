# FlowFi

**Your stablecoin financial layer on Arc.**

FlowFi is an AI-powered financial operating system for Arc, combining payments, swaps, perpetuals, liquidity, and escrow into a single application backed by real on-chain smart contracts. Every feature below is deployed and verifiable — no mocked data, no simulated transactions.

🔗 **Live demo:** [flowfi-arc.vercel.app](https://flowfi-arc.vercel.app)
📦 **GitHub:** [github.com/sekuler/flowfi](https://github.com/sekuler/flowfi)
🎥 **Demo video:** [Watch on X](https://x.com/flowfiarc/status/2078926068485173522)
---

---

## Why FlowFi?

Stablecoin users still rely on multiple disconnected applications for payments, swaps, bridges, derivatives, and escrow. Building on a new L1 usually means starting from zero — no native swap, no escrow, no trading layer, no unified place to hold and move funds.

FlowFi unifies the entire stablecoin experience into a single interface built specifically for Arc — real smart contracts for every primitive, wrapped in a clean UI, with an AI layer that actually executes transactions instead of just chatting about them.

## Screenshots

| Dashboard | Swap |
|---|---|
| ![Dashboard](./screenshots/1-DASHBOARD.png) | ![Swap](./screenshots/2-SWAP.png) |

| AI-Assisted Send | Perpetuals |
|---|---|
| ![Send](./screenshots/3-SEND.png) | ![Perpetuals](./screenshots/4-PERPETUALS.png) |

---

## Features

| Feature | What it does |
|---|---|
| **Portfolio** | USDC, EURC, USYC balances with live USD equivalents, plus unified cross-chain USDC balance across Arc, Ethereum Sepolia, Base Sepolia, and Arbitrum Sepolia |
| **Send** | Natural-language transfers ("send 20 USDC to alice.arc"), ArcNS name resolution, address book |
| **Bridge** | Real CCTP V2 cross-chain USDC transfer — burn/attest/mint via Circle's official TokenMessengerV2, no wrapped tokens |
| **Swap** | On-chain USDC/EURC swap with an AI advisor that reads live pool liquidity and computes a risk score before every trade |
| **Perpetuals** | Long/short BTC and ETH with 1x-20x leverage, live TradingView charts, real-time PNL, liquidation price |
| **Liquidity Pools** | Permissionless AMM factory — anyone can create a pool for any token pair and earn a share of swap fees |
| **Escrow** | Smart-contract-secured freelance payments — funds release only when work is delivered |
| **AI Understands You** | Type transfers in plain English, get swap risk explained before you trade, and ask questions about your wallet history — all answered by AI grounded in your real on-chain data |
| **Dashboard** | Portfolio value, token distribution, weekly volume, recent transactions |

---

## Architecture

```
┌─────────────────────────────────────────────┐
│                  FlowFi UI                    │
│         React + Vite + viem + TypeScript      │
└───────────────────┬───────────────────────────┘
                     │
       ┌─────────────┼─────────────────┐
       │             │                 │
┌──────▼──────┐ ┌────▼─────┐  ┌────────▼────────┐
│  Arc Testnet │ │ Circle    │  │  Claude AI      │
│  Contracts   │ │ CCTP V2   │  │  (transfers,    │
│              │ │ Bridge    │  │  swap advisor,  │
│ ArcSwap      │ │           │  │  wallet Q&A)    │
│ ArcEscrow    │ └───────────┘  └─────────────────┘
│ ArcPerps     │
│ ArcFactory   │
└──────────────┘
```

## Tech Stack

- **Frontend:** React, Vite, TypeScript, viem
- **Smart contracts:** Solidity, deployed on Arc Testnet
- **Bridging:** Circle CCTP V2 (TokenMessengerV2 / MessageTransmitterV2)
- - **AI:** Claude (Anthropic API) — understands natural-language commands, evaluates swap risk before you trade, and explains your wallet history in plain English
- **Charts:** TradingView widget
- **Naming:** ArcNS for human-readable address resolution
- **Hosting:** Vercel

## Deployed Contracts (Arc Testnet)

| Contract | Address | Purpose |
|---|---|---|
| ArcSwap | [`0x6eA72BC31Ed6a6700306aFc92a5165c17230E3e1`](https://testnet.arcscan.app/address/0x6eA72BC31Ed6a6700306aFc92a5165c17230E3e1) | Fixed-rate USDC/EURC swap |
| ArcEscrow | [`0xb1CC6EEE3Ff88ED7F6adde1418455F7DE650Ab75`](https://testnet.arcscan.app/address/0xb1CC6EEE3Ff88ED7F6adde1418455F7DE650Ab75) | Conditional freelance payments |
| ArcPerps | [`0x3B4cE1734087e1c67474Ff42982063febE3E4B20`](https://testnet.arcscan.app/address/0x3B4cE1734087e1c67474Ff42982063febE3E4B20) | Leveraged BTC/ETH trading |
| ArcFactory | [`0x7B68AbA7C610aC8Edd46846c6Aa663b86f1165d9`](https://testnet.arcscan.app/address/0x7B68AbA7C610aC8Edd46846c6Aa663b86f1165d9) | Permissionless AMM pool creation |



All contract addresses and transaction history are verifiable on [Arc Testnet Explorer](https://testnet.arcscan.app).

---

## Roadmap

- Circle Developer-Controlled Wallets for seed-phrase-free onboarding
- Lending & borrowing markets on top of the AMM factory
- Decentralized price oracle for Perpetuals
- Mainnet-track hardening (audits, production wallet security)

---

## Running Locally

```bash
npm install
npm run dev
```

Requires a `.env` file with `VITE_ANTHROPIC_KEY` for AI features.

---

Built for the [Encode Club x Circle Programmable Money Hackathon](https://www.encodeclub.com/programmes/arc-hackathon).
