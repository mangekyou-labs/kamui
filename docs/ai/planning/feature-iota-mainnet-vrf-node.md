---
phase: planning
title: Project Planning & Task Breakdown
description: Break down work into actionable tasks and estimate timeline
---

# Project Planning & Task Breakdown

## Current Status

- **AWS production deployment completed (2026-03-27):**
  - AWS CLI v2 baked into the Docker runtime image so containers can fetch secrets from AWS Secrets Manager with no credentials on disk
  - `docker-compose.aws.yml` added with `AWS_REGION` injection for the container's AWS CLI
  - `docker-compose.file-secrets.yml` retained for non-AWS deployments
  - `.env.mainnet.example` updated: command-based secret modes are the default; path-based modes are opt-in
  - `MAINNET_NODE_CONFIG.md` updated with full AWS EC2 + IAM + Secrets Manager bring-up section
  - `iota/README.md` updated with AWS setup guide reference
  - `AWS_SETUP.md` created with complete walkthrough: Secrets Manager setup, IAM policy + role + instance profile creation, EC2 launch, Docker install, node startup, monitoring, key rotation



- Move coordinator refactor complete:
  - request state is now coordinator-owned and fulfilled by `request_id`
  - permissionless fulfillment remains intact
  - owner-managed VRF public key rotation and request result getters are implemented
  - request limits now cap `num_words` and `callback_data`
  - Move tests are passing locally
- Off-chain node vertical slice implemented:
  - config + secret loading
  - JSON cursor/idempotency state
  - RPC event polling for `kamui_iota_vrf::request::RandomnessRequested`
  - bounded startup backfill from the event head using `MoveEventType` filtering
  - fastcrypto proof generation adapter
  - startup validation of the local VRF public key against the active on-chain coordinator key
  - on-chain request-status precheck before each fulfill attempt
  - fulfill transaction submission with retries
  - capped exponential backoff with equal jitter and an RPC circuit breaker for degraded read/submit paths
  - built-in ops server exposing `/healthz`, `/readyz`, and `/metrics`
  - Prometheus metrics for poll health, retries, request outcomes/errors, latency, and RPC circuit-breaker state
- Alignment hardening complete:
  - coordinator now enforces the solvency invariant (`fulfiller_reward <= fee_per_request`) for the current fee model
  - result getters now abort until requests are fulfilled instead of returning placeholder data
  - JSON state persistence now fsyncs the parent directory after atomic rename for crash durability
- Demo integration scaffolded:
  - minimal consumer Move module now covers the local `request -> fulfill -> consume` path against the coordinator
  - node helper scripts + runbook now document a reproducible testnet `request -> fulfill -> consume` flow
  - latency benchmark tooling now reports p50/p95/p99 and ties results to concrete node tuning knobs
- Docker packaging scaffolded:
  - multi-stage image now builds the node runtime and bundles `ecvrf-cli`
  - docker-compose now mounts the node `.env`, keeps the ops surface private by default, persists state, and health-checks `/readyz`
- Mainnet config guidance scaffolded:
  - mainnet `.env` template now spells out every required node/runtime value
  - example key JSON files and gitignore rules now cover local secret handling
  - secure-secret guidance now documents the current env/file contract and the KMS-backed production handoff pattern
- Security and packaging hardening completed locally:
  - the fastcrypto prover now passes the VRF secret over stdin instead of CLI argv and sanitizes raw prover failures before logging or persistence
  - Docker now builds the vendored `fastcrypto` tree pinned at validated ref `c141d4c2d52efe18d2b9193b071fdc188411da3b`
  - default docker-compose no longer publishes `/healthz`, `/readyz`, or `/metrics`; a dedicated override file is required for host exposure
- Post-review alignment fixes completed locally:
  - request-status reads no longer collapse generic coordinator/object lookup failures into `missing` requests
  - Docker path-based secret loading now has a dedicated compose override plus clarified operator docs
- Production secret loading completed locally:
  - the node now supports command-based secret sources for the VRF keypair and operator key
  - startup commands make AWS Secrets Manager, GCP Secret Manager, Azure Key Vault, and HashiCorp Vault usable without committing secrets into repo files
- Repo handoff docs completed locally:
  - integration guide added
  - troubleshooting guide added
  - repo handoff checklist added
  - KMS / vault setup guide added
