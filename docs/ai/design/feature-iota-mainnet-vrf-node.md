---
phase: design
title: System Design & Architecture
description: Define the technical architecture, components, and data models
---

# System Design & Architecture

## Architecture Overview
**What is the high-level system structure?**

```mermaid
graph TD
  DApp[IOTA dApp / Consumer Move package] -->|request_randomness| Coord[Kamui IOTA VRF Coordinator (Move)]
  Coord -->|emit RandomnessRequested| Events[(IOTA Events via RPC Event Query)]
  Node[Kamui IOTA VRF Node (off-chain)] -->|poll| Events
  Node -->|generate VRF proof (sk)| Prover[ECVRF Prover (fastcrypto/CLI/lib)]
  Node -->|fulfill_randomness(proof, output, request_id...)| Coord
  Coord -->|ecvrf_verify(pk, alpha, proof, output)| ECVRF[iota::ecvrf (on-chain)]
  Coord -->|emit RandomnessFulfilled| Events
  DApp -->|read result via request_output| Coord
```

- Key components and their responsibilities
  - **Coordinator (Move package)**: owns subscription registry, request lifecycle, the active VRF public key, and uses `iota::ecvrf::ecvrf_verify` to validate fulfillments on-chain.
  - **VRF Node (off-chain, production-grade)**: monitors request events, generates proofs with VRF secret key, submits fulfill txs, manages retries/idempotency, exposes health/metrics.
  - **Prover implementation**: proof generation via `fastcrypto` CLI/tooling or linked library; must produce proof/output compatible with IOTA’s verifier.
  - **Consumer dApps**: request randomness and consume results; optionally provide callback data.

Technology stack choices and rationale
- **Move on IOTA** for coordinator: tight integration with IOTA framework + native ECVRF verify.
- **TypeScript/Node.js** for oracle node: mirrors existing `standalone-vrf-server.js` operational approach and is easy to containerize/operate.

## Data Models
**What data do we need to manage?**

- Coordinator state (on-chain)
  - **Config**
    - `vrf_public_key` (bytes) with owner-managed rotation
    - `fee_model` (in-scope)
      - `fee_per_request` (coin amount or token amount)
      - `fulfiller_reward` (amount or bps of fee; supports permissionless relayers)
      - `treasury_cut` (optional)
      - solvency invariant for the current model:
        - accepted requests must remain fulfillable from coordinator funds
        - in the per-request-funded model, `fulfiller_reward <= fee_per_request`
        - if a future treasury-subsidy model is added, that reserve must be explicitly funded and monitored
    - `limits`
      - `max_callback_data_bytes`
      - `max_num_words`
  - **Subscription**
    - `owner`
    - `balance` / billing info (fee model in-scope; prepay escrow)
    - `authorized_consumers` (addresses)
  - **Request**
    - `request_id` (unique coordinator-owned `u64` counter)
    - `subscription_id`
    - `alpha/seed` (bytes) – input to VRF
    - `status` (Pending/Fulfilled)
    - `num_words`, `callback_data` (optional)
    - `created_at` (epoch/slot)
  - **Result**
    - `request_id`
    - `output` (VRF hash/output bytes)
    - `fulfilled_at`
    - `fulfilled_by` (tx sender / relayer address)
    - consumer read semantics:
      - result getters are fulfilled-only
      - pending requests must not return zero-value placeholder data as if it were a real result

- Off-chain node state (local)
  - **ProcessedRequests** (idempotency cache): request_id → last_attempt, status, tx digest
  - **Queue**: pending requests with backoff
  - **Metrics counters**: events_seen, fulfill_success, fulfill_fail, rpc_errors, p95_latency
  - **Persistence guarantee**:
    - restart safety assumes crash-durable persistence for cursor and request-attempt state
    - file-backed state must use atomic replace semantics and durable metadata persistence (`fsync` file + directory after rename)

## API Design
**How do components communicate?**

