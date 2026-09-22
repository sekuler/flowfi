# Mainnet demo: Bridging USDC onto Arc

Two short clips showing FlowFi's Arc Mainnet bridge working end to end, with real funds.

## Native USDC bridge (Circle CCTP V2)

[![Watch the demo](https://img.youtube.com/vi/j5hJ95oeA7E/hqdefault.jpg)](https://youtu.be/j5hJ95oeA7E)

Sending 5 USDC from Base to Arc: the USDC is burned on Base via Circle's `depositForBurn`, then minted fresh on Arc via `receiveMessage`. No wrapped tokens — it's the same native USDC, just on a different chain.

## Any-token bridge (LI.FI)

[![Watch the demo](https://img.youtube.com/vi/f4Luu0ic3ek/hqdefault.jpg)](https://youtu.be/f4Luu0ic3ek)

Bridging Base ETH into Arc USDC through the "Any token" tab, routed via LI.FI.

## Verified receipts

For proof beyond a recording, see the "Verified receipts" section of the main [`README.md`](../README.md#verified-receipts--real-transaction-hashes) — real transaction hashes from a live mainnet run, linked to Basescan and Arcscan.

---

*The Gateway/Circle Wallet demo below is from FlowFi's Arc **Testnet** build. Gateway and Circle Wallet are not part of the Arc Mainnet product — mainnet uses self-custodial wallet connect only.*

# 20-second demo: Gateway in one loop (Testnet)

The fastest way to see FlowFi's Circle stack actually work, not just get described.

[![Watch the demo](https://img.youtube.com/vi/-4Oq3hHD6Lk/hqdefault.jpg)](https://youtu.be/-4Oq3hHD6Lk)

*Circle Wallet sign-in (email → address) → Gateway deposit → instant cross-chain transfer → confirming it in History.*

## The loop

1. **Sign in** — email + 6-digit code, no wallet extension. (Circle Wallet tab)
2. **Deposit** — put a small amount of USDC into your unified Gateway balance from any supported chain. (Gateway tab → "Deposit into unified balance")
3. **Watch the balance** — the "BY CHAIN" breakdown updates to show what's actually available to spend from that chain.
4. **Transfer** — move part of that balance to a different chain. Confirm & sign. Watch it land in under 500ms — no bridging wait, no separate mint transaction to track down.

That's the whole differentiator in one loop: deposit once, move instantly, anywhere it's supported.