- Mainnet package published:
  - local `iota move build` passes for `iota/move`
  - mainnet RPC chain identifier: `6364aad5`
  - publish date: `2026-03-18`
  - package ID: `0xc871ca37099f0d2fa47b4e9ed0b0b18b8f03cf9ac3bd3da60f5b788e69265126`
  - publish transaction digest: `2aUubEafHMXdrgoe5feTfKmJkozPVeGnqQA5mzzArzkf`
  - upgrade cap object ID: `0x67ad0d6c28cd664daa73beecc983f2b7ef1f4b39601997144f9a4b83a8f0c898`
  - shared coordinator created on `2026-03-18`
  - coordinator object ID: `0x14c262fad6898c36ecbf1c27ca972bf3d2ea7c7c03588ee28f101d97c2e4dbdc`
  - coordinator creation transaction digest: `ELTY6msVVQznjQ4UGnD8rwFMnkdJ5wxB1CH4v9qXRAgi`
  - node startup validated against mainnet with `/readyz=ready`
  - real mainnet demo flow completed:
    - setup tx: `H6QUg2EBW3xc3GWHYHfPAZ95cYtp2KdzKM9ADxaRsqUj`
    - request tx: `Cm6Naj3edSsu4bDymSvJAhMqnaa7sQJeHfTbD6vDejk4`
    - fulfill tx: `2LRD51eTUhN6mTNGJKwmBdqqsmVHX5YNFYtKdVstwFWP`
    - consume tx: `3yQTW6inu4wXqfyhK3KWDJ2TdBYdUSkMxXzansC4Cow2`
  - local CLI `iota 1.16.2` still warned against mainnet server API `1.18.1` / protocol version `21`; upgrade before the next mainnet admin transaction
## Reconciled Task Status (2026-03-18)

- Done
  - Move coordinator is implemented, tested, and published to IOTA mainnet with package IDs pinned in repo docs
  - Off-chain node vertical slice is implemented locally: config validation, event polling, proof generation, submit path, metrics/health, and crash-durable JSON state
  - Retry hardening is implemented locally: capped exponential backoff with equal jitter, retry delay observability, and an RPC circuit breaker wired into readiness/metrics
  - Demo consumer, reproducible `request -> fulfill -> consume` steps, and latency benchmark tooling are in place
  - Docker packaging is in place for the node: a multi-stage image plus compose wiring for `.env`, persisted state, and `/readyz` health checks
  - Mainnet config templates and secure secret handling guidance are in place for local, Docker, and KMS-managed deployments
  - Mainnet deployment is validated end-to-end: coordinator created, node running against mainnet, and a real demo request was fulfilled and consumed
  - Implementation review completed: local `npm test` and `iota move test` pass, and the mainnet read path is confirmed to rely on object/dynamic-field reads rather than unsupported Move view calls
  - Post-review alignment fixes are complete locally: generic object lookup failures no longer get marked as missing requests, and Docker now has an explicit override for path-based secret file mounts
  - Security and packaging hardening is complete locally: prover secret handling is stdin-based and sanitized, Docker builds from a pinned vendored `fastcrypto` ref, and default ops exposure is private-only unless explicitly published
  - Production secret loading is complete locally: the node can fetch VRF/operator material through command-based secret sources, and repo docs now include AWS/GCP/Azure/Vault setup examples
  - Packaging and handoff docs are complete locally: integration, troubleshooting, handoff checklist, and KMS setup docs are now in repo
- In Progress
  - KPI automation remains follow-up work: the manual latency benchmark exists (`npm run demo:kpi`), but the p95 target is not enforced by automated CI tests (CLI-only enforcement at release time)
- Blocked
  - None
- Newly Discovered Work
  - Optional follow-up: replace CLI-driven command sources with first-party cloud SDK integrations if live deployments need in-process refresh or provider-native auth flows

## Milestones
**What are the major checkpoints?**

- [ ] Milestone 1 (Roadmap): IOTA coordinator + node + testnet demo
  - Move package deployed to testnet
  - Node fulfills requests on testnet with p95 < 2s
  - Integration guide + demo steps/video
- [ ] Milestone 4 (Roadmap): Mainnet KPIs + handoff readiness
  - Mainnet deployment complete (package IDs + addresses pinned)
  - Ops runbook + docker packaging complete
  - Repo polished for IOTA highlight (comprehensive README)

## Task Breakdown
**What specific work needs to be done?**

### Phase 1: Foundation (3–5 days)
- [x] Decide feature/package naming (folder structure, Move package name, published module names)
- [x] Identify IOTA mainnet/testnet endpoints and event ingestion method (indexer vs rpc events vs ws)
- [x] Confirm proof format compatibility:
  - VRF keypair format (bytes length, encoding)
  - proof length and output length as expected by `iota::ecvrf`
- [x] Create a minimal Move “hello-VRF” module calling `iota::ecvrf::ecvrf_verify` in a test-only context

