# Mainnet Node Config & Credentials

This guide explains exactly how to provide the configuration and credentials needed to:

1. create the mainnet coordinator
2. start the IOTA VRF node against mainnet
3. run the node safely without committing secrets into the repo

## What You Must Provide

### 1. Mainnet coordinator values

These are the deployment-specific values that cannot be guessed safely:

- `fee_per_request`
- `fulfiller_reward`
- the intended VRF public key for the live coordinator

You will use those values when calling `create_coordinator(...)`. After that transaction succeeds, record:

- `COORDINATOR_OBJECT_ID`
- `COORDINATOR_PACKAGE_ID`

The package ID is already published:

- `0xc871ca37099f0d2fa47b4e9ed0b0b18b8f03cf9ac3bd3da60f5b788e69265126`

### 2. VRF proving credentials

The node needs the VRF secret key and matching public key. The config loader supports three modes:

- env mode:
  - `VRF_SECRET_KEY`
  - `VRF_PUBLIC_KEY`
- command mode:
  - `VRF_KEYPAIR_COMMAND`
  - command stdout must be JSON with `secretKey` and `publicKey`
- file mode:
  - `VRF_KEYPAIR_PATH`
  - JSON shape shown in [vrf-keypair.example.json](/Users/kyler/repos/kamui/iota/node/vrf-keypair.example.json)

Use 32-byte lowercase hex strings without spaces. The public key must match the secret key exactly because node startup validates it against the on-chain coordinator key.

### 3. Operator signing credentials

The node also needs an Ed25519 signer for submit transactions. The config loader supports:

- env mode:
  - `OPERATOR_PRIVATE_KEY`
- command mode:
  - `OPERATOR_KEY_COMMAND`
  - command stdout can be raw hex or JSON with `privateKey`
- file mode:
  - `OPERATOR_KEYPAIR_PATH`
  - JSON shape shown in [operator-keypair.example.json](/Users/kyler/repos/kamui/iota/node/operator-keypair.example.json)

For predictable behavior, provide the operator key as a 32-byte hex string.

### 4. Runtime config

At minimum you must set:

- `IOTA_RPC_URL`
- `COORDINATOR_PACKAGE_ID`
- `COORDINATOR_OBJECT_ID`
- `FASTCRYPTO_CLI_PATH`
- one VRF secret mode
- one operator secret mode

The full mainnet template lives at [iota/node/.env.mainnet.example](/Users/kyler/repos/kamui/iota/node/.env.mainnet.example).

The Docker image and local examples now target the vendored `fastcrypto` tree pinned at:

- `c141d4c2d52efe18d2b9193b071fdc188411da3b`

## Recommended Ways To Provide Secrets

### Local/manual bring-up

Use a local `.env` file plus ignored JSON files:

```bash
cp iota/node/.env.mainnet.example iota/node/.env
cp iota/node/vrf-keypair.example.json iota/node/vrf-keypair.json
cp iota/node/operator-keypair.example.json iota/node/operator-keypair.json
```

Then edit the copied files with the real values.

The new [iota/node/.gitignore](/Users/kyler/repos/kamui/iota/node/.gitignore) ignores:

- `iota/node/.env`
- `iota/node/state/`
- `iota/node/vrf-keypair.json`
- `iota/node/operator-keypair.json`

### Docker / Compose

The compose file at [iota/docker/docker-compose.yml](/Users/kyler/repos/kamui/iota/docker/docker-compose.yml) mounts `iota/node/.env` into the container. That means:

- fill `iota/node/.env` from the mainnet template
- env-based secrets and command-based secret loading work with the base compose file
- if you use file-based secrets with the default filenames in `iota/node/.env`, add [docker-compose.file-secrets.yml](/Users/kyler/repos/kamui/iota/docker/docker-compose.file-secrets.yml) so the key JSON files are mounted into the container
- if you use custom file paths instead of the defaults, update that override or add equivalent bind mounts
- the default compose file does **not** publish `/healthz`, `/readyz`, or `/metrics` to the host

If you need host-visible ops endpoints, use the explicit override:

```bash
docker compose -f iota/docker/docker-compose.yml -f iota/docker/docker-compose.public-ops.yml up --build
```

That override switches `OPS_HOST` to `0.0.0.0` and publishes `OPS_PORT`.

If you need Docker path-based secrets with the default filenames, use:

```bash
docker compose -f iota/docker/docker-compose.yml -f iota/docker/docker-compose.file-secrets.yml up --build
```

