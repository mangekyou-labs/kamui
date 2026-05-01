import { chmod, mkdtemp, mkdir, writeFile } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { loadConfig } from './config';

test('loadConfig prefers env secrets over path-based secrets', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'iota-node-config-'));
  const stateDir = path.join(root, 'state');
  const fastcryptoPath = path.join(root, 'ecvrf-cli');
  const vrfPath = path.join(root, 'vrf.json');
  const operatorPath = path.join(root, 'operator.json');
  const vrfCommandPath = path.join(root, 'vrf-command.sh');
  const operatorCommandPath = path.join(root, 'operator-command.sh');

  await mkdir(stateDir, { recursive: true });
  await writeFile(fastcryptoPath, '#!/bin/sh\n');
  await writeFile(
    vrfPath,
    JSON.stringify({
      secretKey: '11'.repeat(32),
      publicKey: '22'.repeat(32),
    }),
  );
  await writeFile(
    operatorPath,
    JSON.stringify({
      privateKey: 'not-used',
    }),
  );
  await writeFile(
    vrfCommandPath,
    `#!/bin/sh
printf '%s\n' '{"secretKey":"${'dd'.repeat(32)}","publicKey":"${'ee'.repeat(32)}"}'
`,
  );
  await writeFile(
    operatorCommandPath,
    `#!/bin/sh
printf '%s\n' '{"privateKey":"${'ff'.repeat(32)}"}'
`,
  );
  await chmod(vrfCommandPath, 0o755);
  await chmod(operatorCommandPath, 0o755);

  const config = await loadConfig({
    IOTA_RPC_URL: 'https://api.testnet.iota.cafe',
    COORDINATOR_PACKAGE_ID: '0x1234',
    COORDINATOR_OBJECT_ID: '0xabcd',
    FASTCRYPTO_CLI_PATH: fastcryptoPath,
    STATE_DIR: stateDir,
    VRF_SECRET_KEY: 'aa'.repeat(32),
    VRF_PUBLIC_KEY: 'cc'.repeat(32),
    VRF_KEYPAIR_PATH: vrfPath,
    VRF_KEYPAIR_COMMAND: vrfCommandPath,
    OPERATOR_PRIVATE_KEY: 'bb'.repeat(32),
    OPERATOR_KEYPAIR_PATH: operatorPath,
    OPERATOR_KEY_COMMAND: operatorCommandPath,
    EVENT_PAGE_SIZE: '75',
    MAX_RETRY_ATTEMPTS: '7',
    RETRY_BASE_DELAY_MS: '1500',
    RETRY_MAX_DELAY_MS: '9000',
    RPC_CIRCUIT_BREAKER_FAILURE_THRESHOLD: '4',
    RPC_CIRCUIT_BREAKER_COOLDOWN_MS: '25000',
  });

  assert.equal(config.vrfSecretSource, 'env');
  assert.equal(config.vrfSecretKey, 'aa'.repeat(32));
  assert.equal(config.vrfPublicKey, 'cc'.repeat(32));
  assert.equal(config.operatorSecretSource, 'env');
  assert.ok(config.operatorSecret instanceof Uint8Array);
  assert.equal(Buffer.from(config.operatorSecret).toString('hex'), 'bb'.repeat(32));
  assert.equal(config.opsHost, '127.0.0.1');
  assert.equal(config.opsPort, 9464);
  assert.equal(config.eventPageSize, 75);
  assert.equal(config.maxRetryAttempts, 7);
  assert.equal(config.retryBaseDelayMs, 1500);
  assert.equal(config.retryMaxDelayMs, 9000);
  assert.equal(config.rpcCircuitBreakerFailureThreshold, 4);
  assert.equal(config.rpcCircuitBreakerCooldownMs, 25000);
});

test('loadConfig supports command-based secret sources', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'iota-node-config-command-'));
  const stateDir = path.join(root, 'state');
  const fastcryptoPath = path.join(root, 'ecvrf-cli');
  const vrfCommandPath = path.join(root, 'vrf-command.sh');
  const operatorCommandPath = path.join(root, 'operator-command.sh');

  await mkdir(stateDir, { recursive: true });
  await writeFile(fastcryptoPath, '#!/bin/sh\n');
  await writeFile(
    vrfCommandPath,
    `#!/bin/sh
printf '%s\n' '{"secretKey":"${'11'.repeat(32)}","publicKey":"${'22'.repeat(32)}"}'
`,
  );
  await writeFile(
    operatorCommandPath,
    `#!/bin/sh
printf '%s\n' '{"privateKey":"${'33'.repeat(32)}"}'
`,
  );
  await chmod(vrfCommandPath, 0o755);
  await chmod(operatorCommandPath, 0o755);

  const config = await loadConfig({
    IOTA_RPC_URL: 'https://api.mainnet.iota.cafe',
    COORDINATOR_PACKAGE_ID: '0x1234',
    COORDINATOR_OBJECT_ID: '0xabcd',
    FASTCRYPTO_CLI_PATH: fastcryptoPath,
    STATE_DIR: stateDir,
    VRF_KEYPAIR_COMMAND: vrfCommandPath,
    OPERATOR_KEY_COMMAND: operatorCommandPath,
  });

  assert.equal(config.vrfSecretSource, 'command');
  assert.equal(config.vrfSecretKey, '11'.repeat(32));
  assert.equal(config.vrfPublicKey, '22'.repeat(32));
  assert.equal(config.operatorSecretSource, 'command');
  assert.ok(config.operatorSecret instanceof Uint8Array);
  assert.equal(Buffer.from(config.operatorSecret).toString('hex'), '33'.repeat(32));
});

