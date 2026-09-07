# Security notes

Manual review by the project's own developer — not a certified third-party audit. Not a substitute for professional audit before mainnet or real-funds use.

## Contracts reviewed and redeployed

All addresses below are live on Arc Testnet and verified on [Arcscan](https://testnet.arcscan.app).

| Contract | Address | What changed |
|---|---|---|
| ArcSwap v5 | `0x3CD201DA3DdDF2d0E9fcBC606a32E821099dEAC1` | Added `minAmountOut` slippage protection (previously none — owner rate change had zero recourse for the user). Added `pause()`. Added two-step ownership transfer. **v5:** `withdrawLiquidity` now only accepts USDC/EURC (previously any token address); `setRate` now caps each call to a 10% move (previously any value > 0 was accepted in one shot). The prior v2 deployment (`0x13bD5D32509bC5D03811B3e5F86952a8C2BD0521`) has both issues and should not be used or referenced going forward. |
| ArcLending v2 | `0x5d52D4c13FBEBB7FCd4852bD4876D2A12a7B100a` | Added a guardian role that can pause new `borrow()` only — supply/withdraw/repay/liquidate stay open. Fixed checks-effects-interactions ordering in several functions. |
| ArcFactoryV2 v2 *(legacy, still live — see v3 below)* | `0x23782643650D73b2Bb145B9145D62D743bF25CB0` | Added `nonReentrant` guards on `addLiquidity`/`removeLiquidity`/`swap` — this factory is permissionless, so a malicious token with reentrant hooks was a real risk. Restored `MINIMUM_SHARES` first-depositor protection that had been dropped from the original version. |
| ArcFactoryV2 v3 | `0x5ee0c6cc6879728a4835826D87b28702f8993559` | Reserves are now derived from `balanceOf()` deltas around transfers instead of the nominal amount requested — a fee-on-transfer token delivering less than requested no longer permanently overstates reserves. Added `sync()`, callable by anyone, which pulls reserves back down to the pool's real balance (never up) — protects against a token whose balance can drop with no transfer at all (a rebase token, or an unanticipated fee/burn mechanic), so the pool can't become permanently stuck paying out more than it holds. Switched every transfer to a `SafeERC20`-style call, so a non-standard token (USDT-style, no return value) no longer makes every call revert outright. Added a `deadline` parameter to `addLiquidity`/`removeLiquidity`/`swap`. New pools are created here going forward; **pools already created on v2 keep running on v2's logic** — this can't be fixed retroactively for existing pools, only for new ones. |
| ArcEscrow v4 | `0xDDDe5a4E691F6ce6826CB85F09466E799FCFabfB` | Added a 7-day timeout so a freelancer can claim funds if a client goes unresponsive after work is submitted. Added `pause()` scoped only to blocking new escrow creation. **v4:** closed a refund loophole — `refund()` previously allowed the client to refund themselves even after work was `Submitted`, silently defeating the timeout protection above; refund is now only valid before submission. The prior v3 deployment (`0xCe6c2B0EAbC86974c653020467c05Ce5e1eB418C`) has this bug and should not be used or referenced going forward. |

Live transaction proof for these flows (bridge, Circle Wallet execution) is in the main [README](./README.md#verified-receipts--real-transaction-hashes).

## Not fixed, by design

**ArcPerps** — `entryPrice`/`exitPrice` are submitted directly by the caller with no oracle validating them; a position can be opened and closed at self-declared prices. Rather than a partial fix, this was removed from the app's navigation and from the AI Copilot's action set entirely, and — as of this writing — the `Perpetuals.tsx` and `PnlHistory.tsx` React components have also been deleted outright (previously kept as unreachable reference code; now fully removed, same treatment as Lending). The deployed contract is still live and verified on Arcscan at `0x3B4cE1734087e1c67474Ff42982063febE3E4B20` for historical/audit reference, but nothing in the product can reach it and no frontend code references it anymore.

**ArcLending's peg assumption** — the contract assumes USDC and EURC hold their ~$1 peg; there's no live price oracle. A real depeg event would break the liquidation math. This is a design limitation, not something patched — a real oracle is a prerequisite before this contract should hold real funds. As of this writing, Lending has also been removed from the app's navigation and the AI Copilot's action set entirely — same treatment as ArcPerps below. The deployed contract is still live and verified on Arcscan, but nothing in the product can reach it.

## Deliberately small surface, not separately audited

**ArcTokenFactory** — I didn't find an owner-controlled mint, pause, or upgrade path; each token mints once at deploy time. No separate code change made.

**ArcAMM (legacy)** — only ever touches the two known, trusted tokens (USDC/EURC) rather than arbitrary ones, unlike the permissionless factories above. No separate code change made.

## Backend finding (not a contract, found in a follow-up review)

`api/circle-wallet.js`'s `contractCall` action accepted any `contractAddress` and `abiFunctionSignature` from the request body with no restriction — anyone who obtained a wallet ID could have had the backend execute an arbitrary call on that wallet's behalf. Fixed with an explicit allowlist (`ALLOWED_CONTRACTS` in that file) covering only the specific contracts FlowFi's integration is meant to call — USDC/EURC per chain, ArcSwap, CCTP's TokenMessengerV2/MessageTransmitterV2, and Circle Gateway's Wallet/Minter contracts. Any other address is rejected with a 403 before it reaches Circle's API.

Liquidity Pools and Escrow aren't in that list because neither is currently callable through Circle Wallet at all — Liquidity Pools only executes via a connected browser wallet, and Escrow isn't wired into the app's UI. Lending has been removed from the app entirely (see "Not fixed, by design" above) and was never in this allowlist either. The allowlist covers exactly what's reachable today, not a superset.
