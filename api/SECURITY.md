# Security notes

Manual review by the project's own developer — not a certified third-party audit. Not a substitute for professional audit before mainnet or real-funds use.

## Contracts reviewed and redeployed

All addresses below are live on Arc Testnet and verified on [Arcscan](https://testnet.arcscan.app).

| Contract | Address | What changed |
|---|---|---|
| ArcSwap v2 | `0x13bD5D32509bC5D03811B3e5F86952a8C2BD0521` | Added `minAmountOut` slippage protection (previously none — owner rate change had zero recourse for the user). Added `pause()`. Added two-step ownership transfer. |
| ArcLending v2 | `0x5d52D4c13FBEBB7FCd4852bD4876D2A12a7B100a` | Added a guardian role that can pause new `borrow()` only — supply/withdraw/repay/liquidate stay open. Fixed checks-effects-interactions ordering in several functions. |
| ArcFactoryV2 v2 | `0x23782643650D73b2Bb145B9145D62D743bF25CB0` | Added `nonReentrant` guards on `addLiquidity`/`removeLiquidity`/`swap` — this factory is permissionless, so a malicious token with reentrant hooks was a real risk. Restored `MINIMUM_SHARES` first-depositor protection that had been dropped from the original version. |
| ArcEscrow v3 | `0xCe6c2B0EAbC86974c653020467c05Ce5e1eB418C` | Added a 7-day timeout so a freelancer can claim funds if a client goes unresponsive after work is submitted. Added `pause()` scoped only to blocking new escrow creation. |

Live transaction proof for these flows (bridge, Circle Wallet execution, lending) is in the main [README](./README.md#verified-receipts--real-transaction-hashes).

## Not fixed, by design

**ArcPerps** — `entryPrice`/`exitPrice` are submitted directly by the caller with no oracle validating them; a position can be opened and closed at self-declared prices. Rather than a partial fix, this was removed from the app's navigation and from the AI Copilot's action set entirely (verified: no `"perps"` reference remains in `App.tsx`, no `perp_open` action in Copilot's schema). The contract and its source stay in the repo for reference, but nothing in the product can reach it.

**ArcLending's peg assumption** — the contract assumes USDC and EURC hold their ~$1 peg; there's no live price oracle. A real depeg event would break the liquidation math. This is a design limitation, not something patched — a real oracle is a prerequisite before this contract should hold real funds.

## Deliberately small surface, not separately audited

**ArcTokenFactory** — I didn't find an owner-controlled mint, pause, or upgrade path; each token mints once at deploy time. No separate code change made.

**ArcAMM (legacy)** — only ever touches the two known, trusted tokens (USDC/EURC) rather than arbitrary ones, unlike the permissionless factories above. No separate code change made.

## Backend finding (not a contract, found in a follow-up review)

`api/circle-wallet.js`'s `contractCall` action accepted any `contractAddress` and `abiFunctionSignature` from the request body with no restriction — anyone who obtained a wallet ID could have had the backend execute an arbitrary call on that wallet's behalf. Fixed with an explicit allowlist (`ALLOWED_CONTRACTS` in that file) covering only the specific contracts FlowFi's integration is meant to call — USDC/EURC per chain, ArcSwap, CCTP's TokenMessengerV2/MessageTransmitterV2, and Circle Gateway's Wallet/Minter contracts. Any other address is rejected with a 403 before it reaches Circle's API.

Lending, Liquidity Pools, and Escrow aren't in that list because none of them are currently callable through Circle Wallet at all — Lending and Liquidity Pools only execute via a connected browser wallet, and Escrow isn't wired into the app's UI. The allowlist covers exactly what's reachable today, not a superset.
