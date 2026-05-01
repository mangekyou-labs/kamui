---
phase: testing
title: Testing Strategy
description: Define testing approach, test cases, and quality assurance
---

# Testing Strategy

## Test Coverage Goals
**What level of testing do we aim for?**

- Unit test coverage target: 100% of new/changed node code where practical (ingestion, proving adapter, submission logic).
- Integration test scope: critical path request → fulfill + failure modes (rpc failure, duplicate event, invalid proof).
- End-to-end: testnet and mainnet “happy path” validations aligned to roadmap KPIs.

## Unit Tests
**What individual components need testing?**

### Node: Event ingestion + cursoring
- [x] Parses `RandomnessRequested` event into internal request model (`iota/node/src/ingest/query-events.test.ts`)
- [x] Persists cursor and resumes correctly after restart (`iota/node/src/node.test.ts`, `iota/node/src/store/json-state.test.ts`)
- [x] Backfill window prevents missed events (`iota/node/src/ingest/query-events.test.ts`)
- [x] Edge-case parsing and cursor semantics (`iota/node/src/ingest/query-events.edge-cases.test.ts`)
  - non-matching event types ignored
  - missing/invalid cursor skipped
  - empty data pages preserve existing cursor
  - bootstrap timestamp filtering for malformed timestamp inputs

### Node: Proving adapter
- [x] Generates proof/output for a known alpha and known keypair (`iota/node/src/prove/fastcrypto.test.ts`)
- [x] Validates output/proof length constraints (`iota/node/src/prove/fastcrypto.test.ts`, `iota/node/src/prove/fastcrypto.edge-cases.test.ts`)
- [x] Handles prover failures and surfaces actionable errors (`iota/node/src/prove/fastcrypto.test.ts`, `iota/node/src/prove/fastcrypto.edge-cases.test.ts`)
  - stdin secret passing enforced
  - fallback path covered (`--secret-key-stdin` unsupported)
  - ENOENT and malformed stdout classification covered

### Node: Submission + idempotency
- [x] Does not submit if request state is not Pending (`iota/node/src/node.test.ts`)
- [x] Retries transient RPC failures with backoff (`iota/node/src/node.test.ts`)
- [x] Marks terminal failures and does not loop forever (`iota/node/src/node.test.ts`)
- [x] Submitter error classification edge cases (`iota/node/src/submit/fulfill.edge-cases.test.ts`)
  - checkpoint/digest/effects guardrails
  - bad hex proof/output rejection
  - operator address derivation fallback path
  - unknown abort code retryability behavior

### Coordinator read path
- [x] View/object/dynamic-field fallback behavior (`iota/node/src/read/coordinator.test.ts`)
- [x] Classifier and response-shape edge cases (`iota/node/src/read/coordinator.edge-cases.test.ts`)

## Integration Tests
**How do we test component interactions?**

- [x] Localnet/devnet Move test: `ecvrf_verify` passes for a known proof vector (golden test) (`iota/move/tests/kamui_iota_vrf_tests.move`)
- [x] Local Move integration path for coordinator + consumer (`iota/move/tests/coordinator_tests.move`, `iota/move/tests/demo_consumer_tests.move`):
  - [x] create subscription
  - [x] request randomness (emits event)
  - [x] fulfill path updates on-chain state
  - [x] consumer reads output/callback_data after fulfillment
- [x] Failure mode: invalid proof rejected on-chain (`coordinator_tests.move`)
- [x] Failure mode: duplicate fulfill attempt rejected (idempotency) (`coordinator_tests.move`)
- [ ] Live RPC integration tests for TS node (deferred — currently covered by deterministic unit tests/mocks)

## End-to-End Tests
**What user flows need validation?**

- [x] Mainnet smoke path validated and documented in runbooks (`iota/MAINNET_PUBLISH.md`, `iota/MAINNET_NODE_CONFIG.md`):
  - [x] one request fulfilled end-to-end with recorded tx digests and timings
- [ ] Builder flow (testnet) scripted E2E remains partially manual/deferred:
  - [ ] publish package
  - [ ] run node via docker-compose
  - [ ] run consumer script / minimal dApp request
  - [ ] run frontend UI demo to initiate request and display fulfillment status/output
  - [ ] observe fulfillment and consume randomness
- [ ] Add CI-safe E2E harness (mock/fake RPC or ephemeral testnet gate) as follow-up task before public handoff QA sign-off.

## Test Data
**What data do we use for testing?**

- Fixed “golden” test vectors:
  - VRF keypair + alpha + expected output/proof (compatible with IOTA `ecvrf_verify`)
- Mocked RPC/indexer responses for unit tests

## Test Reporting & Coverage
**How do we verify and communicate test results?**

- Current node test command: `cd iota/node && npm test`
  - Runs TypeScript compile + Node test runner over `dist/**/*.test.js`
- Current typecheck command: `cd iota/node && npx tsc --noEmit`
- Coverage tooling status:
  - [ ] No built-in coverage script is configured in `iota/node/package.json` yet
  - [ ] Add `c8` (or equivalent) for explicit line/branch/function coverage reports
  - Suggested command once added: `cd iota/node && npx c8 --reporter=text --reporter=lcov npm test`
- Latest run result (this update):
  - `122` tests passed, `0` failed (Node + Move-related TS test suites)
- Store testnet run logs and timing stats as artifacts (p50/p95/p99)
- Current demo benchmark helper: `cd iota/node && npm run demo:measure` (and KPI mode: `npm run demo:kpi`)

## Manual Testing
**What requires human validation?**

- Demo dApp UX (request button, status updates)
- Operational runbook validation (fresh machine setup → mainnet readiness)
- Secret handling verification (no secrets in logs)

## Performance Testing
**How do we validate performance?**

- Measure request→fulfill latency distribution on testnet under:
  - single request
  - burst of N requests (e.g., 50)
- Validate p95 < 2s target on testnet for baseline workloads
- Tune with supported node levers first: `POLL_INTERVAL_MS`, `EVENT_PAGE_SIZE`, `MAX_RETRY_ATTEMPTS`, `RETRY_BASE_DELAY_MS`

## Bug Tracking
**How do we manage issues?**

- Track issues by category: on-chain, node-ingestion, node-submission, infra
- Require regression tests for any bug fixes in node logic
