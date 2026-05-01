---
phase: implementation
title: Implementation Guide
description: Technical implementation notes, patterns, and code guidelines
---

# Implementation Guide

## Development Setup
**How do we get started?**

- Prerequisites and dependencies
  - IOTA Move toolchain (publish/build/test)
  - Node.js (LTS) + package manager
  - Access to IOTA testnet + mainnet RPC/indexer endpoints
  - VRF proving tooling compatible with `iota::ecvrf` (likely `fastcrypto` CLI/library)
- Environment setup steps (target state)
  - Build and test Move package locally against a localnet/testnet
  - Run VRF node in “dev mode” against testnet with verbose logs
  - Run VRF node in docker-compose with minimal config + metrics enabled
- Configuration needed (proposed env vars)
  - `IOTA_RPC_URL`
  - `COORDINATOR_PACKAGE_ID`
  - `COORDINATOR_OBJECT_ID`
  - `FASTCRYPTO_CLI_PATH`
  - `VRF_SECRET_KEY` + `VRF_PUBLIC_KEY`, or `VRF_KEYPAIR_PATH`, or `VRF_KEYPAIR_COMMAND`
  - `OPERATOR_PRIVATE_KEY`, or `OPERATOR_KEYPAIR_PATH`, or `OPERATOR_KEY_COMMAND`
  - `POLL_INTERVAL_MS`, `EVENT_PAGE_SIZE`, `MAX_RETRY_ATTEMPTS`

## Code Structure
**How is the code organized?** (proposed)

- `iota/`
  - `move/` (Move package: coordinator + events + subscription)
  - `node/` (TS node: ingest/prove/submit/api/config)
  - `docker/` (Dockerfile, compose, example configs)
  - `README.md` (integration + ops guide)

Naming conventions
- Move modules: `kamui_iota_vrf::*`
- Events: `RandomnessRequested`, `RandomnessFulfilled`
- Node: `kamui-iota-vrf-node` package name (npm)

## Implementation Notes
**Key technical details to remember:**

### Core Features
- Coordinator verification
  - Use `iota::ecvrf::ecvrf_verify` as the single source of truth for proof validity.
  - Treat all fulfillments as untrusted input: validate lengths, request status, and oracle authorization before calling verify.
- Request ID
  - Choose a deterministic, unique scheme (e.g., monotonic counter in coordinator + tx context) and emit it in events.
- Idempotency
  - On-chain: request moves `Pending -> Fulfilled` exactly once.
  - Off-chain: at-least-once event processing; only submit if on-chain status is still Pending.

### Patterns & Best Practices
- Event ingestion
  - Persist a durable cursor/checkpoint; on restart, backfill last N seconds/blocks to avoid missing events.
  - Separate “ingest” from “work queue” so parsing failures don’t stall ingestion.
- Proof generation adapter
  - Isolate behind an interface so we can switch between CLI-based and library-based proving.
  - The current `ecvrf-cli` path should read the VRF secret from stdin (`--secret-key-stdin`), not argv.
  - Sanitize prover stderr/stdout before logging or persisting request errors.
- Structured logging
  - Always log: request_id, tx digest, latency, retry count.
  - Never log: secret keys, full proofs (optional to log hash/prefix).

## Integration Points
**How do pieces connect?**

- Node → chain read path
  - Query events for coordinator module’s `RandomnessRequested`.
  - Fetch request object/state when needed to confirm status/payload.
- Node → chain write path
  - Build and sign a transaction calling `fulfill_randomness`.
  - Confirm finality; record tx digest for metrics and idempotency.

## Error Handling
**How do we handle failures?**

- Categorize errors
  - **Transient**: RPC timeouts, rate limits → retry with backoff.
  - **Permanent**: invalid proof, request already fulfilled → mark as terminal.
- Retry strategy
  - Exponential backoff + jitter; cap max retries.
  - Circuit breaker when RPC is degraded.

## Performance Considerations
**How do we keep it fast?**

- Parallelize proof generation with bounded concurrency.
- Batch event reads when possible; avoid N+1 request state fetches.
- Prefer subscription/ws ingestion where reliable; otherwise tune polling interval and backfill windows.

## Security Notes
**What security measures are in place?**

- Secrets management
  - Support reading secrets from files and/or environment; document recommended KMS/HSM patterns for mainnet.
  - Production deployments can now use command-based secret sources to fetch key material from AWS/GCP/Azure/Vault CLIs at startup.
  - In Docker, keep `/healthz`, `/readyz`, and `/metrics` private by default; require an explicit override to publish them externally.
- Authorization
  - Coordinator is **permissionless to fulfill**; validity is enforced by on-chain `ecvrf_verify`.
  - Node should run behind firewall; ops endpoints locked down.
- Key rotation
  - Plan support for rotating VRF public key with a safe migration story.
