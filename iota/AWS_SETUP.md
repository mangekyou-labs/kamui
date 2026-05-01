# AWS Production Deployment

This guide walks through setting up the Kamui IOTA VRF node on AWS EC2 using AWS Secrets Manager for secret storage and an IAM instance profile for authentication. No long-lived credentials are needed anywhere.

## Prerequisites

- AWS CLI configured locally with sufficient permissions to create IAM roles, secrets, and EC2 instances.
- The VRF keypair and operator key (see [vrf-keypair.example.json](../node/vrf-keypair.example.json) and [operator-keypair.example.json](../node/operator-keypair.example.json) for the required JSON shapes).

---

## Step 1 — Store Secrets in AWS Secrets Manager

Create two secrets in the same region you will run the EC2 instance:

**VRF keypair secret:**

```bash
aws secretsmanager create-secret \
  --name kamui/iota/vrf-keypair \
  --secret-string '{"secretKey":"<32-byte-hex>","publicKey":"<32-byte-hex>"}'
```

**Operator key secret:**

```bash
aws secretsmanager create-secret \
  --name kamui/iota/operator-key \
  --secret-string '{"privateKey":"<32-byte-hex>"}'
```

Replace the hex values with the real keys. The operator key must be the Ed25519 private key used for mainnet transaction signing.

Verify both secrets were stored correctly:

```bash
aws secretsmanager get-secret-value --secret-id kamui/iota/vrf-keypair --query SecretString --output text
aws secretsmanager get-secret-value --secret-id kamui/iota/operator-key --query SecretString --output text
```

---

## Step 2 — Create IAM Role and Instance Profile

The EC2 instance needs an IAM role with permission to read the two secrets. Create a policy and role:

**Create the IAM policy:**

```bash
POLICY_ARN=$(aws iam create-policy \
  --policy-name KamuiIotaVrfNode \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": "secretsmanager:GetSecretValue",
        "Resource": [
          "arn:aws:secretsmanager:<REGION>:<ACCOUNT>:secret:kamui/iota/vrf-keypair",
          "arn:aws:secretsmanager:<REGION>:<ACCOUNT>:secret:kamui/iota/operator-key"
        ]
      }
    ]
  }' \
  --query Policy.Arn --output text)
echo "Policy ARN: $POLICY_ARN"
```

Replace `<REGION>` and `<ACCOUNT>` with your AWS region and account ID. (Or use the specific ARN after creation.)

**Create the IAM role:**

```bash
ROLE_ARN=$(aws iam create-role \
  --role-name KamuiIotaVrfNode \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Principal": { "Service": "ec2.amazonaws.com" },
        "Action": "sts:AssumeRole"
      }
    ]
  }' \
  --query Role.Arn --output text)
echo "Role ARN: $ROLE_ARN"
```

**Attach the policy to the role:**

```bash
aws iam attach-role-policy \
  --role-name KamuiIotaVrfNode \
  --policy-arn "$POLICY_ARN"
```

**Create and attach the instance profile:**

```bash
aws iam create-instance-profile --instance-profile-name KamuiIotaVrfNode
aws iam add-role-to-instance-profile \
  --instance-profile-name KamuiIotaVrfNode \
  --role-name KamuiIotaVrfNode
```

---

## Step 3 — Launch EC2 Instance

Choose an instance type (t3.medium is sufficient for a single VRF oracle node), select your VPC/subnet, and attach the `KamuiIotaVrfNode` instance profile.

**Key requirements:**
- **OS:** Ubuntu 24.04 LTS or Debian 12 (any OS with Docker support)
- **Security group:** Allow outbound HTTPS (443) to IOTA RPC endpoints and AWS Secrets Manager; allow inbound SSH (22) from your IP only
- **Instance profile:** `KamuiIotaVrfNode` attached at launch
- **Docker installed:** You will install Docker on first SSH login

**Install Docker on the instance:**

```bash
ssh ubuntu@<EC2_IP>
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker ubuntu
# Log out and log back in, or run:
newgrp docker
docker run hello-world  # verify Docker works
```

**Clone the repo:**

```bash
git clone https://github.com/mangekyou-network/kamui.git
cd kamui
```

---

## Step 4 — Configure the Node

On the EC2 instance:

```bash
cd kamui
cp iota/node/.env.mainnet.example iota/node/.env
```

Edit `iota/node/.env`. Set only `COORDINATOR_OBJECT_ID`:

```
COORDINATOR_OBJECT_ID=0x14c262fad6898c36ecbf1c27ca972bf3d2ea7c7c03588ee28f101d97c2e4dbdc
```

Leave `VRF_KEYPAIR_COMMAND` and `OPERATOR_KEY_COMMAND` as they are in the example — they already point to the AWS Secrets Manager commands. Make sure the region in those commands matches the region where you created the secrets, e.g.:

```
VRF_KEYPAIR_COMMAND=aws secretsmanager get-secret-value --secret-id kamui/iota/vrf-keypair --query SecretString --output text --region us-east-1
OPERATOR_KEY_COMMAND=aws secretsmanager get-secret-value --secret-id kamui/iota/operator-key --query SecretString --output text --region us-east-1
```

