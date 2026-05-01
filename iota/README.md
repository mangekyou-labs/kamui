# IOTA Workspace

This directory contains IOTA-specific deliverables for the mainnet VRF milestone.

## Current Status

- `iota/move/`
  - coordinator stores request state internally and fulfills by `request_id`
  - production deployment now creates the shared coordinator explicitly via `create_coordinator(...)` so the real VRF public key is supplied at creation time
  - owner can rotate the active VRF public key and consumers can read fulfilled output from coordinator storage
  - demo consumer module now exercises a local `request -> fulfill -> consume` flow against the coordinator
  - request guardrails cap `num_words` and `callback_data`
  - permissionless `fulfill_randomness` verifies proofs with `iota::ecvrf::ecvrf_verify`
  - mainnet package publish succeeded on `2026-03-18` with package ID `0xc871ca37099f0d2fa47b4e9ed0b0b18b8f03cf9ac3bd3da60f5b788e69265126`
  - shared mainnet coordinator created with object ID `0x14c262fad6898c36ecbf1c27ca972bf3d2ea7c7c03588ee28f101d97c2e4dbdc`
  - local Move tests are passing
- `iota/node/`
  - vertical slice implemented for config loading, RPC event polling, fastcrypto proving,
    JSON-backed cursor/idempotency state, and fulfill transaction submission
  - startup backfill now queries the exact `RandomnessRequested` event type from the head and only replays the configured recent window
  - startup now validates the node VRF public key against the active coordinator key, and each request is status-checked on-chain before submit
  - coordinator reads and request-status checks now use object/dynamic-field reads so the node works on mainnet without Move view support
  - the fastcrypto prover now passes the VRF secret through stdin and redacts prover failures before logging/persisting them
  - production secret loading now supports command-based sources so VRF/operator keys can be fetched from KMS/vault-backed CLIs at startup
  - retry hardening now uses capped exponential backoff with equal jitter plus an RPC circuit breaker surfaced through readiness and Prometheus metrics
  - local ops surface is implemented with `/healthz`, `/readyz`, and `/metrics`
  - Prometheus metrics cover poll cycles, retries, request outcomes/errors, in-flight work, and processing latency
  - demo benchmark tooling now reports request-to-fulfilled p50/p95/p99 and points at concrete node tuning knobs
  - mainnet publish runbook is documented and now includes the successful publish artifacts plus the remaining CLI upgrade warning for later mainnet admin calls
  - mainnet node startup and a real `request -> fulfill -> consume` demo flow are now validated
- `iota/docker/`
  - multi-stage Dockerfile now builds the vendored `fastcrypto` tree pinned at `c141d4c2d52efe18d2b9193b071fdc188411da3b` and bundles the patched `ecvrf-cli`
  - default docker-compose keeps `/healthz`, `/readyz`, and `/metrics` private inside the container/network; `docker-compose.public-ops.yml` is the explicit opt-in for host publication
  - `docker-compose.file-secrets.yml` mounts the default key JSON files when operators use path-based secret loading in Docker

## Production VPS / Cloud Deployment

- AWS EC2 walkthrough (recommended): [AWS_SETUP.md](/Users/kyler/repos/kamui/iota/AWS_SETUP.md)
- Local or Docker without cloud secrets: [MAINNET_NODE_CONFIG.md](/Users/kyler/repos/kamui/iota/MAINNET_NODE_CONFIG.md)
- KMS / vault secret loading: [KMS_SETUP.md](/Users/kyler/repos/kamui/iota/KMS_SETUP.md)

## Validation

