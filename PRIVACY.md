# Privacy Policy

Last updated: September 30, 2026

FlowFi is built to need as little of your data as possible. This page lists exactly what's collected, why, and who else sees it.

## What FlowFi collects

- **Wallet address** — whichever address you connect (browser wallet), or the address of the Circle Wallet created for you. Public blockchain data by nature; not something FlowFi can keep private even if it wanted to.
- **Email address** — only if you use Circle Wallet (Arc Mainnet or Testnet). Used to send you a one-time sign-in code and to find your wallet when you sign in again. FlowFi stores the email together with your Circle wallet IDs and addresses in its backend database (Upstash Redis), sends the code through Resend, and keeps a sign-in session cookie in your browser. Sign-in codes expire after 10 minutes.
- **Transaction/activity data you ask about** — if you ask AI Copilot or the wallet assistant a question about your own activity, your recent on-chain transactions are read (from Arcscan or Etherscan, both public block explorers) and sent to Anthropic's Claude API to generate an answer. This is triggered by your own request each time, not collected continuously in the background.
- **Rate-limit data** — your IP address is used briefly as a counter key to stop abuse of FlowFi's backend. It is not linked to your wallet or email.

## What FlowFi does **not** collect

FlowFi doesn't ask for your name, government ID, physical address, or payment card details for any Testnet or mainnet feature. FlowFi never asks for a seed phrase or private key. Browser-wallet transactions are signed entirely inside your own wallet — none of that signing data passes through or is stored by FlowFi. Circle Wallet transactions are requested by FlowFi's server from Circle when you ask for them.

## Third parties that process data on FlowFi's behalf

| Service | What it sees | Why |
|---|---|---|
| Upstash (Redis) | Rate-limit counters, short-lived response caches, and for Circle Wallet users: email, wallet IDs/addresses and pending sign-in codes | Prevents abuse of backend endpoints, speeds up repeated requests, remembers which wallet belongs to which email |
| Resend | Your email address and the one-time code | Delivers Circle Wallet sign-in codes |
| Anthropic (Claude API) | The specific question you ask Copilot/the wallet assistant, plus the on-chain data needed to answer it | Powers the AI features — nothing is sent unless you actively ask a question |
| Circle | Your Circle Wallet addresses and activity, and Gateway/CCTP transfer details | Operates Circle Wallet, Gateway and CCTP transfers |
| LI.FI, Relay | Your wallet address and the transaction you're requesting (**Mainnet only**) | These are the actual bridge/swap providers your mainnet transaction routes through |
| Morpho | Your wallet address (read from public data) | Vault and market data for Earn & Borrow |
| CoinGecko, DropsTab | Nothing about you — these are one-way market-data lookups | Powers price/analysis features |

None of these third parties are chosen or controlled by FlowFi beyond the integration itself — each has its own privacy policy governing what it does with data once it has it.

## What FlowFi doesn't do

FlowFi doesn't sell your data, doesn't run advertising, and doesn't use your data for anything beyond making the specific feature you're using work.

## Blockchain data

Wallet addresses and on-chain transactions are inherently public on both Arc Mainnet and Arc Testnet — anyone can look them up on a block explorer regardless of what FlowFi does. This policy only covers what FlowFi itself collects and stores off-chain.

## Your choices

You can stop using Circle Wallet at any time: withdraw your funds to your own wallet, then sign out. To have your email and wallet record deleted from FlowFi's database, email **contact@flowfi.finance** from that address (withdraw your funds first; after deletion you can no longer sign in to that wallet). You can disconnect a browser wallet at any time from your wallet extension itself.

## Changes

This policy may be updated as FlowFi changes. Material changes will be reflected here with an updated date.

## Contact

**contact@flowfi.finance**
