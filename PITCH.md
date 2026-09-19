# FlowFi — One-Page Pitch

**Live:** [flowfi.finance](https://flowfi.finance) · **Repo:** [github.com/sekuler/flowfi](https://github.com/sekuler/flowfi) · **Network:** Arc Mainnet (live) + Arc Testnet (full showcase)

## The one-line pitch

FlowFi runs on two environments, on purpose: a **thin, self-custodial mainnet** where real funds only ever touch already-audited infrastructure (LI.FI, Relay) — and a **full showcase built on Circle's stack** (Developer-Controlled Wallets, Gateway, CCTP) on testnet, where FlowFi's own contracts can be exercised without a professional audit standing behind real money.

## Why the split, not a single story

Most stablecoin apps either (a) rush unaudited contracts to mainnet with real money, or (b) never ship past testnet at all. FlowFi does neither:

| Environment | What's live there | Why |
|---|---|---|
| **Arc Mainnet** | Bridge, Swap, Dashboard, a navigation-only AI Copilot | Every transaction is signed by the user's own wallet, routed through LI.FI/Relay — protocols already live and audited before FlowFi integrated them. FlowFi never custodies a key, a balance, or signing authority here. |
| **Arc Testnet** | Circle Wallet (email sign-in, no seed phrase), Gateway (unified balance), real CCTP V2 burn/attest/mint, permissionless token launch, an AI Copilot that actually executes transactions | FlowFi's own contracts, fully built and demonstrable — kept on test assets with zero monetary value until a professional audit (and, separately, applicable licensing — see below) are in place. |

## Why mainnet doesn't include Circle Wallet (yet) — a compliance call, not a technical one

Circle's Developer-Controlled Wallets do work on Arc Mainnet today (verified live in Circle's own console). FlowFi still doesn't turn it on for real funds: a custodial wallet — FlowFi's backend briefly holding signing authority over a user's key — is a regulated activity in a growing number of jurisdictions, including Türkiye (7518 sayılı Kanun, in force since July 2024, brings this under SPK licensing with real penalties for operating unlicensed). Rather than ship a working feature ahead of that question being resolved, mainnet stays strictly self-custodial, and Circle Wallet stays where it's fully exercised without the licensing question: Testnet.

## What's actually live and tested, not just described

- 63 automated contract tests (Foundry) covering FlowFi's own Testnet contracts, running in CI on every push
- Every owner-privileged Testnet contract (pool factories, swap) is behind a 2-of-3 Safe multisig — not a single private key
- Real transaction hashes for both environments — a cross-chain bridge and a Circle Wallet swap execution — verifiable on their respective explorers, not just described (see `README.md`)
- CSP, rate-limited/allowlisted backend endpoints, httpOnly session cookies for Testnet wallet sessions, HSTS

## Audit

No third-party audit of FlowFi's own Testnet contracts. This is exactly why they don't hold real money: `SECURITY.md`'s self-review is dated, scoped, and testable — what was checked, what was found and fixed, and what's a deliberate, documented trade-off rather than an oversight. Mainnet sidesteps the question entirely rather than asking users to trust an unaudited contract with real funds — see `SECURITY.md`'s "Mainnet trust model" section for the full reasoning.

## Where to look for proof, not just claims

- `SECURITY.md` — what was reviewed, what's still open, and the mainnet/testnet trust-model split
- `TERMS.md` / `PRIVACY.md` / `RISK.md` — what a user is actually agreeing to, in plain language
- `.github/workflows/ci.yml` — the test suite runs automatically, it's not a one-time claim
- Recent commit history — real bugs found and fixed, not silence
