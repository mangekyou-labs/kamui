---
phase: requirements
title: Requirements & Problem Understanding
description: Clarify the problem space, gather requirements, and define success criteria
---

# Requirements & Problem Understanding

## Problem Statement
**What problem are we solving?**

- Kamui currently has an ECVRF-based VRF flow on Solana (contracts + prover + demo UI). IOTA builders need the same capability on **IOTA mainnet**, leveraging **IOTA’s built-in on-chain ECVRF verification** (`iota::ecvrf`) instead of bespoke curve verification logic.
- Without a production-grade “oracle/prover node” and an IOTA-native coordinator contract, dApps cannot reliably request verifiable randomness on IOTA mainnet.
- The current workaround is “not available on IOTA” (or requires each team to build their own VRF infra), which blocks adoption and makes integrations inconsistent.

## Goals & Objectives
**What do we want to achieve?**

- Primary goals
  - Ship an **IOTA mainnet VRF Coordinator Move package** (subscriptions + request + fulfill) that verifies VRF proofs using `iota::ecvrf::ecvrf_verify`.
  - Ship a **production-grade off-chain VRF node** (“prover/oracle”) that listens for on-chain VRF request events and submits fulfillments.
  - Provide a **builder-facing product package**: clear README, configs, dockerization, and an integration guide so other IOTA teams can adopt quickly.
  - Meet roadmap KPIs from `IOTA-mainnet-roadmap.md` Milestone 1 & 4 (mainnet deployment + repo handoff readiness).
- Secondary goals
  - Provide a demo dApp flow (Move consumer module + script + frontend UI demo) showing request → fulfill → consume.
  - Observability: metrics + structured logs + health endpoints for operating mainnet nodes.
- Non-goals (what's explicitly out of scope)
  - Cross-chain VRF bridging (LayerZero/etc.) in this milestone.
  - Building a fully decentralized oracle network; this milestone focuses on a **single production-grade node** pattern and ops guidance.
  - Perfect UI polish for the demo; focus is correctness and operability.

## User Stories & Use Cases
**How will users interact with the solution?**

- As an **IOTA dApp developer**, I want to **request verifiable randomness** from a published Move package, so that I can implement lotteries, games, NFT reveals, and randomized assignments.
- As an **IOTA dApp developer**, I want to **verify fulfillments on-chain** using IOTA’s built-in ECVRF verification, so that I don’t need custom cryptography code in my dApp.
- As an **operator (Kamui or third party)**, I want to **run a VRF node** that reliably detects requests and fulfills them with low latency, so that dApps get randomness quickly.
- As an **IOTA ecosystem maintainer**, I want a **handoff-quality repo** (docs + reproducible deployment) so that IOTA can highlight it as a reference implementation.

Edge cases:
- Request bursts / backpressure handling (multiple concurrent requests).
- Duplicate event processing / replay after node restarts.
- Node temporary outages; late fulfillments; idempotency rules.
- Fee/gas fluctuations; RPC instability; partial chain reorg considerations (if applicable).

## Success Criteria
**How will we know when we're done?**

- Measurable outcomes (from Milestone 1 & 4)
  - Deployed Move package (e.g., `Kamui_IOTA`) to **IOTA mainnet** with published package ID(s) recorded.
  - A VRF node can fulfill requests on IOTA testnet with **p95 end-to-end latency < 2s** (request event seen → fulfillment tx confirmed).
  - A demo (video or reproducible steps) showing an IOTA dApp successfully requesting and consuming randomness on **IOTA mainnet**.
  - Comprehensive README + integration guide sufficient for repo handoff to IOTA.
- Acceptance criteria
  - On-chain verification uses `iota::ecvrf::ecvrf_verify` (no custom verification implementation for mainnet path).
  - Fulfillment is deterministic and traceable: request ID → proof → output → on-chain verification result.
  - Node is resilient: safe retries, no double-fulfill, safe restarts, and clear operational playbook.
  - Coordinator is **permissionless to fulfill** (no sender allowlist); any transaction sender can submit a fulfillment **as long as** the ECVRF proof verifies.
  - Economic model exists to limit spam and fund operations (fees/subscriptions are in-scope).

## Constraints & Assumptions
**What limitations do we need to work within?**

- Technical constraints
  - Use IOTA Move framework ECVRF primitives (CFRG VRF draft + Ristretto255); proof/public key formats must match `iota::ecvrf`.
  - Off-chain node must integrate with **IOTA mainnet RPC event query** APIs (polling-based ingestion).
  - Secrets (VRF private key + operator key) must never be logged; must be stored securely (KMS-backed for the production node).
- Time constraints
  - Milestone 1 timeline: ~3 weeks; Milestone 4: ~2 weeks.
- Assumptions
  - IOTA mainnet exposes the `iota::ecvrf` module with stable behavior and the same types as devnet docs.
  - We can generate VRF proofs off-chain (via `fastcrypto` tooling or equivalent) that are verifiable by `iota::ecvrf`.

## Questions & Open Items
**What do we still need to clarify?**

- Event ingestion is confirmed as **mainnet RPC event query**; remaining question is exact query shape/limits and recommended polling cadence/backfill strategy.
- Key management model:
  - Keys stored in a **KMS vault** with the live server (VRF secret key + operator signer). Confirm the specific KMS (AWS/GCP/Azure/HashiCorp Vault) and access pattern.
  - Rotation plan: do we need public key rotation in Milestone 1, or schedule for a follow-up milestone?
- On-chain interface details:
  - Request/fulfill function signatures and event schema (request ID, alpha/seed, callback data, num_words, etc.).
  - Idempotency rules (can fulfill once; how to reject duplicates).
- Fee model details:
  - Subscription prepay vs per-request payment; how fees are distributed (oracle reward, treasury) and how refunds are handled.
- Packaging decisions:
  - Preferred folder/name for IOTA artifacts (e.g., `kamui-iota/` vs extending `kamui-node/`).
  - Frontend UI demo scope: reuse `kamui-program/app` visuals vs build an IOTA-specific UI; define “done” for mainnet demo.

