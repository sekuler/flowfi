# Privacy Policy

Last updated: September 19, 2026

FlowFi is built to need as little of your data as possible. This page lists exactly what's collected, why, and who else sees it.

## What FlowFi collects

- **Wallet address** — whichever address you connect (browser wallet) or, on Testnet only, the address of the Circle Wallet you create. Public blockchain data by nature; not something FlowFi can keep private even if it wanted to.
- **Email address** — only if you use Circle Wallet (**Testnet only** — no real funds involved). Used solely to send a one-time sign-in code and to look up your existing wallet on return visits. Stored via Circle's own infrastructure; see their privacy policy for how they handle it.
- **Transaction/activity data you ask about** — if you ask AI Copilot or the wallet assistant a question about your own activity, your recent on-chain transactions are read (from Arcscan or Etherscan, both public block explorers) and sent to Anthropic's Claude API to generate an answer. This is triggered by your own request each time, not collected continuously in the background.
- **Feedback you submit** — if you use FlowFi's feedback form, whatever you type is stored so it can be reviewed.

## What FlowFi does **not** collect

FlowFi doesn't ask for your name, government ID, physical address, or payment card details for any Testnet or mainnet feature. FlowFi never asks for a seed phrase or private key. Mainnet transactions are signed entirely inside your own wallet — none of that signing data passes through or is stored by FlowFi.

## Third parties that process data on FlowFi's behalf

| Service | What it sees | Why |
|---|---|---|
| Upstash (Redis) | Request metadata, rate-limit counters, short-lived response caches | Prevents abuse of backend endpoints, speeds up repeated requests |
| Anthropic (Claude API) | The specific question you ask Copilot/the wallet assistant, plus the on-chain data needed to answer it | Powers the AI features — nothing is sent unless you actively ask a question |
| Circle | Your email address and wallet activity (**Testnet only**) | Provisions and operates your Circle Developer-Controlled Wallet |
| LI.FI, Relay | Your wallet address and the transaction you're requesting (**Mainnet only**) | These are the actual bridge/swap providers your mainnet transaction routes through |
| CoinGecko, DropsTab | Nothing about you — these are one-way market-data lookups | Powers price/analysis features |

None of these third parties are chosen or controlled by FlowFi beyond the integration itself — each has its own privacy policy governing what it does with data once it has it.

## What FlowFi doesn't do

FlowFi doesn't sell your data, doesn't run advertising, and doesn't use your data for anything beyond making the specific feature you're using work.

## Blockchain data

Wallet addresses and on-chain transactions are inherently public on both Arc Mainnet and Arc Testnet — anyone can look them up on a block explorer regardless of what FlowFi does. This policy only covers what FlowFi itself collects and stores off-chain.

## Your choices

You can stop using Circle Wallet at any time (Testnet only) — sign out removes your session locally. You can disconnect a browser wallet at any time from your wallet extension itself. Deleting your Circle Wallet account requires contacting Circle directly, since FlowFi doesn't hold your underlying account.

## Changes

This policy may be updated as FlowFi changes. Material changes will be reflected here with an updated date.

## Contact

**contact@flowfi.finance**
