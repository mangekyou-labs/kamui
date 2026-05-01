# IOTA Testnet Demo

This runbook covers the current Phase 3 demo path for the IOTA VRF feature:

1. create a funded subscription and demo consumer
2. start the VRF node
3. request randomness through the demo consumer
4. wait for the node to fulfill the coordinator request
5. consume the fulfilled output back into the demo consumer state

The walkthrough intentionally uses one signer for all demo actions:

- subscription owner
- demo consumer owner
- node operator

That keeps the flow reproducible with the existing `.env` file and avoids extra key-management setup for the testnet demo.

## Prerequisites

- The Move package is already published to testnet.
- The shared coordinator object already exists from `create_coordinator(...)`.
- `FASTCRYPTO_CLI_PATH` points at a built `ecvrf-cli`.
- The node `.env` is configured with:
  - `IOTA_RPC_URL`
  - `COORDINATOR_PACKAGE_ID`
  - `COORDINATOR_OBJECT_ID`
  - `VRF_SECRET_KEY` and `VRF_PUBLIC_KEY`, or `VRF_KEYPAIR_PATH`
  - `OPERATOR_PRIVATE_KEY`, or `OPERATOR_KEYPAIR_PATH`

## Configure

From [iota/node](/Users/kyler/repos/kamui/iota/node):

```bash
cp .env.example .env
```

Fill in the coordinator and key values. Optional demo-specific vars are:

- `DEMO_SUBSCRIPTION_FUND_AMOUNT`
  - If unset, `demo:setup` funds the subscription with `2 * fee_per_request`.
- `DEMO_SEED_TEXT` or `DEMO_SEED_HEX`
- `DEMO_CALLBACK_TEXT` or `DEMO_CALLBACK_HEX`
- `DEMO_NUM_WORDS`
- `DEMO_WAIT_TIMEOUT_MS`
- `DEMO_POLL_INTERVAL_MS`

## Step 1: Bootstrap Demo State

Create a funded subscription and a shared `DemoConsumer` object:

```bash
npm run demo:setup
```

The command prints JSON including:

- `demo_consumer_object_id`
- `subscription_id`
- `funded_amount`

Export the consumer object ID for the next commands:

```bash
export DEMO_CONSUMER_OBJECT_ID=0x...
```

## Step 2: Start the VRF Node

In a separate shell, from [iota/node](/Users/kyler/repos/kamui/iota/node):

```bash
npm run dev
```

Healthy startup should log that the node loaded config, validated the coordinator VRF public key, and started the ops server.

Optional readiness checks:

```bash
curl http://127.0.0.1:9464/healthz
curl http://127.0.0.1:9464/readyz
curl http://127.0.0.1:9464/metrics
```

## Step 3: Request Randomness

From [iota/node](/Users/kyler/repos/kamui/iota/node):

```bash
npm run demo:request
```

The command submits `demo_consumer::request_randomness(...)` and prints JSON including:

- `tx_digest`
- `active_request_id`
- `request_seed_hex`
- `callback_data_hex`

At this point the node should see the `RandomnessRequested` event and submit the fulfillment transaction automatically.

## Step 4: Consume the Fulfilled Output

Once the node is running, consume the fulfilled coordinator result back into the demo consumer:

```bash
npm run demo:consume
```

This command:

- reads the active request from the demo consumer
- polls the coordinator until the request is `fulfilled`
- calls `demo_consumer::consume_randomness(...)`
- prints the stored `last_output_hex` and callback data

If the request does not reach `fulfilled` before the timeout, increase `DEMO_WAIT_TIMEOUT_MS` and retry.

## Step 5: Inspect Final State

To inspect the demo consumer at any point:

```bash
npm run demo:view
```

The command prints:

- `has_active_request`
- `active_request_id`
- `last_consumed_request_id`
- `last_output_hex`
- `last_callback_data_hex`
- `consumed_count`

## Step 6: Measure Latency

Run the benchmark from [iota/node](/Users/kyler/repos/kamui/iota/node):

```bash
npm run demo:measure
```

The command:

- reuses the existing `DemoConsumer`
- submits `N` sequential requests
- waits for each request to become `fulfilled`
- consumes each result before the next iteration
- prints per-sample request, fulfillment, and consume digests
- prints `request_to_fulfilled_ms` and `request_to_consumed_ms` summaries with `p50`, `p95`, and `p99`

Measurement controls:

- `DEMO_MEASURE_ITERATIONS`
- `DEMO_MEASURE_SETTLE_MS`
- `DEMO_TARGET_P95_MS`
- `DEMO_MEASURE_SEED_TEXT` or `DEMO_MEASURE_SEED_HEX`
- `DEMO_MEASURE_CALLBACK_TEXT` or `DEMO_MEASURE_CALLBACK_HEX`

Interpretation:

- `request_to_fulfilled_ms` is the main KPI-aligned latency signal for the current demo flow.
- `request_to_consumed_ms` includes the extra consumer transaction and is useful for end-to-end UX, but it is not the node’s fulfillment KPI.

## Tune For P95

If `request_to_fulfilled_ms.p95Ms` misses target:

- lower `POLL_INTERVAL_MS` toward `100-250`
- increase `EVENT_PAGE_SIZE` above `50` for burstier runs
- reduce `RETRY_BASE_DELAY_MS` if transient RPC retries dominate the tail
- raise `MAX_RETRY_ATTEMPTS` if requests are being abandoned too early during brief RPC failures
- inspect `/metrics` while the benchmark runs, especially:
  - `kamui_iota_vrf_request_processing_duration_seconds`
  - `kamui_iota_vrf_request_errors_total`
  - `kamui_iota_vrf_requests_total`

## Expected Artifacts

For a successful testnet run, record:

- setup transaction digest
- request transaction digest
- fulfillment transaction digest from node logs
- consume transaction digest
- `last_output_hex` from `demo:view`
- latency benchmark JSON from `demo:measure`

These are the minimum artifacts needed for the next plan item and for the later latency-measurement task.