- Move tests: `cd iota/move && iota move test`
- Node tests: `cd iota/node && npm test`
- Docker compose validation: `docker compose -f iota/docker/docker-compose.yml config`
- Public ops override validation: `docker compose -f iota/docker/docker-compose.yml -f iota/docker/docker-compose.public-ops.yml config`
- File-secret override validation: `docker compose -f iota/docker/docker-compose.yml -f iota/docker/docker-compose.file-secrets.yml config`
- Mainnet node config guide: [MAINNET_NODE_CONFIG.md](/Users/kyler/repos/kamui/iota/MAINNET_NODE_CONFIG.md)
- Testnet demo walkthrough: [DEMO.md](/Users/kyler/repos/kamui/iota/DEMO.md)
- Mainnet publish preflight/runbook: [MAINNET_PUBLISH.md](/Users/kyler/repos/kamui/iota/MAINNET_PUBLISH.md)
- Integration guide: [INTEGRATION.md](/Users/kyler/repos/kamui/iota/INTEGRATION.md)
- Troubleshooting guide: [TROUBLESHOOTING.md](/Users/kyler/repos/kamui/iota/TROUBLESHOOTING.md)
- Repo handoff checklist: [HANDOFF_CHECKLIST.md](/Users/kyler/repos/kamui/iota/HANDOFF_CHECKLIST.md)
- KMS / vault setup guide: [KMS_SETUP.md](/Users/kyler/repos/kamui/iota/KMS_SETUP.md)

## Deployment Notes

- Package publish does not create a production coordinator automatically.
- Mainnet package ID: `0xc871ca37099f0d2fa47b4e9ed0b0b18b8f03cf9ac3bd3da60f5b788e69265126`
- Publish transaction digest: `2aUubEafHMXdrgoe5feTfKmJkozPVeGnqQA5mzzArzkf`
- Upgrade cap object ID: `0x67ad0d6c28cd664daa73beecc983f2b7ef1f4b39601997144f9a4b83a8f0c898`
- Coordinator creation transaction digest: `ELTY6msVVQznjQ4UGnD8rwFMnkdJ5wxB1CH4v9qXRAgi`
- Coordinator object ID: `0x14c262fad6898c36ecbf1c27ca972bf3d2ea7c7c03588ee28f101d97c2e4dbdc`
- Real demo transaction digests:
  - setup: `H6QUg2EBW3xc3GWHYHfPAZ95cYtp2KdzKM9ADxaRsqUj`
  - request: `Cm6Naj3edSsu4bDymSvJAhMqnaa7sQJeHfTbD6vDejk4`
  - fulfill: `2LRD51eTUhN6mTNGJKwmBdqqsmVHX5YNFYtKdVstwFWP`
  - consume: `3yQTW6inu4wXqfyhK3KWDJ2TdBYdUSkMxXzansC4Cow2`
- See [MAINNET_PUBLISH.md](/Users/kyler/repos/kamui/iota/MAINNET_PUBLISH.md) for mainnet preflight checks, the successful publish artifacts, and the reusable publish flow.

## Node Ops Surface

- Default bind: `127.0.0.1:9464`
- Liveness: `GET /healthz`
- Readiness: `GET /readyz`
- Metrics: `GET /metrics`
- Default Docker behavior: private only; no host port is published unless you add [docker-compose.public-ops.yml](/Users/kyler/repos/kamui/iota/docker/docker-compose.public-ops.yml)
- Config:
  - `OPS_HOST`
  - `OPS_PORT`
  - `RETRY_BASE_DELAY_MS`
  - `RETRY_MAX_DELAY_MS`
  - `RPC_CIRCUIT_BREAKER_FAILURE_THRESHOLD`
  - `RPC_CIRCUIT_BREAKER_COOLDOWN_MS`

## Naming Decisions

- Feature slug: `iota-mainnet-vrf-node`
- Move package namespace: `kamui_iota_vrf::*`
- Off-chain node package name: `kamui-iota-vrf-node`

## Directory Layout

- `iota/move/` for Move coordinator package and modules.
- `iota/node/` for the off-chain VRF node implementation.
- `iota/docker/` for containerization and runtime packaging.
- `iota/DEMO.md` for the current testnet `request -> fulfill -> consume` walkthrough.
- `iota/INTEGRATION.md` for the operator/integration workflow.
- `iota/TROUBLESHOOTING.md` for common failure modes and recoveries.
- `iota/HANDOFF_CHECKLIST.md` for the Milestone 4 repo handoff list.
