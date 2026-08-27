# FlowFi Smart Contracts (Arc Testnet)

Source for the 4 contracts that were redeployed after the security review documented in `kontrat-denetim-raporu.md`.

| Contract | File | Address |
|---|---|---|
| Swap v2 | `ArcSwap.sol` | `0x13bD5D32509bC5D03811B3e5F86952a8C2BD0521` |
| Lending v2 | `ArcLending.sol` | `0x5d52D4c13FBEBB7FCd4852bD4876D2A12a7B100a` |
| Pool Factory v2 | `ArcFactoryV2.sol` | `0x23782643650D73b2Bb145B9145D62D743bF25CB0` |
| Escrow v3 | `ArcEscrow.sol` | `0xCe6c2B0EAbC86974c653020467c05Ce5e1eB418C` |

**Not included here:** Token Factory and the (disabled) Perpetuals contract — these were audited but never modified, and their source wasn't kept as a separate file during that process. Their addresses are still listed in the main README's contract table; the deployed bytecode is verified and viewable on [Arcscan](https://testnet.arcscan.app).