### KMS-backed production

The node now supports command-based secret loading at startup. That means the live process can fetch keys through your provider CLI without checking secrets into git or materializing long-lived local key files.

Use:

- `VRF_KEYPAIR_COMMAND`
- `OPERATOR_KEY_COMMAND`

Provider examples for AWS Secrets Manager, GCP Secret Manager, Azure Key Vault, and HashiCorp Vault are in [KMS_SETUP.md](/Users/kyler/repos/kamui/iota/KMS_SETUP.md).

Recommended production pattern:

- grant the host/pod/service identity read-only access to the relevant secret objects
- configure the command vars in `iota/node/.env`
- verify the commands return the expected JSON/raw payload before starting the node
- restart the node after secret rotation so it re-fetches the latest value

### AWS EC2 (recommended for production)

The Docker runtime image now includes AWS CLI v2 so the container can fetch secrets from AWS Secrets Manager directly. No secrets need to exist on the EC2 disk.

**Prerequisites:**
1. An EC2 instance with Docker installed and an IAM instance profile attached.
2. The instance profile has a role with `secretsmanager:GetSecretValue` permission for your secrets.
3. Your secrets are stored in Secrets Manager (see [KMS_SETUP.md](/Users/kyler/repos/kamui/iota/KMS_SETUP.md) for format).

**Clone the repo on the EC2, then:**

```bash
# Set AWS_REGION before running — defaults to us-east-1 if not set
AWS_REGION=us-east-1 docker compose \
  -f iota/docker/docker-compose.yml \
  -f iota/docker/docker-compose.aws.yml \
  up --build -d
```

Validate the compose config:

```bash
AWS_REGION=us-east-1 docker compose \
  -f iota/docker/docker-compose.yml \
  -f iota/docker/docker-compose.aws.yml \
  config
```

For the full EC2 + IAM + Secrets Manager walkthrough, see [AWS_SETUP.md](/Users/kyler/repos/kamui/iota/AWS_SETUP.md).

The `docker-compose.aws.yml` override sets `AWS_REGION` in the container so the AWS CLI routes requests to the correct region. The instance profile credentials are picked up automatically by the AWS CLI inside the container — no `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY` needed.

## Step-By-Step Bring-Up

1. Copy the mainnet template:

```bash
cp iota/node/.env.mainnet.example iota/node/.env
```

2. Fill these values first:

- `COORDINATOR_PACKAGE_ID`
- `COORDINATOR_OBJECT_ID` after `create_coordinator(...)`
- `FASTCRYPTO_CLI_PATH`
- one VRF secret source:
  - `VRF_SECRET_KEY` + `VRF_PUBLIC_KEY`
  - `VRF_KEYPAIR_PATH`
  - `VRF_KEYPAIR_COMMAND`
- one operator secret source:
  - `OPERATOR_PRIVATE_KEY`
  - `OPERATOR_KEYPAIR_PATH`
  - `OPERATOR_KEY_COMMAND`

3. Keep secret files local only.

4. Validate the compose wiring if you plan to run in Docker:

```bash
docker compose -f iota/docker/docker-compose.yml config
```

If you use file-based secrets with the default filenames, validate the extra bind mounts too:

```bash
docker compose -f iota/docker/docker-compose.yml -f iota/docker/docker-compose.file-secrets.yml config
```

5. Start the node:

```bash
cd iota/node
npm start
```

Or with Docker:

```bash
docker compose -f iota/docker/docker-compose.yml up --build
```

Or with Docker plus path-based secrets at the default filenames:

```bash
docker compose -f iota/docker/docker-compose.yml -f iota/docker/docker-compose.file-secrets.yml up --build
```

Or with host-published ops endpoints:

```bash
docker compose -f iota/docker/docker-compose.yml -f iota/docker/docker-compose.public-ops.yml up --build
```

## What's Already Configured

The coordinator is live on mainnet with these real values:

- `fee_per_request = 1_000_000`
- `fulfiller_reward = 800_000`
- `vrf_public_key = fc1a737d32b04017...`
- `COORDINATOR_OBJECT_ID = 0x14c262fad6898c36ecbf1c27ca972bf3d2ea7c7c03588ee28f101d97c2e4dbdc`

These are already pinned in [MAINNET_PUBLISH.md](/Users/kyler/repos/kamui/iota/MAINNET_PUBLISH.md). Copy `COORDINATOR_OBJECT_ID` into your `.env` and you are ready to start the node.