### Phase 2: Core Features (7–10 days)
- [x] Implement Move Coordinator:
  - [x] Subscription + consumer allowlist
  - [x] Fee model (in-scope):
    - [x] Subscription prepay and per-request debit OR per-request payment
    - [x] Optional fulfill incentive/reward mechanism (so anyone can relay fulfill tx)
    - [x] Enforce solvency invariant for the current fee model
  - [x] Request creation + request_id scheme
  - [x] Events: `RandomnessRequested`, `RandomnessFulfilled`
  - [x] Fulfillment entry:
    - [x] permissionless sender (no oracle allowlist); proof-gated by `ecvrf_verify`
    - [x] pending status check + idempotency guard
    - [x] `iota::ecvrf::ecvrf_verify` verification
    - [x] store result + emit event
  - [x] Fulfilled-only result getters (`request_output`, `request_fulfilled_by`, `request_fulfilled_at`)
- [ ] Implement off-chain VRF Node (TS/Node):
  - [x] Config + validation (env vars; config file)
  - [x] Key loading (operator signing key + VRF secret key)
  - [x] Event ingestion cursoring (safe resume)
  - [x] Proof generation adapter (fastcrypto CLI or library)
  - [x] Prover secret-handling hardening (no VRF secret exposure through CLI argv or raw errors)
  - [x] Coordinator-aware validation (active VRF key + request-status precheck)
  - [x] Fulfillment submission w/ retries + idempotency
  - [x] Health endpoints + Prometheus metrics
  - [x] Crash-durable JSON state persistence
  - [x] Production secret loading (KMS-backed custody for VRF/operator keys on the live node)
  - [x] Retry hardening (backoff jitter + RPC circuit breaker)

### Phase 3: Integration & Polish (5–7 days)
- [ ] End-to-end testnet demo:
  - [x] Consumer Move module or scripts
  - [x] “request → fulfill → consume” reproducible steps
  - [x] latency measurement and tuning
- [ ] Mainnet deployment:
  - [x] publish Move package
  - [x] configure and run node against mainnet
  - [x] validate with a real demo tx
- [ ] Packaging as “mainnet product”:
  - [x] Dockerfile + docker-compose for node
  - [x] Example configs + secure secrets guidance (including KMS-backed production setup)
  - [x] Pin `fastcrypto` / `ecvrf-cli` to a validated ref in Docker builds
  - [x] Restrict default Docker ops exposure for `/healthz`, `/readyz`, and `/metrics`
  - [x] Integration guide + troubleshooting
  - [x] Repo handoff checklist for IOTA (Milestone 4)

## Dependencies
**What needs to happen in what order?**

- External
  - Stable IOTA event ingestion method on testnet and mainnet
  - IOTA toolchain for Move publishing and key management
  - VRF proof generation tool/library matching IOTA `ecvrf_verify`
- Internal
  - Move package finalized before node can submit fulfillments reliably
  - Event schemas locked early (node parsing depends on them)

## Timeline & Estimates
**When will things be done?**

- Foundation: 1 week (buffer for IOTA API/proof format validation)
- Core: 2 weeks
- Integration + mainnet + packaging: 1–2 weeks

## Risks & Mitigation
**What could go wrong?**

- Proof format mismatch / verification failures
  - Mitigation: build a standalone “prove + verify” harness early, comparing off-chain output to on-chain `ecvrf_verify`.
- Event ingestion reliability on mainnet
  - Mitigation: persist cursors; use exact `MoveEventType` filtering; bound first-start backfill from the event head to the configured window.
- Double-fulfill or missed fulfill due to restarts
  - Mitigation: idempotency via on-chain status + local cache; process events at-least-once but submit exactly-once.
- Key compromise
  - Mitigation: strict secrets handling, least-privileged operator key, rotate VRF public key support.
  - Note: on-chain fulfillment is permissionless; operational security relies on custody of the VRF secret key (KMS) and strong request pricing (fees).
- Secret leakage through prover invocation or error logs
  - Mitigation: stop passing the VRF secret through CLI argv when possible, sanitize raw prover failures, and keep secret-bearing values out of persisted request errors.
- Non-reproducible Docker builds
  - Mitigation: pin `fastcrypto` / `ecvrf-cli` to a validated commit or release so the shipped image matches the proof format that was tested.
- Ops endpoint exposure
  - Mitigation: keep the ops server bind-local/private by default in Docker and require explicit opt-in for public metrics exposure.

## Resources Needed
**What do we need to succeed?**

- Access to IOTA mainnet/testnet endpoints (RPC/indexer) and funded operator account
- Secure place to store VRF secret key and operator signing key (at minimum filesystem + permissions; ideally KMS)
- CI runner capable of building Move package and node docker image
