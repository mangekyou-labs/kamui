# KMS / Vault Secret Setup

The node now supports a command-based secret source for production deployments.

At startup it can execute:

- `VRF_KEYPAIR_COMMAND`
- `OPERATOR_KEY_COMMAND`

This lets you keep the real keys in AWS Secrets Manager, GCP Secret Manager, Azure Key Vault, or HashiCorp Vault, and only fetch them when the node starts.

## Output Format

`VRF_KEYPAIR_COMMAND` must print JSON:

```json
{"secretKey":"<32-byte-hex>","publicKey":"<32-byte-hex>"}
```

`OPERATOR_KEY_COMMAND` can print either:

```json
{"privateKey":"<32-byte-hex>"}
```

or the raw 32-byte hex private key.

The command output is read from stdout. Non-zero exits fail startup. Secret-bearing stderr/stdout is sanitized before it is surfaced in node errors.

## `.env` Pattern

In [iota/node/.env.mainnet.example](/Users/kyler/repos/kamui/iota/node/.env.mainnet.example), leave the direct/file secret vars blank and set:

```bash
VRF_KEYPAIR_COMMAND=...
OPERATOR_KEY_COMMAND=...
```

Use exactly one source per secret:

- env
- command
- file

Precedence is:

- env
- command
- file

## AWS Secrets Manager

Store the VRF keypair secret value as:

```json
{"secretKey":"<32-byte-hex>","publicKey":"<32-byte-hex>"}
```

Store the operator key secret value as:

```json
{"privateKey":"<32-byte-hex>"}
```

Example `.env` values:

```bash
VRF_KEYPAIR_COMMAND=aws secretsmanager get-secret-value --secret-id kamui/iota/vrf-keypair --query SecretString --output text
OPERATOR_KEY_COMMAND=aws secretsmanager get-secret-value --secret-id kamui/iota/operator-key --query SecretString --output text
```

Auth options:

- EC2/ECS/EKS role
- `AWS_PROFILE`
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN`

Minimum permission:

- `secretsmanager:GetSecretValue`

## GCP Secret Manager

Store the same JSON payloads as the secret values.

Example `.env` values:

```bash
VRF_KEYPAIR_COMMAND=gcloud secrets versions access latest --secret=kamui-iota-vrf-keypair
OPERATOR_KEY_COMMAND=gcloud secrets versions access latest --secret=kamui-iota-operator-key
```

Auth options:

- GCE/GKE service account
- `gcloud auth application-default login`
- `GOOGLE_APPLICATION_CREDENTIALS`

Minimum permission:

- `roles/secretmanager.secretAccessor`

## Azure Key Vault

Store the same JSON payloads as the secret values.

Example `.env` values:

```bash
VRF_KEYPAIR_COMMAND=az keyvault secret show --vault-name <vault-name> --name kamui-iota-vrf-keypair --query value -o tsv
OPERATOR_KEY_COMMAND=az keyvault secret show --vault-name <vault-name> --name kamui-iota-operator-key --query value -o tsv
```

Auth options:

- Managed Identity
- `az login`
- service principal credentials

Minimum permission:

- `Key Vault Secrets User` or equivalent secret-read access

## HashiCorp Vault

One simple pattern is to store JSON strings in KV fields:

- `secret/kamui/iota` field `vrf_keypair`
- `secret/kamui/iota` field `operator_key`

Example `.env` values:

```bash
VRF_KEYPAIR_COMMAND=vault kv get -field=vrf_keypair secret/kamui/iota
OPERATOR_KEY_COMMAND=vault kv get -field=operator_key secret/kamui/iota
```

Auth options:

- token
- AppRole
- Kubernetes auth
- cloud IAM auth methods

Required environment is typically:

```bash
VAULT_ADDR=https://vault.example.com
VAULT_TOKEN=...
```

or the equivalent auth-role configuration for your chosen method.

## Operational Notes

- The command runs at node startup. If you rotate a secret, restart the node so it re-fetches the latest value.
- Prefer instance/workload identity over long-lived local credentials.
- Keep the secret payload shape identical to the repo example files:
  - [vrf-keypair.example.json](/Users/kyler/repos/kamui/iota/node/vrf-keypair.example.json)
  - [operator-keypair.example.json](/Users/kyler/repos/kamui/iota/node/operator-keypair.example.json)
- Test the commands manually before starting the node:

```bash
eval "$VRF_KEYPAIR_COMMAND"
eval "$OPERATOR_KEY_COMMAND"
```

- Then start the node and confirm it reports:
  - `vrf_secret_source: "command"`
  - `operator_secret_source: "command"`
