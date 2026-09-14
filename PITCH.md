# FlowFi — One-Page Pitch

**Live:** [flowfi.finance](https://flowfi.finance) · **Repo:** [github.com/sekuler/flowfi](https://github.com/sekuler/flowfi) · **Network:** Arc Testnet (mainnet Sept 16, 2026)

## The one-line pitch

FlowFi is a DeFi interface built around **Circle's full stack** — Developer-Controlled Wallets, Gateway, and CCTP — not just another swap UI with a USDC balance.

## Why that's a real claim, not marketing filler

FlowFi covers the standard path (connect a browser wallet, bridge with CCTP) but also ships two pieces most stablecoin apps skip entirely:

| Feature | What it actually does |
|---|---|
| **Circle Wallet, no seed phrase** | Sign in with email + a 6-digit code. Circle creates and custodies a real wallet server-side. No extension to install, no 12 words to write down or lose. |
| **Gateway: instant unified balance** | Deposit USDC once on any supported chain; move it to any other supported chain in under 500ms — no per-transfer bridging wait. The integration handles the real edge cases: per-chain deposit accounting, pending-transfer locks, and destination-chain gas requirements. |
| **Real CCTP V2 bridging** | Genuine burn/attest/mint via Circle's own protocol — not a wrapped-asset bridge. |

On top of that: a permissionless token launch (launch an ERC-20, open its own trading pool immediately, without touching the curated pools' security model) and an AI Copilot whose natural-language commands actually execute the transaction, not just explain how to.

## What's actually live and tested, not just described

- 63 automated contract tests (Foundry), running in CI on every push
- Every owner-privileged contract (pool factories, swap) is behind a 2-of-3 Safe multisig — not a single private key
- A real bug (a mismatched `addLiquidity` signature that would have permanently locked launch liquidity) was found and fixed during testing this week — see the commit history, not a claim
- CSP, rate-limited/allowlisted backend endpoints, httpOnly session cookies for wallet sessions

## Audit

No third-party audit. This section is a self-review instead: dated, scoped, and testable — what was checked, what was found and fixed, and what's a deliberate, documented trade-off rather than an oversight. See `SECURITY.md` for the full breakdown, and `.github/workflows/ci.yml` for the test suite that runs on every commit, not just once.

## Where to look for proof, not just claims

- `SECURITY.md` — what was reviewed, what's still open, and why
- `.github/workflows/ci.yml` — the test suite runs automatically, it's not a one-time claim
- Recent commit history — real bugs found and fixed in the days before mainnet, not silence
