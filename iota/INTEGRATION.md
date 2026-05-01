# IOTA VRF Integration Guide

This guide is the shortest path from repo checkout to a working consumer and node integration.

## 1. Pick Your Path

- Local/testnet walkthrough: [DEMO.md](/Users/kyler/repos/kamui/iota/DEMO.md)
- Mainnet operator config: [MAINNET_NODE_CONFIG.md](/Users/kyler/repos/kamui/iota/MAINNET_NODE_CONFIG.md)
- Mainnet package publish + coordinator creation history: [MAINNET_PUBLISH.md](/Users/kyler/repos/kamui/iota/MAINNET_PUBLISH.md)

## 2. Consumer Integration Contract

Your consumer integration should assume:

- request creation emits `kamui_iota_vrf::request::RandomnessRequested`
- fulfillment is permissionless but proof-gated on-chain by `iota::ecvrf::ecvrf_verify`
- completed results are keyed by `request_id`
- consumers should treat fulfillment as asynchronous and read the result only after coordinator state is `fulfilled`

Reference implementations:

- coordinator modules: [coordinator.move](/Users/kyler/repos/kamui/iota/move/sources/coordinator.move)
- request lifecycle: [request.move](/Users/kyler/repos/kamui/iota/move/sources/request.move)
- demo consumer: [demo_consumer.move](/Users/kyler/repos/kamui/iota/move/sources/demo_consumer.move)

## 3. Node Integration

Configure the node with:

- `IOTA_RPC_URL`
- `COORDINATOR_PACKAGE_ID`
- `COORDINATOR_OBJECT_ID`
- `FASTCRYPTO_CLI_PATH`
- one VRF secret source
- one operator secret source

Supported secret sources:

- env
- file
- command

The template files are:

- testnet/local: [iota/node/.env.example](/Users/kyler/repos/kamui/iota/node/.env.example)
- mainnet: [iota/node/.env.mainnet.example](/Users/kyler/repos/kamui/iota/node/.env.mainnet.example)

Build the vendored, validated prover binary for local runs:

```bash
cd iota/fastcrypto
cargo build --locked --release --bin ecvrf-cli
```

Validated ref:

- `c141d4c2d52efe18d2b9193b071fdc188411da3b`

The node now invokes `ecvrf-cli` with `--secret-key-stdin`, so it expects the patched vendored binary from this repo rather than an older upstream build.

For KMS/vault-backed deployments, configure:

- `VRF_KEYPAIR_COMMAND`
- `OPERATOR_KEY_COMMAND`

Examples for AWS/GCP/Azure/Vault are in [KMS_SETUP.md](/Users/kyler/repos/kamui/iota/KMS_SETUP.md).

## 4. Runtime Modes

Local process:

```bash
cd iota/node
npm test
npm start
```

Docker with private ops endpoints:

```bash
docker compose -f iota/docker/docker-compose.yml up --build
```

Docker with host-published ops endpoints:

```bash
docker compose -f iota/docker/docker-compose.yml -f iota/docker/docker-compose.public-ops.yml up --build
```

The default compose file keeps `/healthz`, `/readyz`, and `/metrics` private inside the container/network. Use the override only when you intentionally want host exposure.

## 5. Verification

Minimum validation before handoff:

- `cd iota/move && iota move test`
- `cd iota/node && npm test`
- `docker compose -f iota/docker/docker-compose.yml config`
- `docker compose -f iota/docker/docker-compose.yml -f iota/docker/docker-compose.public-ops.yml config`

If you are validating against mainnet, also confirm the pinned package/coordinator artifacts in [MAINNET_PUBLISH.md](/Users/kyler/repos/kamui/iota/MAINNET_PUBLISH.md).

## 6. Troubleshooting

Use [TROUBLESHOOTING.md](/Users/kyler/repos/kamui/iota/TROUBLESHOOTING.md) for the current failure matrix.