**Validate the AWS secret commands work on the instance:**

```bash
eval "$(aws ecr get-login --region us-east-1 --no-include-email 2>/dev/null)"  # not needed for secrets
eval "$(aws configure get aws_access_key_id 2>/dev/null)"  # instance profile credentials are automatic in the container
# Instead, test from inside Docker since that's where the commands run:
docker run --rm \
  -e VRF_KEYPAIR_COMMAND="aws secretsmanager get-secret-value --secret-id kamui/iota/vrf-keypair --query SecretString --output text --region us-east-1" \
  --entrypoint sh \
  kamui/iota-vrf-node:local \
  -c 'echo "$VRF_KEY_COMMAND_OUTPUT"' \
  # Or simpler: just build and start, watch logs
```

**Build and start the node:**

```bash
# Set the AWS region for the docker-compose override
export AWS_REGION=us-east-1

docker compose \
  -f iota/docker/docker-compose.yml \
  -f iota/docker/docker-compose.aws.yml \
  up --build -d
```

Check the startup logs:

```bash
docker compose -f iota/docker/docker-compose.yml logs -f
```

Confirm `/readyz` returns `ready: true`:

```bash
docker compose -f iota/docker/docker-compose.yml exec kamui-iota-vrf-node \
  node -e "fetch('http://127.0.0.1:9464/readyz').then(r=>r.json()).then(console.log)"
```

Or from your local machine after opening the port:

```bash
curl http://<EC2_PUBLIC_IP>:9464/readyz
```

Expected response:

```json
{"status":"ready","initialized":true,"lastSuccessfulPollAt":"2026-...","circuitBreakerState":"closed",...}
```

---

## Step 5 — Set Up Monitoring (Recommended)

Since ops endpoints are kept private by default, the simplest monitoring approach is to:

**Option A — CloudWatch Agent:**
Install the CloudWatch agent on the EC2 instance to scrape `/metrics` and forward to CloudWatch:

```bash
sudo apt install amazon-cloudwatch-agent
# Configure via /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json
```

**Option B — Prometheus + Grafana:**
Point an existing Prometheus scrape job at the EC2 IP (requires opening port 9464 to your Prometheus server):

```yaml
scrape_configs:
  - job_name: kamui-iota-vrf
    static_configs:
      - targets: ['<EC2_PRIVATE_IP>:9464']
    metrics_path: /metrics
```

---

## Step 6 — Verify the Node Is Fulfilling Requests

Once the node is running, submit a test request against the live coordinator:

```bash
# From anywhere with iota CLI and a funded wallet:
iota client tx \
  --package 0xc871ca37099f0d2fa47b4e9ed0b0b18b8f03cf9ac3bd3da60f5b788e69265126 \
  --module coordinator \
  --function request_randomness \
  --args '0x14c262fad6898c36ecbf1c27ca972bf3d2ea7c7c03588ee28f101d97c2e4dbdc' \
  '<SUBSCRIPTION_ID>' \
  '<YOUR_ADDRESS>' \
  '<SEED_BYTES>' \
  '<NUM_WORDS>' \
  '<CALLBACK_DATA>' \
  --gas-budget 50000000
```

Watch the node logs for the request detection and fulfillment:

```bash
docker compose -f iota/docker/docker-compose.yml logs -f --tail 20
```

You should see entries like:
```
INFO Processing randomness request request_id=<ID> attempt=1
INFO Randomness request fulfilled request_id=<ID> latency_ms=<N>
```

---

## Key Rotation

If you need to rotate the VRF keypair or operator key:

1. Update the secret in AWS Secrets Manager:
   ```bash
   aws secretsmanager put-secret-value \
     --secret-id kamui/iota/vrf-keypair \
     --secret-string '{"secretKey":"<new-hex>","publicKey":"<new-hex>"}'
   ```
2. Restart the container so it re-fetches the secret:
   ```bash
   docker compose -f iota/docker/docker-compose.yml restart
   ```
3. Update the on-chain VRF public key via the coordinator owner:
   ```bash
   # Call set_vrf_public_key on-chain with the new public key
   ```

The node will validate the new key against the coordinator on next startup.

---

## Troubleshooting

**Node fails to fetch secrets:**
- Confirm the instance profile is attached: `aws ec2 describe-instance-attribute --instance-id <ID> --attribute instanceProfile`
- Confirm the IAM role policy covers the exact secret ARNs
- Check that `AWS_REGION` in the container matches the region of the secrets

**Node stays in "not ready" state:**
- Check `docker compose logs` for errors
- Confirm the IOTA RPC URL is reachable from the EC2 instance
- Check `/metrics` for circuit breaker state

**Health check fails:**
- Confirm port 9464 is reachable from your monitoring source
- Check the Docker healthcheck: `docker inspect kamui-iota-vrf-node --format='{{.State.Health.Status}}'`
