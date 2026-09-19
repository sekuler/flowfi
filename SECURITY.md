# Security notes

## Reporting a vulnerability

Found a security issue? Email **contact@flowfi.finance** with what you found and, if possible, how to reproduce it. Please don't open a public GitHub issue for anything that could put real funds at risk — give a reasonable window to fix it before any public disclosure. This is a solo-developer project without a formal bug bounty budget right now, but every genuine report gets read and taken seriously.

Self-review by the project's own developer. No third-party audit of FlowFi's own Testnet contracts. Every `onlyOwner` Testnet contract's owner is a 2-of-3 Safe multisig, not a single wallet — see "Ownership" below.

## Mainnet trust model — why real funds never touch a FlowFi contract

FlowFi runs two genuinely different environments, and the reasoning for splitting them belongs here, not just in the README:

**Testnet** — FlowFi's own contracts (ArcSwap, the Pool Factories, Token Factory, Escrow) hold test USDC/EURC with zero monetary value. They've had a manual security review (this document), not a professional third-party audit — an honest gap, and exactly why nothing here holds real money.

**Mainnet (Arc Mainnet, live funds)** — deliberately does not run any FlowFi contract at all. Bridge and Swap route through LI.FI and Relay, two aggregators that were already live, already handling real volume, before FlowFi integrated them — FlowFi never becomes a counterparty to the trade, and every transaction is signed by the user's own connected browser wallet. FlowFi holds no private key, no custody, no hot wallet, and no signing authority over any mainnet transaction. Dashboard reads balances and activity straight from Arc's own official explorer (`arc.etherscan.io`) — again, no FlowFi-side custody or bookkeeping of user funds.

This wasn't the original plan. Circle Wallet — FlowFi's seedless, email-based wallet — was built and works, and Circle's own console confirms Arc Mainnet wallet creation is technically available today. It's deliberately not turned on for real funds: a custodial wallet, where FlowFi's backend briefly holds signing authority over a user's key (even one Circle itself never exports to anyone, including FlowFi), is a regulated activity in a growing number of jurisdictions — including Türkiye, where 7518 sayılı Kanun (in force since July 2024) brought "kripto varlıklara ilişkin cüzdandan transfer hakkı sağlayan özel anahtarların saklanması ve yönetimi" and crypto transfer/exchange services under SPK licensing, with both administrative and criminal penalties for operating unlicensed. Rather than push a working feature to production ahead of the licensing question being resolved, Circle Wallet, Token Launch, and Liquidity Pools all stay on Testnet — fully built, fully demonstrable, zero monetary value, zero licensing exposure — until that's sorted out properly.

Net effect: the smallest, least-audited part of this codebase (FlowFi's own Solidity) is exactly the part that never handles real money. The part that does handle real money (Bridge/Swap/Dashboard) is a thin, self-custodial frontend over infrastructure that isn't FlowFi's to audit in the first place.

## Deprecated — live on-chain, unreachable from the app

An auditor scoping this repo should treat these as **out of scope for the live product**, but they're real, verified, deployed contracts — not hypothetical. No UI, no Copilot action, no route in this app can reach either of them; interaction is only possible by calling the contract directly (Arcscan's "Write Contract" tab or similar).

| Contract | Address | Why it's out of scope |
|---|---|---|
| ArcLending v2 | `0x5d52D4c13FBEBB7FCd4852bD4876D2A12a7B100a` | No price oracle — assumes USDC/EURC hold peg. Removed from the app's navigation and Copilot action set entirely. No test coverage (the feature was retired before a dedicated test file was written for it). |
| ArcPerps | `0x3B4cE1734087e1c67474Ff42982063febE3E4B20` | `entryPrice`/`exitPrice` are caller-declared, no oracle. Removed from the app the same way as Lending; `Perpetuals.tsx`/`PnlHistory.tsx` were deleted outright, not just unlinked. |

Full detail on both is under "Not fixed, by design" below.

## Ownership

