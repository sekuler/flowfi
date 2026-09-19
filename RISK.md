# Risk Disclosure

Last updated: September 19, 2026

Read this before using any Arc Mainnet feature (Bridge, Swap, Dashboard). It's a plain list of what can go wrong — not a scare tactic, just an honest account so you can decide with real information.

## You are using real funds on Mainnet

Any transaction on Arc Mainnet moves real value. There is no undo button, no customer support line that can reverse a confirmed transaction, and no FlowFi-side balance FlowFi can restore. Once your wallet signs and the network confirms, it's final — this is a property of the blockchain itself, not a FlowFi limitation.

## Wrong network is unrecoverable

Arc **Mainnet** and Arc **Testnet** are different networks with different chain IDs. Sending real mainnet funds to a testnet address, or vice versa, cannot be reversed by FlowFi or anyone else. Always double-check which network you're on before confirming a transaction — the app labels this clearly (a persistent "MAINNET — real funds" indicator wherever real funds are involved), but the responsibility to check is yours.

## Third-party routing risk

Mainnet Bridge and Swap route your transaction through LI.FI and/or Relay — independent protocols FlowFi doesn't operate or control. Their smart contracts, uptime, pricing, and route selection are their own; a bug, outage, or bad route on their end is outside FlowFi's ability to fix or compensate for. FlowFi chose these specifically because they're already live, high-volume, and battle-tested elsewhere — but "already audited by someone else" is not the same guarantee as "audited for this specific integration."

## Slippage and price movement

Bridge and swap quotes can move between the moment you see a quote and the moment your transaction confirms, especially during volatile markets or on a route with thin liquidity. Review the quoted amount and any slippage tolerance shown before confirming.

## New chain, new bridge, evolving support

Arc Mainnet launched September 16, 2026. Some bridge routes may be new, may have limited liquidity, or may not yet support every direction (for example, certain routes out of Arc were not yet available from every provider as of this writing). A route that looks reasonable may fail, or fail to complete quickly — FlowFi surfaces what the underlying providers report, but can't guarantee any specific route's reliability.

## Testnet assets have no value

Everything on Arc Testnet (Circle Wallet, Token Launch, Liquidity Pools, CCTP, Gateway) uses test tokens with **zero monetary value**, obtainable free from a faucet. Nothing there should ever be treated as, purchased as, or sold as if it had real value.

## FlowFi's own contracts (Testnet only) are not professionally audited

FlowFi's Testnet smart contracts have had a manual security self-review by the project's own developer (see [SECURITY.md](./SECURITY.md)), not a professional third-party audit. Known deprecated/legacy contract addresses are documented there — don't interact with them directly, and don't send anything of value to them (they hold test assets only, but the pattern matters if similar contracts are ever deployed elsewhere).

## Self-custody means self-responsibility

On mainnet, you hold your own keys via your own wallet. FlowFi cannot recover a lost seed phrase, a mis-typed address, or a transaction sent to the wrong recipient. Treat your wallet's own security (extension source, seed phrase storage, phishing awareness) as entirely your responsibility.

## No warranty

FlowFi is provided "as is." See [TERMS.md](./TERMS.md) for the full disclaimer.

## Contact

**contact@flowfi.finance**
