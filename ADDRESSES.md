# FlowFi — Contract Addresses

Every on-chain address FlowFi uses, in one place, split by network. **Mainnet and testnet addresses are not interchangeable.** Always check which network you're on before using one.

- **Arc Mainnet:** chain ID `5042`, explorer [arc.etherscan.io](https://arc.etherscan.io)
- **Arc Testnet:** chain ID `5042002`, explorer [testnet.arcscan.app](https://testnet.arcscan.app)

> USDC is the only token with the **same address on both networks** (`0x3600…0000`). It's Arc's built-in USDC system contract, so it shows up in both lists by design.

---

## 🟢 Arc Mainnet

FlowFi has **no contracts of its own on mainnet**. Every mainnet feature runs on Circle, Morpho and LI.FI contracts that were already live.

### Tokens

| Token | Address |
|---|---|
| USDC *(Arc system contract, ERC-20 interface, 6 decimals)* | [`0x3600000000000000000000000000000000000000`](https://arc.etherscan.io/address/0x3600000000000000000000000000000000000000) |
| EURC *(Circle, 6 decimals)* | [`0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1`](https://arc.etherscan.io/address/0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1) |
| cirBTC *(Circle, 8 decimals)* | [`0x171A4217b86A807A64eB94757Db6849fb4bDbAA0`](https://arc.etherscan.io/address/0x171A4217b86A807A64eB94757Db6849fb4bDbAA0) |
| USYC *(6 decimals)* | [`0x8a5D989Bbb96929F689B0200f435f53dA42bF490`](https://arc.etherscan.io/address/0x8a5D989Bbb96929F689B0200f435f53dA42bF490) |

### Circle (Bridge, Gateway)

| Contract | Address |
|---|---|
| CCTP V2 TokenMessengerV2 | [`0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d`](https://arc.etherscan.io/address/0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d) |
| CCTP V2 MessageTransmitterV2 | [`0x81D40F21F12A8F0E3252Bccb954D722d4c464B64`](https://arc.etherscan.io/address/0x81D40F21F12A8F0E3252Bccb954D722d4c464B64) |
| CCTP for non-USDC: CrossChainTokenService *(EURC & cirBTC bridging)* | [`0x431871229103b780868f8C6BB820cd16ECf942BC`](https://arc.etherscan.io/address/0x431871229103b780868f8C6BB820cd16ECf942BC) |
| Gateway Wallet | [`0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE`](https://arc.etherscan.io/address/0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE) |
| Gateway Minter | [`0x2222222d7164433c4C09B0b0D809a9b52C04C205`](https://arc.etherscan.io/address/0x2222222d7164433c4C09B0b0D809a9b52C04C205) |

The CCTP V2, CrossChainTokenService and Gateway contracts use the same address on every mainnet chain Circle supports, not just Arc.

CCTP for non-USDC token IDs *(bytes32, not addresses)*:

| Token | Token ID |
|---|---|
| EURC | `0x6ca9e29fa53becc29becaf4a90b9ca7a995ad4d2234880da13ca38c657fb241c` |
| cirBTC | `0x3d26699fb5d40190fc3fa0dcbc1cd24e558355043c1997572ff9fd6efbb3fdca` |

### Morpho (Earn & Borrow)

| Contract | Address |
|---|---|
| Morpho Blue | [`0x34CD04070dD72b14E241112F6d83812Df5Af7fCD`](https://arc.etherscan.io/address/0x34CD04070dD72b14E241112F6d83812Df5Af7fCD) |
| Galaxy USDC vault | [`0x8E357432CC12ff425c36432F312968aEb16112AF`](https://arc.etherscan.io/address/0x8E357432CC12ff425c36432F312968aEb16112AF) |
| Keyrock Prime USDC vault | [`0x5bEfAb92a5A3D60F578Cb51EEb4e4FD50a1e3123`](https://arc.etherscan.io/address/0x5bEfAb92a5A3D60F578Cb51EEb4e4FD50a1e3123) |
| Steakhouse Prime EURC vault | [`0xbeef00be37BdE921BAE06fad223125BAB16c41D1`](https://arc.etherscan.io/address/0xbeef00be37BdE921BAE06fad223125BAB16c41D1) |
| Gauntlet EURC Prime vault | [`0x05863F54B05e96092069eF30c9Ca6060336e50B9`](https://arc.etherscan.io/address/0x05863F54B05e96092069eF30c9Ca6060336e50B9) |
| Oracle, cirBTC / USDC market | [`0x2AA87fF48933Ce6aBA240BEE916Fc2e6Ec1e51Ab`](https://arc.etherscan.io/address/0x2AA87fF48933Ce6aBA240BEE916Fc2e6Ec1e51Ab) |
| Oracle, cirBTC / EURC market | [`0x6945246777DfdF4744D957323857F797Ec19Ca1e`](https://arc.etherscan.io/address/0x6945246777DfdF4744D957323857F797Ec19Ca1e) |
| Interest rate model *(AdaptiveCurveIRM, both markets)* | [`0xF02615d094Fc02fC031C35fe705e175aA4653f20`](https://arc.etherscan.io/address/0xF02615d094Fc02fC031C35fe705e175aA4653f20) |

Borrow markets *(Morpho market IDs, bytes32, not addresses)*:

| Market | Market ID |
|---|---|
| Collateral cirBTC, loan USDC, LLTV 86% | `0xc2db905f174e5defcce01d321b09f15f78856a36a21b90cc7e1abbc29225815d` |
| Collateral cirBTC, loan EURC, LLTV 86% | `0x6ea1ea96a1cc671615f3a3bdf51481c5b79e362a8b634396e680d1070137daf4` |

Market parameters were verified onchain with `idToMarketParams`, and every vault's `asset()` is checked again each time the Earn page loads.

### LI.FI (Swap, any-token Bridge)

| Contract | Address |
|---|---|
| LI.FI Diamond *(router; FlowFi reads the current address from LI.FI's API, this is the fallback)* | [`0xa4072583658fae592a3506a42431cb6316a8d40b`](https://arc.etherscan.io/address/0xa4072583658fae592a3506a42431cb6316a8d40b) |

<details>
<summary>USDC on other mainnet chains (source chains for the native USDC bridge and Gateway)</summary>

| Chain | CCTP domain | USDC |
|---|---|---|
| Ethereum | 0 | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` |
| Avalanche | 1 | `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E` |
| Optimism | 2 | `0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85` |
| Arbitrum | 3 | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` |
| Base | 6 | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Polygon | 7 | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` |
| Unichain | 10 | `0x078D782b760474a361dDA0AF3839290b0EF57AD6` |
| Linea | 11 | `0x176211869cA2b568f2A7D4EE941E073a821EE1ff` |
| Codex | 12 | `0xd996633a415985DBd7D6D12f4A4343E31f5037cf` |
| Sonic | 13 | `0x29219dd400f2Bf60E5a23d13Be72B486D4038894` |
| World Chain | 14 | `0x79A02482A880bCe3F13E09da970dC34dB4cD24D1` |
| Monad | 15 | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` |
| Sei | 16 | `0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392` |
| XDC | 18 | `0xfA2958CB79b0491CC627c1557F441eF849Ca8eb1` |
| HyperEVM | 19 | `0xb88339CB7199b77E23DB6E890353E22632Ba630f` |
| Ink | 21 | `0x2D270e6886d130D724215A266106e6832161EAEd` |
| Plume | 22 | `0x222365EF19F7947e5484218551B56bb3965Aa7aF` |
| Morph | 30 | `0xCfb1186F4e93D60E60a8bDd997427D1F33bc372B` |

Arc's own CCTP domain is `26`.

</details>

---

## 🟡 Arc Testnet

FlowFi's own contracts live here, as a working showcase with test assets that have **no monetary value**. Every `onlyOwner` contract below is owned by FlowFi's 2-of-3 Safe multisig.

### FlowFi contracts (current)

| Contract | Address |
|---|---|
| Pool Factory v4c *(current; new curated pools are created here)* | [`0xD2dC496dcf4e6D8c9CFc710AC5C9A6Dc941CBbB0`](https://testnet.arcscan.app/address/0xD2dC496dcf4e6D8c9CFc710AC5C9A6Dc941CBbB0) |
| Launch Pool Factory *(permissionless, only for tokens minted through Token Factory)* | [`0x2b3B2E69C14DA2558E3ce6e2d58c04b2147E5ec0`](https://testnet.arcscan.app/address/0x2b3B2E69C14DA2558E3ce6e2d58c04b2147E5ec0) |
| Token Factory v2 | [`0x1Fe800a2663988C043e4a9A393651f18Cd49D998`](https://testnet.arcscan.app/address/0x1Fe800a2663988C043e4a9A393651f18Cd49D998) |
| Escrow v4 *(deployed and verified, not wired into the app yet)* | [`0xDDDe5a4E691F6ce6826CB85F09466E799FCFabfB`](https://testnet.arcscan.app/address/0xDDDe5a4E691F6ce6826CB85F09466E799FCFabfB) |
| FlowFi Owner Safe *(2-of-3 multisig, owner of the contracts above)* | [`0xa50FFedfC93eDB81F8Bcc23507db8aDdE7EE8Be0`](https://testnet.arcscan.app/address/0xa50FFedfC93eDB81F8Bcc23507db8aDdE7EE8Be0) |

### Curated pools (created by Pool Factory v4c)

| Pool | Address |
|---|---|
| USDC / EURC | [`0x3F0B83e551e272181e2A42144BB07E68d14bD497`](https://testnet.arcscan.app/address/0x3F0B83e551e272181e2A42144BB07E68d14bD497) |
| USDC / cirBTC | [`0x954A5D017C9C18c27572df1644D974cB30e201Ac`](https://testnet.arcscan.app/address/0x954A5D017C9C18c27572df1644D974cB30e201Ac) |
| EURC / cirBTC | [`0x1c80D206e692A5faf2E918693A88cFA48426F39b`](https://testnet.arcscan.app/address/0x1c80D206e692A5faf2E918693A88cFA48426F39b) |

### Tokens

| Token | Address |
|---|---|
| USDC *(Arc system contract, same address as mainnet)* | [`0x3600000000000000000000000000000000000000`](https://testnet.arcscan.app/address/0x3600000000000000000000000000000000000000) |
| EURC | [`0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a`](https://testnet.arcscan.app/address/0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a) |
| cirBTC | [`0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF`](https://testnet.arcscan.app/address/0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF) |
| USYC | [`0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C`](https://testnet.arcscan.app/address/0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C) |
| ARCC | [`0x215D82093892AA24b2901aeb4fCCca933346De18`](https://testnet.arcscan.app/address/0x215D82093892AA24b2901aeb4fCCca933346De18) |

### Circle (testnet Bridge, Gateway)

| Contract | Address |
|---|---|
| CCTP V2 TokenMessengerV2 | [`0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA`](https://testnet.arcscan.app/address/0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA) |
| CCTP V2 MessageTransmitterV2 | [`0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275`](https://testnet.arcscan.app/address/0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275) |
| Gateway Wallet | [`0x0077777d7EBA4688BDeF3E311b846F25870A19B9`](https://testnet.arcscan.app/address/0x0077777d7EBA4688BDeF3E311b846F25870A19B9) |
| Gateway Minter | [`0x0022222ABE238Cc2C7Bb1f21003F0a260052475B`](https://testnet.arcscan.app/address/0x0022222ABE238Cc2C7Bb1f21003F0a260052475B) |

---

## ⚪ Arc Testnet: legacy and retired contracts

Still deployed and verified, but the app no longer sends new activity to them. Kept here so nothing is hidden. Details in [`contracts/LEGACY.md`](./contracts/LEGACY.md) and [`SECURITY.md`](./SECURITY.md).

| Contract | Address | Status |
|---|---|---|
| Pool Factory v4b | [`0xa42c3bDcd385350880165120fE7E72e43733f70B`](https://testnet.arcscan.app/address/0xa42c3bDcd385350880165120fE7E72e43733f70B) | Superseded by v4c |
| Pool Factory v4 | [`0x57B451D60F09222C2bb6c828FFE3703069A532Ed`](https://testnet.arcscan.app/address/0x57B451D60F09222C2bb6c828FFE3703069A532Ed) | Superseded by v4b, then v4c |
| Pool Factory v3 | [`0x5ee0c6cc6879728a4835826D87b28702f8993559`](https://testnet.arcscan.app/address/0x5ee0c6cc6879728a4835826D87b28702f8993559) | Legacy, existing pools still work |
| Pool Factory v2 | [`0x23782643650D73b2Bb145B9145D62D743bF25CB0`](https://testnet.arcscan.app/address/0x23782643650D73b2Bb145B9145D62D743bF25CB0) | Legacy, existing pools still work |
| Swap v5 *(fixed-rate USDC/EURC)* | [`0x3CD201DA3DdDF2d0E9fcBC606a32E821099dEAC1`](https://testnet.arcscan.app/address/0x3CD201DA3DdDF2d0E9fcBC606a32E821099dEAC1) | Deprecated, read-only price reference |
| ArcLending v2 | [`0x5d52D4c13FBEBB7FCd4852bD4876D2A12a7B100a`](https://testnet.arcscan.app/address/0x5d52D4c13FBEBB7FCd4852bD4876D2A12a7B100a) | Retired, removed from the app |
| ArcPerps | [`0x3B4cE1734087e1c67474Ff42982063febE3E4B20`](https://testnet.arcscan.app/address/0x3B4cE1734087e1c67474Ff42982063febE3E4B20) | Retired, removed from the app |
