# Legacy / superseded contracts

These are real, deployed, verified contracts — not hypothetical — but the live app no longer sends any traffic to them. Moved here from the main [`README.md`](../README.md) to keep that page focused on the current product surface; nothing below is deleted or hidden, just relocated. See [`SECURITY.md`](../SECURITY.md) for the full review history.

| Contract | Address | Status |
|---|---|---|
| Swap v5 (fixed-rate USDC/EURC) | `0x3CD201DA3DdDF2d0E9fcBC606a32E821099dEAC1` | Deprecated — kept for the app's read-only price reference only. The live Swap UI trades against Pool Factory v4c, not this contract. |
| Pool Factory v2 | `0x23782643650D73b2Bb145B9145D62D743bF25CB0` | Legacy — pools created here keep working, but no new pools are created here. |
| Pool Factory v3 | `0x5ee0c6cc6879728a4835826D87b28702f8993559` | Legacy — same reasoning as v2. |
| Pool Factory v4 | `0x57B451D60F09222C2bb6c828FFE3703069A532Ed` | Legacy — superseded by v4b, then v4c. Kept scanned only so liquidity still sitting in these pools stays visible/withdrawable. |
| Pool Factory v4b | `0xa42c3bDcd385350880165120fE7E72e43733f70B` | Legacy — same reasoning as v4. |

Every `onlyOwner` contract above is owned by the same 2-of-3 Safe multisig (`0xa50FFedfC93eDB81F8Bcc23507db8aDdE7EE8Be0`) as the current contracts — legacy status doesn't mean unowned or unmonitored, it means the app doesn't route new activity there.

## Also documented, not reachable from the app at all

See [`SECURITY.md`](../SECURITY.md)'s "Deprecated — live on-chain, unreachable from the app" table for ArcLending v2 and ArcPerps — features fully removed from the product, not just superseded.
