"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const promises_1 = require("fs/promises");
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const config_1 = require("./config");
(0, node_test_1.default)('loadConfig prefers env secrets over path-based secrets', async () => {
    const root = await (0, promises_1.mkdtemp)(path.join(os.tmpdir(), 'iota-node-config-'));
    const stateDir = path.join(root, 'state');
    const fastcryptoPath = path.join(root, 'ecvrf-cli');
    const vrfPath = path.join(root, 'vrf.json');
    const operatorPath = path.join(root, 'operator.json');
    const vrfCommandPath = path.join(root, 'vrf-command.sh');
    const operatorCommandPath = path.join(root, 'operator-command.sh');
    await (0, promises_1.mkdir)(stateDir, { recursive: true });
    await (0, promises_1.writeFile)(fastcryptoPath, '#!/bin/sh\n');
    await (0, promises_1.writeFile)(vrfPath, JSON.stringify({
        secretKey: '11'.repeat(32),
        publicKey: '22'.repeat(32),
    }));
    await (0, promises_1.writeFile)(operatorPath, JSON.stringify({
        privateKey: 'not-used',
    }));
    await (0, promises_1.writeFile)(vrfCommandPath, `#!/bin/sh
printf '%s\n' '{"secretKey":"${'dd'.repeat(32)}","publicKey":"${'ee'.repeat(32)}"}'
`);
    await (0, promises_1.writeFile)(operatorCommandPath, `#!/bin/sh
printf '%s\n' '{"privateKey":"${'ff'.repeat(32)}"}'
`);
    await (0, promises_1.chmod)(vrfCommandPath, 0o755);
    await (0, promises_1.chmod)(operatorCommandPath, 0o755);
    const config = await (0, config_1.loadConfig)({
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
    strict_1.default.equal(config.vrfSecretSource, 'env');
    strict_1.default.equal(config.vrfSecretKey, 'aa'.repeat(32));
    strict_1.default.equal(config.vrfPublicKey, 'cc'.repeat(32));
    strict_1.default.equal(config.operatorSecretSource, 'env');
    strict_1.default.ok(config.operatorSecret instanceof Uint8Array);
    strict_1.default.equal(Buffer.from(config.operatorSecret).toString('hex'), 'bb'.repeat(32));
    strict_1.default.equal(config.opsHost, '127.0.0.1');
    strict_1.default.equal(config.opsPort, 9464);
    strict_1.default.equal(config.eventPageSize, 75);
    strict_1.default.equal(config.maxRetryAttempts, 7);
    strict_1.default.equal(config.retryBaseDelayMs, 1500);
    strict_1.default.equal(config.retryMaxDelayMs, 9000);
    strict_1.default.equal(config.rpcCircuitBreakerFailureThreshold, 4);
    strict_1.default.equal(config.rpcCircuitBreakerCooldownMs, 25000);
});
(0, node_test_1.default)('loadConfig supports command-based secret sources', async () => {
    const root = await (0, promises_1.mkdtemp)(path.join(os.tmpdir(), 'iota-node-config-command-'));
    const stateDir = path.join(root, 'state');
    const fastcryptoPath = path.join(root, 'ecvrf-cli');
    const vrfCommandPath = path.join(root, 'vrf-command.sh');
    const operatorCommandPath = path.join(root, 'operator-command.sh');
    await (0, promises_1.mkdir)(stateDir, { recursive: true });
    await (0, promises_1.writeFile)(fastcryptoPath, '#!/bin/sh\n');
    await (0, promises_1.writeFile)(vrfCommandPath, `#!/bin/sh
printf '%s\n' '{"secretKey":"${'11'.repeat(32)}","publicKey":"${'22'.repeat(32)}"}'
`);
    await (0, promises_1.writeFile)(operatorCommandPath, `#!/bin/sh
printf '%s\n' '{"privateKey":"${'33'.repeat(32)}"}'
`);
    await (0, promises_1.chmod)(vrfCommandPath, 0o755);
    await (0, promises_1.chmod)(operatorCommandPath, 0o755);
    const config = await (0, config_1.loadConfig)({
        IOTA_RPC_URL: 'https://api.mainnet.iota.cafe',
        COORDINATOR_PACKAGE_ID: '0x1234',
        COORDINATOR_OBJECT_ID: '0xabcd',
        FASTCRYPTO_CLI_PATH: fastcryptoPath,
        STATE_DIR: stateDir,
        VRF_KEYPAIR_COMMAND: vrfCommandPath,
        OPERATOR_KEY_COMMAND: operatorCommandPath,
    });
    strict_1.default.equal(config.vrfSecretSource, 'command');
    strict_1.default.equal(config.vrfSecretKey, '11'.repeat(32));
    strict_1.default.equal(config.vrfPublicKey, '22'.repeat(32));
    strict_1.default.equal(config.operatorSecretSource, 'command');
    strict_1.default.ok(config.operatorSecret instanceof Uint8Array);
    strict_1.default.equal(Buffer.from(config.operatorSecret).toString('hex'), '33'.repeat(32));
});
(0, node_test_1.default)('loadConfig sanitizes command failure output', async () => {
    const root = await (0, promises_1.mkdtemp)(path.join(os.tmpdir(), 'iota-node-config-command-fail-'));
    const stateDir = path.join(root, 'state');
    const fastcryptoPath = path.join(root, 'ecvrf-cli');
    const vrfCommandPath = path.join(root, 'vrf-command.sh');
    await (0, promises_1.mkdir)(stateDir, { recursive: true });
    await (0, promises_1.writeFile)(fastcryptoPath, '#!/bin/sh\n');
    await (0, promises_1.writeFile)(vrfCommandPath, `#!/bin/sh
echo '{"secretKey":"${'44'.repeat(32)}"}' >&2
exit 9
`);
    await (0, promises_1.chmod)(vrfCommandPath, 0o755);
    await strict_1.default.rejects(() => (0, config_1.loadConfig)({
        IOTA_RPC_URL: 'https://api.mainnet.iota.cafe',
        COORDINATOR_PACKAGE_ID: '0x1234',
        COORDINATOR_OBJECT_ID: '0xabcd',
        FASTCRYPTO_CLI_PATH: fastcryptoPath,
        STATE_DIR: stateDir,
        VRF_KEYPAIR_COMMAND: vrfCommandPath,
        OPERATOR_PRIVATE_KEY: 'bb'.repeat(32),
    }), (error) => {
        strict_1.default.ok(error instanceof Error);
        strict_1.default.match(error.message, /VRF_KEYPAIR_COMMAND failed/);
        strict_1.default.doesNotMatch(error.message, new RegExp('44'.repeat(32)));
        return true;
    });
});
(0, node_test_1.default)('loadConfig requires VRF_PUBLIC_KEY when VRF_SECRET_KEY is provided', async () => {
    const root = await (0, promises_1.mkdtemp)(path.join(os.tmpdir(), 'iota-node-config-missing-pk-'));
    const stateDir = path.join(root, 'state');
    const fastcryptoPath = path.join(root, 'ecvrf-cli');
    await (0, promises_1.mkdir)(stateDir, { recursive: true });
    await (0, promises_1.writeFile)(fastcryptoPath, '#!/bin/sh\n');
    await strict_1.default.rejects(() => (0, config_1.loadConfig)({
        IOTA_RPC_URL: 'https://api.testnet.iota.cafe',
        COORDINATOR_PACKAGE_ID: '0x1234',
        COORDINATOR_OBJECT_ID: '0xabcd',
        FASTCRYPTO_CLI_PATH: fastcryptoPath,
        STATE_DIR: stateDir,
        VRF_SECRET_KEY: 'aa'.repeat(32),
        OPERATOR_PRIVATE_KEY: 'bb'.repeat(32),
    }), /VRF_PUBLIC_KEY is required/);
});
(0, node_test_1.default)('loadConfig rejects invalid OPS_PORT values', async () => {
    const root = await (0, promises_1.mkdtemp)(path.join(os.tmpdir(), 'iota-node-config-bad-port-'));
    const stateDir = path.join(root, 'state');
    const fastcryptoPath = path.join(root, 'ecvrf-cli');
    const vrfPath = path.join(root, 'vrf.json');
    const operatorPath = path.join(root, 'operator.json');
    await (0, promises_1.mkdir)(stateDir, { recursive: true });
    await (0, promises_1.writeFile)(fastcryptoPath, '#!/bin/sh\n');
    await (0, promises_1.writeFile)(vrfPath, JSON.stringify({
        secretKey: '11'.repeat(32),
        publicKey: '22'.repeat(32),
    }));
    await (0, promises_1.writeFile)(operatorPath, JSON.stringify({
        privateKey: 'bb'.repeat(32),
    }));
    await strict_1.default.rejects(() => (0, config_1.loadConfig)({
        IOTA_RPC_URL: 'https://api.testnet.iota.cafe',
        COORDINATOR_PACKAGE_ID: '0x1234',
        COORDINATOR_OBJECT_ID: '0xabcd',
        FASTCRYPTO_CLI_PATH: fastcryptoPath,
        STATE_DIR: stateDir,
        OPS_PORT: '70000',
        VRF_KEYPAIR_PATH: vrfPath,
        OPERATOR_KEYPAIR_PATH: operatorPath,
    }), /OPS_PORT must be between 1 and 65535/);
});
(0, node_test_1.default)('loadConfig rejects non-positive tuning values', async () => {
    const root = await (0, promises_1.mkdtemp)(path.join(os.tmpdir(), 'iota-node-config-bad-tuning-'));
    const stateDir = path.join(root, 'state');
    const fastcryptoPath = path.join(root, 'ecvrf-cli');
    const vrfPath = path.join(root, 'vrf.json');
    const operatorPath = path.join(root, 'operator.json');
    await (0, promises_1.mkdir)(stateDir, { recursive: true });
    await (0, promises_1.writeFile)(fastcryptoPath, '#!/bin/sh\n');
    await (0, promises_1.writeFile)(vrfPath, JSON.stringify({
        secretKey: '11'.repeat(32),
        publicKey: '22'.repeat(32),
    }));
    await (0, promises_1.writeFile)(operatorPath, JSON.stringify({
        privateKey: 'bb'.repeat(32),
    }));
    await strict_1.default.rejects(() => (0, config_1.loadConfig)({
        IOTA_RPC_URL: 'https://api.testnet.iota.cafe',
        COORDINATOR_PACKAGE_ID: '0x1234',
        COORDINATOR_OBJECT_ID: '0xabcd',
        FASTCRYPTO_CLI_PATH: fastcryptoPath,
        STATE_DIR: stateDir,
        EVENT_PAGE_SIZE: '0',
        VRF_KEYPAIR_PATH: vrfPath,
        OPERATOR_KEYPAIR_PATH: operatorPath,
    }), /EVENT_PAGE_SIZE must be a positive integer/);
});
