# FlowFi Smart Contracts (Arc Testnet)

Source for the contracts that were redeployed after the security review documented in [`SECURITY.md`](../SECURITY.md), plus one newer addition below.

| Contract | File | Address |
|---|---|---|
| Swap v5 *(deprecated — kept as a read-only price reference only)* | `ArcSwap.sol` | `0x3CD201DA3DdDF2d0E9fcBC606a32E821099dEAC1` |
| Pool Factory v2 *(legacy, still live)* | `ArcFactoryV2.sol` | `0x23782643650D73b2Bb145B9145D62D743bF25CB0` |
| Pool Factory v3 *(legacy, still live)* | `ArcFactoryV2_v3.sol` | `0x5ee0c6cc6879728a4835826D87b28702f8993559` |
| Pool Factory v4 *(legacy, superseded by v4b then v4c)* | `ArcFactoryV2_v4.sol` | `0x57B451D60F09222C2bb6c828FFE3703069A532Ed` |
| Pool Factory v4b *(legacy, superseded by v4c)* | not kept as a separate file — identical source to v4, redeployed with the same code | `0xa42c3bDcd385350880165120fE7E72e43733f70B` |
| Pool Factory v4c *(current)* | not kept as a separate file — see `ArcFactoryV2_v4.sol`'s changelog comments for the `addLiquidity` slippage-protection change v4c shipped | `0xD2dC496dcf4e6D8c9CFc710AC5C9A6Dc941CBbB0` |
| Escrow v4 | `ArcEscrow.sol` | `0xDDDe5a4E691F6ce6826CB85F09466E799FCFabfB` |
| Launch Pool Factory *(new — not part of the original security review, not yet independently reviewed)* | `ArcLaunchPoolFactory.sol` | see main [`README.md`](../README.md) for the current address |

**Not included here:** Token Factory (`ArcTokenFactoryV2`) — audited but never modified, and its source wasn't kept as a separate file; only the verified bytecode on [Arcscan](https://testnet.arcscan.app) exists. Its address is listed in the main README's contract table. (The Perpetuals contract was audited the same way, but the feature — and every reference to it — has since been fully removed from the app; see [`SECURITY.md`](../SECURITY.md).)

**`ArcLaunchPoolFactory.sol` note:** this is a separate, narrower permissionless pool-creation path scoped only to tokens minted through `ArcTokenFactoryV2` (checked via its `launchedAt()` view) — it does not touch or weaken the `onlyOwner` restriction on the Pool Factory versions above, which stay curated. It reuses the same `ArcPool` AMM code (same fee, `MINIMUM_SHARES` lock, reentrancy guard, `SafeERC20` handling) as Pool Factory v4/v4b/v4c, unmodified. It has not been through the same review pass as the contracts above — treat it as unreviewed until it has.