Every `onlyOwner` contract in the table below — ArcSwap v5 and all four Pool Factory versions (v4, v4b, v4c; v2/v3 predate the `onlyOwner` restriction) — is owned by a 2-of-3 Safe multisig (`0xa50FFedfC93eDB81F8Bcc23507db8aDdE7EE8Be0` on Arc Testnet), not a single EOA. A single compromised key can no longer call `createPool()`, `setRate()`, `pause()`, or transfer ownership again on any of these.

One exception, by design: `ArcLaunchPoolFactory` (see [`contracts/README.md`](./contracts/README.md)) has no owner at all — `createLaunchPool()` is permissionless for anyone, gated only by the target token actually being one minted through Token Factory. This isn't an oversight; it's the whole point of that contract (new token creators shouldn't need the Safe's approval to get a pool). It has not been through the same review pass as the contracts below.

## Contracts reviewed and redeployed

All addresses below are live on Arc Testnet and verified on [Arcscan](https://testnet.arcscan.app).

| Contract | Address | What changed |
|---|---|---|
| ArcSwap v5 | `0x3CD201DA3DdDF2d0E9fcBC606a32E821099dEAC1` | Added `minAmountOut` slippage protection (previously none — owner rate change had zero recourse for the user). Added `pause()`. Added two-step ownership transfer. **v5:** `withdrawLiquidity` now only accepts USDC/EURC (previously any token address); `setRate` now caps each call to a 10% move (previously any value > 0 was accepted in one shot). The prior v2 deployment (`0x13bD5D32509bC5D03811B3e5F86952a8C2BD0521`) has both issues and should not be used or referenced going forward. |
| ArcLending v2 | `0x5d52D4c13FBEBB7FCd4852bD4876D2A12a7B100a` | Added a guardian role that can pause new `borrow()` only — supply/withdraw/repay/liquidate stay open. Fixed checks-effects-interactions ordering in several functions. |
| ArcFactoryV2 v2 *(legacy, still live — see v4 below)* | `0x23782643650D73b2Bb145B9145D62D743bF25CB0` | Added `nonReentrant` guards on `addLiquidity`/`removeLiquidity`/`swap` — this factory is permissionless, so a malicious token with reentrant hooks was a real risk. Restored `MINIMUM_SHARES` first-depositor protection that had been dropped from the original version. |
| ArcFactoryV2 v3 *(legacy, still live — see v4 below)* | `0x5ee0c6cc6879728a4835826D87b28702f8993559` | Reserves are now derived from `balanceOf()` deltas around transfers instead of the nominal amount requested — a fee-on-transfer token delivering less than requested no longer permanently overstates reserves. Added `sync()`, callable by anyone, which pulls reserves back down to the pool's real balance (never up) — protects against a token whose balance can drop with no transfer at all (a rebase token, or an unanticipated fee/burn mechanic), so the pool can't become permanently stuck paying out more than it holds. Switched every transfer to a `SafeERC20`-style call, so a non-standard token (USDT-style, no return value) no longer makes every call revert outright. Added a `deadline` parameter to `addLiquidity`/`removeLiquidity`/`swap`. |
| ArcFactoryV2 v4 | `0x57B451D60F09222C2bb6c828FFE3703069A532Ed` | `createPool()` was permissionless on v2 and v3 — technically anyone could call it directly against the contract, even though FlowFi's own UI never exposed a "create pool" button. That gap is closed at the contract level now: `createPool()` is `onlyOwner`, with the same two-step ownership-transfer pattern as ArcSwap. This only restricts who can open a *new* pool — `addLiquidity`/`removeLiquidity`/`swap`/`sync()` on any pool (existing or new) stay open to everyone, exactly as before. **Superseded by v4b, then v4c below — this version is now legacy**, kept only so liquidity already sitting in its pools stays visible/withdrawable. |
| ArcFactoryV2 v4b | `0xa42c3bDcd385350880165120fE7E72e43733f70B` | Same `onlyOwner` `createPool()` as v4. Legacy for the same reason — superseded by v4c. |
| ArcFactoryV2 v4c | `0xD2dC496dcf4e6D8c9CFc710AC5C9A6Dc941CBbB0` | **This is the current factory — new pools are actually created here, not on v4.** Same `onlyOwner` `createPool()`, plus `addLiquidity` gained slippage protection (`amountAMin`/`amountBMin`) over v4/v4b: it now pulls only the ratio-matching amount instead of the full desired amount, so excess tokens are no longer silently donated to the pool. |
| ArcEscrow v4 | `0xDDDe5a4E691F6ce6826CB85F09466E799FCFabfB` | Added a 7-day timeout so a freelancer can claim funds if a client goes unresponsive after work is submitted. Added `pause()` scoped only to blocking new escrow creation. **v4:** closed a refund loophole — `refund()` previously allowed the client to refund themselves even after work was `Submitted`, silently defeating the timeout protection above; refund is now only valid before submission. The prior v3 deployment (`0xCe6c2B0EAbC86974c653020467c05Ce5e1eB418C`) has this bug and should not be used or referenced going forward. |

Live transaction proof for these flows (bridge, Circle Wallet execution) is in the main [README](./README.md#verified-receipts--real-transaction-hashes).

## Not fixed, by design

**ArcPerps** — `entryPrice`/`exitPrice` are submitted directly by the caller with no oracle validating them; a position can be opened and closed at self-declared prices. Rather than a partial fix, this was removed from the app's navigation and from the AI Copilot's action set entirely, and — as of this writing — the `Perpetuals.tsx` and `PnlHistory.tsx` React components have also been deleted outright (previously kept as unreachable reference code; now fully removed, same treatment as Lending). The deployed contract is still live and verified on Arcscan at `0x3B4cE1734087e1c67474Ff42982063febE3E4B20` for historical/audit reference, but nothing in the product can reach it and no frontend code references it anymore.

**ArcLending's peg assumption** — the contract assumes USDC and EURC hold their ~$1 peg; there's no live price oracle. A real depeg event would break the liquidation math. This is a design limitation, not something patched — a real oracle is a prerequisite before this contract should hold real funds. As of this writing, Lending has also been removed from the app's navigation and the AI Copilot's action set entirely — same treatment as ArcPerps below. The deployed contract is still live and verified on Arcscan, but nothing in the product can reach it.

## Deliberately small surface, not separately audited

**ArcTokenFactory** — I didn't find an owner-controlled mint, pause, or upgrade path; each token mints once at deploy time. No separate code change made.

**ArcAMM (legacy)** — only ever touches the two known, trusted tokens (USDC/EURC) rather than arbitrary ones, unlike the permissionless factories above. No separate code change made.

## Backend findings

`api/circle-wallet.js`'s `contractCall` action accepted any `contractAddress` and `abiFunctionSignature` from the request body with no restriction — anyone who obtained a wallet ID could have had the backend execute an arbitrary call on that wallet's behalf. Fixed with an explicit allowlist (`ALLOWED_CALLS` in that file) covering only the specific contracts FlowFi's integration is meant to call — USDC/EURC per chain, ArcSwap, CCTP's TokenMessengerV2/MessageTransmitterV2, and Circle Gateway's Wallet/Minter contracts. Any other address is rejected with a 403 before it reaches Circle's API. This file's `BRIDGE_CHAINS` list is Testnet-only by design — Circle Wallet is never provisioned on any mainnet chain (see "Mainnet trust model" above), so this backend never handles real funds regardless of what's in the allowlist.

Liquidity Pools and Escrow aren't in that allowlist because neither is currently callable through Circle Wallet at all — Liquidity Pools only executes via a connected browser wallet, and Escrow isn't wired into the app's UI. Lending has been removed from the app entirely (see "Not fixed, by design" above) and was never in this allowlist either. The allowlist covers exactly what's reachable today, not a superset.

`api/rpc-proxy.js` and `api/arcscan-proxy.js` both proxy read-mostly RPC/explorer traffic server-side (their own network doesn't return CORS headers for browser calls) and now serve both Testnet and Arc Mainnet through the same method allowlist and per-IP rate limiting — an opt-in `network=mainnet` query param routes to Arc's official mainnet RPC / Etherscan's `arc.etherscan.io` API instead of the Testnet endpoints, nothing else about the allowlist or rate limiting changes between the two.