test('loadConfig sanitizes command failure output', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'iota-node-config-command-fail-'));
  const stateDir = path.join(root, 'state');
  const fastcryptoPath = path.join(root, 'ecvrf-cli');
  const vrfCommandPath = path.join(root, 'vrf-command.sh');

  await mkdir(stateDir, { recursive: true });
  await writeFile(fastcryptoPath, '#!/bin/sh\n');
  await writeFile(
    vrfCommandPath,
    `#!/bin/sh
echo '{"secretKey":"${'44'.repeat(32)}"}' >&2
exit 9
`,
  );
  await chmod(vrfCommandPath, 0o755);

  await assert.rejects(
    () =>
      loadConfig({
        IOTA_RPC_URL: 'https://api.mainnet.iota.cafe',
        COORDINATOR_PACKAGE_ID: '0x1234',
        COORDINATOR_OBJECT_ID: '0xabcd',
        FASTCRYPTO_CLI_PATH: fastcryptoPath,
        STATE_DIR: stateDir,
        VRF_KEYPAIR_COMMAND: vrfCommandPath,
        OPERATOR_PRIVATE_KEY: 'bb'.repeat(32),
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /VRF_KEYPAIR_COMMAND failed/);
      assert.doesNotMatch(error.message, new RegExp('44'.repeat(32)));
      return true;
    },
  );
});

test('loadConfig requires VRF_PUBLIC_KEY when VRF_SECRET_KEY is provided', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'iota-node-config-missing-pk-'));
  const stateDir = path.join(root, 'state');
  const fastcryptoPath = path.join(root, 'ecvrf-cli');

  await mkdir(stateDir, { recursive: true });
  await writeFile(fastcryptoPath, '#!/bin/sh\n');

  await assert.rejects(
    () =>
      loadConfig({
        IOTA_RPC_URL: 'https://api.testnet.iota.cafe',
        COORDINATOR_PACKAGE_ID: '0x1234',
        COORDINATOR_OBJECT_ID: '0xabcd',
        FASTCRYPTO_CLI_PATH: fastcryptoPath,
        STATE_DIR: stateDir,
        VRF_SECRET_KEY: 'aa'.repeat(32),
        OPERATOR_PRIVATE_KEY: 'bb'.repeat(32),
      }),
    /VRF_PUBLIC_KEY is required/,
  );
});

test('loadConfig rejects invalid OPS_PORT values', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'iota-node-config-bad-port-'));
  const stateDir = path.join(root, 'state');
  const fastcryptoPath = path.join(root, 'ecvrf-cli');
  const vrfPath = path.join(root, 'vrf.json');
  const operatorPath = path.join(root, 'operator.json');

  await mkdir(stateDir, { recursive: true });
  await writeFile(fastcryptoPath, '#!/bin/sh\n');
  await writeFile(
    vrfPath,
    JSON.stringify({
      secretKey: '11'.repeat(32),
      publicKey: '22'.repeat(32),
    }),
  );
  await writeFile(
    operatorPath,
    JSON.stringify({
      privateKey: 'bb'.repeat(32),
    }),
  );

  await assert.rejects(
    () =>
      loadConfig({
        IOTA_RPC_URL: 'https://api.testnet.iota.cafe',
        COORDINATOR_PACKAGE_ID: '0x1234',
        COORDINATOR_OBJECT_ID: '0xabcd',
        FASTCRYPTO_CLI_PATH: fastcryptoPath,
        STATE_DIR: stateDir,
        OPS_PORT: '70000',
        VRF_KEYPAIR_PATH: vrfPath,
        OPERATOR_KEYPAIR_PATH: operatorPath,
      }),
    /OPS_PORT must be between 1 and 65535/,
  );
});

test('loadConfig rejects non-positive tuning values', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'iota-node-config-bad-tuning-'));
  const stateDir = path.join(root, 'state');
  const fastcryptoPath = path.join(root, 'ecvrf-cli');
  const vrfPath = path.join(root, 'vrf.json');
  const operatorPath = path.join(root, 'operator.json');

  await mkdir(stateDir, { recursive: true });
  await writeFile(fastcryptoPath, '#!/bin/sh\n');
  await writeFile(
    vrfPath,
    JSON.stringify({
      secretKey: '11'.repeat(32),
      publicKey: '22'.repeat(32),
    }),
  );
  await writeFile(
    operatorPath,
    JSON.stringify({
      privateKey: 'bb'.repeat(32),
    }),
  );

  await assert.rejects(
    () =>
      loadConfig({
        IOTA_RPC_URL: 'https://api.testnet.iota.cafe',
        COORDINATOR_PACKAGE_ID: '0x1234',
        COORDINATOR_OBJECT_ID: '0xabcd',
        FASTCRYPTO_CLI_PATH: fastcryptoPath,
        STATE_DIR: stateDir,
        EVENT_PAGE_SIZE: '0',
        VRF_KEYPAIR_PATH: vrfPath,
        OPERATOR_KEYPAIR_PATH: operatorPath,
      }),
    /EVENT_PAGE_SIZE must be a positive integer/,
  );
});
