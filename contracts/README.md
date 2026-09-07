# FlowFi Smart Contracts (Arc Testnet)

Source for the 4 contracts that were redeployed after the security review documented in [`SECURITY.md`](../SECURITY.md).

| Contract | File | Address |
|---|---|---|
| Swap v2 | `ArcSwap.sol` | `0x13bD5D32509bC5D03811B3e5F86952a8C2BD0521` |
| Lending v2 | `ArcLending.sol` | `0x5d52D4c13FBEBB7FCd4852bD4876D2A12a7B100a` |
| Pool Factory v2 | `ArcFactoryV2.sol` | `0x23782643650D73b2Bb145B9145D62D743bF25CB0` |
| Escrow v4 | `ArcEscrow.sol` | `0xDDDe5a4E691F6ce6826CB85F09466E799FCFabfB` |

**Not included here:** Token Factory — audited but never modified, and its source wasn't kept as a separate file. Its address is still listed in the main README's contract table; the deployed bytecode is verified and viewable on [Arcscan](https://testnet.arcscan.app). (The Perpetuals contract was audited the same way, but the feature — and every reference to it — has since been fully removed from the app; see [`SECURITY.md`](../SECURITY.md).)
