# IOTA VRF Troubleshooting

## `fastcrypto CLI not found`

Cause:

- `FASTCRYPTO_CLI_PATH` does not point at a built `ecvrf-cli`

Fix:

```bash
cd iota/fastcrypto
cargo build --locked --release --bin ecvrf-cli
```

Then point `FASTCRYPTO_CLI_PATH` at `iota/fastcrypto/target/release/ecvrf-cli`.

## `unexpected argument '--secret-key-stdin'`

Cause:

- the node is using an older `ecvrf-cli` binary that predates the stdin secret patch

Fix:

- rebuild the vendored CLI from this repo
- or rebuild the Docker image so it picks up the vendored `fastcrypto` tree at `c141d4c2d52efe18d2b9193b071fdc188411da3b`

## `Configured VRF public key ... does not match coordinator key ...`

Cause:

- the local VRF keypair does not match the active on-chain coordinator key

Fix:

- confirm `VRF_SECRET_KEY` / `VRF_PUBLIC_KEY` or `VRF_KEYPAIR_PATH`
- confirm the coordinator was created or rotated with the intended public key
- restart the node after correcting the mismatch

## `/readyz` stays unready

Cause:

- startup VRF key validation failed
- the latest poll/read path is failing
- the RPC circuit breaker is open

Fix:

- inspect node logs for the last poll error
- inspect `/metrics` for the circuit-breaker gauges and request error counters
- validate `IOTA_RPC_URL`, `COORDINATOR_PACKAGE_ID`, and `COORDINATOR_OBJECT_ID`

## No host access to `/healthz`, `/readyz`, or `/metrics` in Docker

Cause:

- the default compose file keeps ops private by design

Fix:

```bash
docker compose -f iota/docker/docker-compose.yml -f iota/docker/docker-compose.public-ops.yml up --build
```

That override publishes `OPS_PORT` and switches `OPS_HOST` to `0.0.0.0`.

## Requests are seen but never fulfilled

Cause:

- request is already fulfilled/cancelled
- proof generation is failing
- submit retries are exhausting
- RPC circuit breaker is open

Fix:

- confirm the request is still `pending`
- inspect sanitized prover errors in the node logs
- inspect retry counters and processing latency in `/metrics`
- raise `MAX_RETRY_ATTEMPTS` or tune the retry delay settings if transient RPC failures dominate

## Mainnet admin transactions warn about CLI/server version mismatch

Cause:

- the local `iota` CLI version used during the `2026-03-18` publish was older than the mainnet server version

Fix:

- upgrade the local `iota` CLI before the next publish/upgrade/admin action
- re-run the preflight checks in [MAINNET_PUBLISH.md](/Users/kyler/repos/kamui/iota/MAINNET_PUBLISH.md)

## Production secret loading is still provider-specific

Cause:

- provider auth/bootstrap still depends on your runtime environment even though the node now supports command-based secret fetches

Fix:

- use `VRF_KEYPAIR_COMMAND` and `OPERATOR_KEY_COMMAND`
- validate those commands manually before startup
- configure the relevant IAM/service identity/token setup for AWS/GCP/Azure/Vault
- follow [KMS_SETUP.md](/Users/kyler/repos/kamui/iota/KMS_SETUP.md) for provider examples

## `VRF_KEYPAIR_COMMAND failed` or `OPERATOR_KEY_COMMAND failed`

Cause:

- the provider CLI is missing
- the runtime identity lacks permission to read the secret
- the command returned empty output or malformed JSON

Fix:

- run the configured command manually in the same shell/container
- confirm the CLI auth context is valid
- confirm the secret payload matches the repo example JSON shape
- for VRF keypairs, confirm the command returns both `secretKey` and `publicKey`
