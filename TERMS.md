# Terms of Use

Last updated: September 30, 2026

This is a plain-English summary of how FlowFi works and what you're agreeing to by using it. It isn't a substitute for reading it carefully, and it isn't legal advice — if anything here matters to you materially, talk to your own lawyer.

## What FlowFi is

FlowFi is a **frontend and router**, not a bank, exchange, or counterparty to any trade.

- **Arc Mainnet features with a browser wallet** (Bridge, Swap, Earn & Borrow, Gateway, Dashboard, History, the mainnet AI Copilot) move real funds. These transactions are signed by **your own connected wallet** — FlowFi never holds its keys and never takes the other side of a trade. Bridge and Swap route through third-party infrastructure (**LI.FI**, **Relay** and **Circle's CCTP**) that FlowFi does not operate, own, or control. Their terms and conduct are their own, not FlowFi's.
- **Circle Wallet on Arc Mainnet** is different; see "Circle Wallet" below.
- **Arc Testnet features** (Token Launch, Liquidity Pools, the testnet Circle Wallet, Bridge and Gateway) use test assets with **no monetary value**. They exist to demonstrate FlowFi's own contracts and product ideas — nothing there involves real money.

## Circle Wallet (Arc Mainnet)

Circle Wallet is an optional email-based wallet built on **Circle's Developer-Controlled Wallets**. Please read this before using it:

- **Who controls the wallet.** The wallet's key is secured by Circle and never shown to you or to FlowFi. As the app developer, FlowFi controls the wallet through Circle's API: FlowFi's server uses that control only when you request an action while signed in with your email, and only for a fixed list of allowed actions. This is not self-custody.
- **Your email is your login.** Anyone who can read your email can sign in to your Circle Wallet. Keep your email account secure.
- **Holding limit.** Each account has a holding limit (by default $100 in USDC, EURC and cirBTC combined). While your balance is above the limit, every action except withdrawal is paused. The limit does not stop funds from arriving.
- **Withdrawals.** You can withdraw supported tokens to your own external wallet at any time, including after new sign-ups are closed. Network fees apply.
- **The feature may end.** FlowFi may stop offering Circle Wallet, close new sign-ups, or switch it to withdraw-only. If that happens, withdrawal stays available so you can move your funds out.
- **Availability.** FlowFi depends on Circle's service to operate these wallets. If Circle's service is unavailable, actions and withdrawals may be delayed.

## No investment advice

Nothing on FlowFi — including AI Copilot's summaries, market analysis, or any suggested action — is investment, financial, tax, or legal advice, and none of it is a recommendation to buy, sell, or hold anything. You are solely responsible for your own decisions.

## Third-party services

FlowFi integrates services it doesn't operate: LI.FI and Relay (mainnet routing), Circle (Circle Wallet, CCTP, Gateway), Morpho (Earn & Borrow), CoinGecko and DropsTab (market data), Anthropic (the AI models behind Copilot and market analysis), Resend (sign-in code emails), and Upstash (backend storage, caching and rate-limiting). Each has its own terms, and FlowFi isn't responsible for their availability, accuracy, or conduct.

## Your responsibility

You're responsible for: using the correct network (mainnet vs. testnet — they are **not interchangeable**, and sending real funds to a testnet address or vice versa cannot be reversed by FlowFi), verifying transaction details before confirming them in your wallet, and keeping your own wallet and email account secure. FlowFi cannot reverse, refund, or recover a transaction once it's confirmed on-chain.

## No warranty, limitation of liability

FlowFi is provided "as is," without warranties of any kind. FlowFi's own Testnet smart contracts have had a manual security self-review (see [SECURITY.md](./SECURITY.md)) but no professional third-party audit. To the maximum extent permitted by law, FlowFi and its developer aren't liable for any loss arising from your use of the app, including losses from smart contract bugs, third-party service failures, network congestion, or user error.

## Eligibility

You must be legally permitted to use cryptocurrency-related services in your jurisdiction. It's your responsibility to determine whether your local laws restrict or prohibit your use of FlowFi.

## Earn & Borrow (Morpho)

FlowFi's Earn & Borrow features use the Morpho protocol and third-party vaults curated by independent curators (such as Galaxy, Keyrock, Steakhouse and Gauntlet). FlowFi does not operate these vaults or markets and never holds your funds; every deposit, withdrawal, borrow and repayment is signed by your own wallet.

- Vault returns are variable and not guaranteed. Vault funds are lent out, so withdrawals can be temporarily limited when a market is heavily borrowed.
- Borrowing against cirBTC carries liquidation risk. If the value of your collateral falls and your loan-to-value reaches the market's liquidation threshold (86%), part or all of your collateral can be sold to repay the loan. FlowFi caps new borrows at a lower 70% LTV as a safety buffer, but this does not remove the risk.
- Borrow rates are variable and can rise sharply when a market is nearly fully borrowed.
- Smart contracts, oracles and third-party protocols can fail or be exploited.

By using Earn & Borrow you accept these risks and Morpho's own terms and disclaimers: https://morpho.org/disclaimers/

## Changes

These terms may be updated as FlowFi changes. Material changes will be reflected here with an updated date.

## Contact

**contact@flowfi.finance**
