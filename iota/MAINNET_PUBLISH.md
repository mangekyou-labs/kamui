# Mainnet Publish Runbook

This runbook covers the `publish Move package` step for the IOTA VRF mainnet deployment.

## Current Status

- Local package build passes with `cd iota/move && iota move build`.
- Mainnet package publish succeeded on `2026-03-18`.
- Chain identifier: `6364aad5`
- Publish transaction digest: `2aUubEafHMXdrgoe5feTfKmJkozPVeGnqQA5mzzArzkf`
- Published package ID: `0xc871ca37099f0d2fa47b4e9ed0b0b18b8f03cf9ac3bd3da60f5b788e69265126`
- Upgrade cap object ID: `0x67ad0d6c28cd664daa73beecc983f2b7ef1f4b39601997144f9a4b83a8f0c898`
- Gas used: `50,894,000` NANOS (`0.050894` IOTA)
- The local CLI was still `iota 1.16.2` during publish and warned about mainnet server API `1.18.1` / protocol version `21`; upgrade the CLI before subsequent mainnet admin transactions.

## Publish Prerequisites

- Fund the mainnet signer address with enough IOTA to cover package publish gas.
- Upgrade the IOTA CLI so client and mainnet server versions match, or explicitly re-validate compatibility.
- Confirm the keystore contains the intended mainnet publisher key.
- Confirm the VRF public key bytes and initial `fee_per_request` / `fulfiller_reward` values that will be used when the coordinator is created after publish.

## Use A Temp Mainnet Client Config

This avoids mutating the default local client state while running mainnet checks:

```bash
mkdir -p .tmp
iota keytool --keystore-path ./.tmp/iota-mainnet.keystore import "$(sed -n 's/^mnemonic=\"\(.*\)\"/\1/p' iota/node/.env)" ed25519 --alias funded_mainnet --json
export FUNDED_MAINNET_ADDRESS=0x...
python3 - <<'PY'
from pathlib import Path
import os
src = Path.home().joinpath('.iota/iota_config/client.yaml').read_text()
lines = []
for line in src.splitlines():
    if line.startswith('  File: '):
        lines.append(f'  File: {Path.cwd() / ".tmp/iota-mainnet.keystore"}')
    elif line.startswith('active_env: '):
        lines.append('active_env: mainnet')
    elif line.startswith('active_address: '):
        lines.append(f'active_address: "{os.environ["FUNDED_MAINNET_ADDRESS"]}"')
    else:
        lines.append(line)
Path('.tmp/iota-mainnet-client.yaml').write_text("\n".join(lines) + "\n")
PY
```

## Preflight Checks

Confirm the client is talking to mainnet and that the signer is funded:

```bash
iota client --client.config ./.tmp/iota-mainnet-client.yaml chain-identifier
iota client --client.config ./.tmp/iota-mainnet-client.yaml active-address
iota client --client.config ./.tmp/iota-mainnet-client.yaml balance
iota client --client.config ./.tmp/iota-mainnet-client.yaml gas
```

If `balance` reports no coins or `gas` reports no gas objects, stop here and fund the signer before attempting publish.

## Publish Command

Run the publish from the repo root:

```bash
iota client --client.config ./.tmp/iota-mainnet-client.yaml publish iota/move --gas-budget <GAS_BUDGET_NANOS>
```

Record these artifacts from the successful publish:

- publish transaction digest
- published package ID
- upgrade cap object ID
- sender address
- chain identifier
- CLI version used for publish

## After Publish

- `create_coordinator(...)` completed on `2026-03-18`.
- Chosen live parameters:
  - `fee_per_request = 1_000_000`
  - `fulfiller_reward = 800_000`
  - `vrf_public_key = fc1a737d32b04017feb698701d04e99784b4116cd7e88fe2471b4926bcace54f`
- Coordinator creation transaction digest: `ELTY6msVVQznjQ4UGnD8rwFMnkdJ5wxB1CH4v9qXRAgi`
- Shared coordinator object ID: `0x14c262fad6898c36ecbf1c27ca972bf3d2ea7c7c03588ee28f101d97c2e4dbdc`
- Mainnet node startup was validated with `/readyz=ready`.
- Real mainnet demo flow was validated:
  - setup tx: `H6QUg2EBW3xc3GWHYHfPAZ95cYtp2KdzKM9ADxaRsqUj`
  - request tx: `Cm6Naj3edSsu4bDymSvJAhMqnaa7sQJeHfTbD6vDejk4`
  - fulfill tx: `2LRD51eTUhN6mTNGJKwmBdqqsmVHX5YNFYtKdVstwFWP`
  - consume tx: `3yQTW6inu4wXqfyhK3KWDJ2TdBYdUSkMxXzansC4Cow2`
- Note: mainnet still rejected Move view calls during the first startup attempt, so the node now uses object-content and dynamic-field reads for coordinator introspection on mainnet.
