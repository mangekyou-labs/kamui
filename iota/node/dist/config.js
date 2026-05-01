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
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadConfig = loadConfig;
require("dotenv/config");
const child_process_1 = require("child_process");
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const DEFAULT_RPC_URL = 'https://api.testnet.iota.cafe';
const DEFAULT_FASTCRYPTO_CLI_PATH = '../fastcrypto/target/release/ecvrf-cli';
const DEFAULT_VRF_KEYPAIR_PATH = './vrf-keypair.json';
const DEFAULT_OPERATOR_KEYPAIR_PATH = './operator-keypair.json';
const DEFAULT_STATE_DIR = './state';
const DEFAULT_OPS_HOST = '127.0.0.1';
const DEFAULT_OPS_PORT = 9464;
const DEFAULT_POLL_INTERVAL_MS = 500;
const DEFAULT_BACKFILL_WINDOW_SEC = 30;
const DEFAULT_EVENT_PAGE_SIZE = 50;
const DEFAULT_MAX_RETRY_ATTEMPTS = 5;
const DEFAULT_RETRY_BASE_DELAY_MS = 1000;
const DEFAULT_RETRY_MAX_DELAY_MS = 30000;
const DEFAULT_RPC_CIRCUIT_BREAKER_FAILURE_THRESHOLD = 3;
const DEFAULT_RPC_CIRCUIT_BREAKER_COOLDOWN_MS = 30000;
const DEFAULT_SECRET_COMMAND_TIMEOUT_MS = 30000;
function assertNonEmpty(value, name) {
    const trimmed = value.trim();
    if (!trimmed) {
        throw new Error(`Missing required configuration: ${name}`);
    }
    return trimmed;
}
function normalizeHex(value, name, expectedBytes) {
    const normalized = value.trim().replace(/^0x/i, '').toLowerCase();
    if (!/^[0-9a-f]+$/.test(normalized)) {
        throw new Error(`${name} must be a hex string.`);
    }
    if (expectedBytes !== undefined && normalized.length !== expectedBytes * 2) {
        throw new Error(`${name} must be ${expectedBytes} bytes.`);
    }
    return normalized;
}
function parseAddress(value, name) {
    const trimmed = assertNonEmpty(value, name);
    if (!/^0x[0-9a-fA-F]+$/.test(trimmed)) {
        throw new Error(`${name} must be a 0x-prefixed hex string.`);
    }
    return trimmed.toLowerCase();
}
function parsePositiveInt(value, name, fallback) {
    if (value === undefined || value.trim() === '') {
        return fallback;
    }
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`${name} must be a positive integer.`);
    }
    return parsed;
}
function parsePort(value, name, fallback) {
    const parsed = parsePositiveInt(value, name, fallback);
    if (parsed > 65535) {
        throw new Error(`${name} must be between 1 and 65535.`);
    }
    return parsed;
}
function parseOperatorSecretMaterial(value, name) {
    if (typeof value === 'string') {
        const trimmed = assertNonEmpty(value, name);
        if (/^(0x)?[0-9a-fA-F]+$/.test(trimmed)) {
            return hexToBytes(normalizeHex(trimmed, name));
        }
        return trimmed;
    }
    if (value instanceof Uint8Array) {
        return value;
    }
    if (Array.isArray(value) && value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)) {
        return Uint8Array.from(value);
    }
    throw new Error(`${name} must be a string or byte array.`);
}
function hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let index = 0; index < hex.length; index += 2) {
        bytes[index / 2] = Number.parseInt(hex.slice(index, index + 2), 16);
    }
    return bytes;
}
function sanitizeSecretCommandText(value) {
    return value
        .replace(/"(secretKey|privateKey|secret|token|password)"\s*:\s*"[^"]*"/gi, (_, key) => `"${key}":"[redacted]"`)
        .replace(/\b[0-9a-f]{64,}\b/gi, '[redacted-hex]')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .join(' | ');
}
async function runSecretCommand(command, name, timeoutMs = DEFAULT_SECRET_COMMAND_TIMEOUT_MS) {
    const trimmedCommand = assertNonEmpty(command, name);
    return new Promise((resolve, reject) => {
        const child = (0, child_process_1.spawn)('/bin/sh', ['-lc', trimmedCommand], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        const timeout = setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
        }, timeoutMs);
        child.stdout?.setEncoding('utf8');
        child.stdout?.on('data', (chunk) => {
            stdout += chunk;
        });
        child.stderr?.setEncoding('utf8');
        child.stderr?.on('data', (chunk) => {
            stderr += chunk;
        });
        child.on('error', (error) => {
            clearTimeout(timeout);
            reject(new Error(`${name} failed to start: ${sanitizeSecretCommandText(error.message)}`));
        });
        child.on('close', (code, signal) => {
            clearTimeout(timeout);
            if (timedOut) {
                reject(new Error(`${name} timed out after ${timeoutMs}ms.`));
                return;
            }
            if (code !== 0) {
                const details = sanitizeSecretCommandText(stderr || stdout);
                const status = code === null ? `signal ${signal ?? 'unknown'}` : `exit code ${code}`;
                reject(new Error(details
                    ? `${name} failed (${status}): ${details}`
                    : `${name} failed (${status}).`));
                return;
            }
            const output = stdout.trim();
            if (!output) {
                reject(new Error(`${name} returned empty output.`));
                return;
            }
            resolve(output);
        });
    });
}
function parseJsonOrRaw(raw) {
    const trimmed = raw.trim();
    if (!trimmed) {
        throw new Error('Secret command output was empty.');
    }
    try {
        return JSON.parse(trimmed);
    }
    catch {
        return trimmed;
    }
}
async function loadJsonFile(filePath) {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
}
function parseVrfKeypairPayload(payload) {
    if (typeof payload.secretKey !== 'string') {
        throw new Error('VRF keypair file must include a string secretKey.');
    }
    if (typeof payload.publicKey !== 'string') {
        throw new Error('VRF keypair file must include a string publicKey.');
    }
    return {
        secretKey: normalizeHex(payload.secretKey, 'VRF secret key', 32),
        publicKey: normalizeHex(payload.publicKey, 'VRF public key', 32),
    };
}
async function loadVrfKeypairFromPath(filePath) {
    return parseVrfKeypairPayload(await loadJsonFile(filePath));
}
async function loadVrfKeypairFromCommand(command) {
    const payload = parseJsonOrRaw(await runSecretCommand(command, 'VRF_KEYPAIR_COMMAND'));
    if (!payload || typeof payload !== 'object') {
        throw new Error('VRF_KEYPAIR_COMMAND must output a JSON object with secretKey/publicKey.');
    }
    return parseVrfKeypairPayload(payload);
}
async function loadOperatorSecretFromPath(filePath) {
    const payload = await loadJsonFile(filePath);
    const value = payload.privateKey ?? payload.secretKey;
    return parseOperatorSecretMaterial(value, 'operator secret');
}
async function loadOperatorSecretFromCommand(command) {
    const payload = parseJsonOrRaw(await runSecretCommand(command, 'OPERATOR_KEY_COMMAND'));
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        const value = payload.privateKey ?? payload.secretKey;
        return parseOperatorSecretMaterial(value, 'operator secret');
    }
    return parseOperatorSecretMaterial(payload, 'operator secret');
}
function resolvePath(rawPath, name) {
    const resolved = path.resolve(process.cwd(), rawPath);
    if (!resolved) {
        throw new Error(`Unable to resolve ${name}.`);
    }
    return resolved;
}
async function loadConfig(env = process.env) {
    const rpcUrl = assertNonEmpty(env.IOTA_RPC_URL ?? DEFAULT_RPC_URL, 'IOTA_RPC_URL');
    new URL(rpcUrl);
    const coordinatorPackageId = parseAddress(env.COORDINATOR_PACKAGE_ID ?? '', 'COORDINATOR_PACKAGE_ID');
    const coordinatorObjectId = parseAddress(env.COORDINATOR_OBJECT_ID ?? '', 'COORDINATOR_OBJECT_ID');
    const fastcryptoCliPath = resolvePath(env.FASTCRYPTO_CLI_PATH ?? DEFAULT_FASTCRYPTO_CLI_PATH, 'FASTCRYPTO_CLI_PATH');
    await fs.access(fastcryptoCliPath);
    const stateDir = resolvePath(env.STATE_DIR ?? DEFAULT_STATE_DIR, 'STATE_DIR');
    const opsHost = assertNonEmpty(env.OPS_HOST ?? DEFAULT_OPS_HOST, 'OPS_HOST');
    const opsPort = parsePort(env.OPS_PORT, 'OPS_PORT', DEFAULT_OPS_PORT);
    const envVrfPublicKey = env.VRF_PUBLIC_KEY && env.VRF_PUBLIC_KEY.trim() !== ''
        ? normalizeHex(env.VRF_PUBLIC_KEY, 'VRF_PUBLIC_KEY', 32)
        : null;
    let vrfSecretKey;
    let vrfPublicKey = null;
    let vrfSecretSource;
    if (env.VRF_SECRET_KEY && env.VRF_SECRET_KEY.trim() !== '') {
        vrfSecretKey = normalizeHex(env.VRF_SECRET_KEY, 'VRF_SECRET_KEY', 32);
        if (!envVrfPublicKey) {
            throw new Error('VRF_PUBLIC_KEY is required when VRF_SECRET_KEY is provided.');
        }
        vrfPublicKey = envVrfPublicKey;
        vrfSecretSource = 'env';
    }
    else if (env.VRF_KEYPAIR_COMMAND && env.VRF_KEYPAIR_COMMAND.trim() !== '') {
        const vrfKeypair = await loadVrfKeypairFromCommand(env.VRF_KEYPAIR_COMMAND);
        vrfSecretKey = vrfKeypair.secretKey;
        vrfPublicKey = envVrfPublicKey ?? vrfKeypair.publicKey;
        vrfSecretSource = 'command';
    }
    else {
        const vrfKeypairPath = resolvePath(env.VRF_KEYPAIR_PATH ?? DEFAULT_VRF_KEYPAIR_PATH, 'VRF_KEYPAIR_PATH');
        const vrfKeypair = await loadVrfKeypairFromPath(vrfKeypairPath);
        vrfSecretKey = vrfKeypair.secretKey;
        vrfPublicKey = envVrfPublicKey ?? vrfKeypair.publicKey;
        vrfSecretSource = 'path';
    }
    let operatorSecret;
    let operatorSecretSource;
    if (env.OPERATOR_PRIVATE_KEY && env.OPERATOR_PRIVATE_KEY.trim() !== '') {
        operatorSecret = parseOperatorSecretMaterial(env.OPERATOR_PRIVATE_KEY, 'OPERATOR_PRIVATE_KEY');
        operatorSecretSource = 'env';
    }
    else if (env.OPERATOR_KEY_COMMAND && env.OPERATOR_KEY_COMMAND.trim() !== '') {
        operatorSecret = await loadOperatorSecretFromCommand(env.OPERATOR_KEY_COMMAND);
        operatorSecretSource = 'command';
    }
    else {
        const operatorKeypairPath = resolvePath(env.OPERATOR_KEYPAIR_PATH ?? DEFAULT_OPERATOR_KEYPAIR_PATH, 'OPERATOR_KEYPAIR_PATH');
        operatorSecret = await loadOperatorSecretFromPath(operatorKeypairPath);
        operatorSecretSource = 'path';
    }
    return {
        rpcUrl,
        coordinatorPackageId,
        coordinatorObjectId,
        fastcryptoCliPath,
        stateDir,
        opsHost,
        opsPort,
        vrfSecretKey,
        vrfSecretSource,
        vrfPublicKey,
        operatorSecret,
        operatorSecretSource,
        pollIntervalMs: parsePositiveInt(env.POLL_INTERVAL_MS, 'POLL_INTERVAL_MS', DEFAULT_POLL_INTERVAL_MS),
        backfillWindowSec: parsePositiveInt(env.BACKFILL_WINDOW_SEC, 'BACKFILL_WINDOW_SEC', DEFAULT_BACKFILL_WINDOW_SEC),
        eventPageSize: parsePositiveInt(env.EVENT_PAGE_SIZE, 'EVENT_PAGE_SIZE', DEFAULT_EVENT_PAGE_SIZE),
        maxRetryAttempts: parsePositiveInt(env.MAX_RETRY_ATTEMPTS, 'MAX_RETRY_ATTEMPTS', DEFAULT_MAX_RETRY_ATTEMPTS),
        retryBaseDelayMs: parsePositiveInt(env.RETRY_BASE_DELAY_MS, 'RETRY_BASE_DELAY_MS', DEFAULT_RETRY_BASE_DELAY_MS),
        retryMaxDelayMs: parsePositiveInt(env.RETRY_MAX_DELAY_MS, 'RETRY_MAX_DELAY_MS', DEFAULT_RETRY_MAX_DELAY_MS),
        rpcCircuitBreakerFailureThreshold: parsePositiveInt(env.RPC_CIRCUIT_BREAKER_FAILURE_THRESHOLD, 'RPC_CIRCUIT_BREAKER_FAILURE_THRESHOLD', DEFAULT_RPC_CIRCUIT_BREAKER_FAILURE_THRESHOLD),
        rpcCircuitBreakerCooldownMs: parsePositiveInt(env.RPC_CIRCUIT_BREAKER_COOLDOWN_MS, 'RPC_CIRCUIT_BREAKER_COOLDOWN_MS', DEFAULT_RPC_CIRCUIT_BREAKER_COOLDOWN_MS),
    };
}