- On-chain entrypoints (proposed)
  - `create_coordinator(fee_per_request, fulfiller_reward, vrf_public_key)` (owner deploy step; shares object)
  - `create_subscription(owner, params...) -> subscription_id`
  - `fund_subscription(subscription_id, coins...)`
  - `withdraw_subscription(subscription_id, amount)` (owner-only)
  - `add_consumer(subscription_id, consumer_addr)`
  - `request_randomness(subscription_id, seed, num_words, callback_data) -> request_id`
  - `fulfill_randomness(request_id, proof, output) -> fulfiller_reward`
    - Verifies:
      - request is Pending
      - `iota::ecvrf::ecvrf_verify` passes for `(pk, seed, proof, output)`
    - Writes result + emits fulfillment event
  - `set_vrf_public_key(new_public_key)` (owner-only rotation)
  - `request_output(request_id) -> output_bytes`
    - Read-only getter for fulfilled requests
    - Aborts with `E_REQUEST_NOT_FULFILLED` if the request is still pending
  - `request_status(request_id) -> u8`
  - `request_fulfilled_by(request_id) -> address`
    - Aborts with `E_REQUEST_NOT_FULFILLED` if the request is still pending
  - `request_fulfilled_at(request_id) -> u64`
    - Aborts with `E_REQUEST_NOT_FULFILLED` if the request is still pending

- Events (required)
  - `RandomnessRequested { request_id, subscription_id, requester, seed, num_words }`
  - `RandomnessFulfilled { request_id, output, fulfilled_by }`
  - Note: `callback_data` stays in coordinator-owned request storage in the current implementation and is not emitted in the request event.

- Off-chain node interfaces
  - **Event ingestion**: mainnet **RPC event query** (polling-based) with durable cursors and bounded startup backfill from the event head.
  - **Submission**: sign and submit fulfill tx (operator key) with proof/output.
  - **Processing model**:
    - current milestone uses serial request processing to minimize duplicate/race complexity
    - configurable concurrency is a future enhancement and must preserve exactly-once submission behavior
  - **Ops endpoints** (recommended):
    - `GET /healthz` (liveness)
    - `GET /readyz` (readiness: initialized, VRF key validated, and recent poll success)
    - `GET /metrics` (Prometheus)

Authentication/authorization approach
- On-chain: **permissionless fulfill** (no sender allowlist). Access is effectively gated by possession of a valid proof for the configured VRF public key(s).
- Node: protect ops endpoints with bind-local or token; never expose signing endpoints.

Deployment flow
- Package publish does **not** create the production coordinator automatically.
- After publish, the owner must call `create_coordinator(...)` with the real VRF public key, fee, and reward parameters.
- Subsequent key changes use `set_vrf_public_key(...)`.

## Component Breakdown
**What are the major building blocks?**

- Move
  - `kamui_iota_vrf::coordinator`
  - `kamui_iota_vrf::request`
  - (Optional) `kamui_iota_vrf::fees`
- Off-chain node
  - `ingest/` (RPC event polling, cursor checkpoints)
  - `prove/` (VRF proof generation adapter)
  - `submit/` (tx building, signing, retry)
  - `store/` (sqlite/rocksdb optional; or file-based cursor + cache)
  - `api/` (health + metrics)
  - `config/` (env + config validation)
- Demo
  - Minimal consumer Move module + scripts, or adapt `kamui-program/app` to IOTA wallet flow.

## Design Decisions
**Why did we choose this approach?**

- Use **on-chain `ecvrf_verify`** to minimize cryptographic risk and align with IOTA’s supported primitives.
- Keep node **stateless-ish** with durable cursors and idempotency tracking so restarts are safe.
- Keep the current node **single-worker/serial** for the first vertical slice; add concurrency only after idempotency and duplicate-submit behavior are proven under load.
- Use **polling-based RPC event queries** (mainnet) with durable cursors and bounded head-first backfill for reliability.

Alternatives considered
- Fully on-chain VRF generation: not feasible (requires secret key).
- Multi-oracle consensus: future milestone; higher complexity.

## Non-Functional Requirements
**How should the system perform?**

- Performance targets
  - Testnet p95 fulfill latency < 2s (roadmap KPI).
  - Current milestone processes requests serially; burst tolerance comes from bounded queueing/retries rather than parallel fulfillment workers.
  - Concurrency and explicit rate limiting are follow-up hardening work, not a property of the current implementation.
- Scalability considerations
  - Horizontal scale via sharding by request_id or subscription, but must avoid double-fulfills (requires leader election / partitioning).
- Security requirements
  - Strong key custody: VRF secret key and operator key in secure storage (KMS vault on the live server).
  - Idempotency and replay safety: do not fulfill twice; verify request status on-chain before submitting.
  - DoS resistance: validate request sizes; cap callback_data/num_words; **fees are required/in-scope** to price requests and prevent spam.
- Reliability/availability needs
  - Automatic retries with exponential backoff and jitter.
  - Circuit breakers for RPC failures.
  - Observability: logs, metrics, alerting hooks.
  - Restart safety claims require crash-durable local state persistence, not just in-memory idempotency and best-effort file writes.
