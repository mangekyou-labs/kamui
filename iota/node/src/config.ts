import 'dotenv/config';

import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';

export type SecretSource = 'env' | 'path' | 'command';
export type OperatorSecretMaterial = string | Uint8Array;

export interface NodeConfig {
  rpcUrl: string;
  coordinatorPackageId: string;
  coordinatorObjectId: string;
  fastcryptoCliPath: string;
  stateDir: string;
  opsHost: string;
  opsPort: number;
  vrfSecretKey: string;
  vrfSecretSource: SecretSource;
  vrfPublicKey: string | null;
  operatorSecret: OperatorSecretMaterial;
  operatorSecretSource: SecretSource;
  pollIntervalMs: number;
  backfillWindowSec: number;
  eventPageSize: number;
  maxRetryAttempts: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  rpcCircuitBreakerFailureThreshold: number;
  rpcCircuitBreakerCooldownMs: number;
}

interface VrfKeypairFile {
  secretKey?: unknown;
  publicKey?: unknown;
}

interface OperatorKeyFile {
  privateKey?: unknown;
  secretKey?: unknown;
}

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
const DEFAULT_RETRY_BASE_DELAY_MS = 1_000;
const DEFAULT_RETRY_MAX_DELAY_MS = 30_000;
const DEFAULT_RPC_CIRCUIT_BREAKER_FAILURE_THRESHOLD = 3;
const DEFAULT_RPC_CIRCUIT_BREAKER_COOLDOWN_MS = 30_000;
const DEFAULT_SECRET_COMMAND_TIMEOUT_MS = 30_000;

function assertNonEmpty(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Missing required configuration: ${name}`);
  }
  return trimmed;
}

function normalizeHex(value: string, name: string, expectedBytes?: number): string {
  const normalized = value.trim().replace(/^0x/i, '').toLowerCase();
  if (!/^[0-9a-f]+$/.test(normalized)) {
    throw new Error(`${name} must be a hex string.`);
  }
  if (expectedBytes !== undefined && normalized.length !== expectedBytes * 2) {
    throw new Error(`${name} must be ${expectedBytes} bytes.`);
  }
  return normalized;
}

function parseAddress(value: string, name: string): string {
  const trimmed = assertNonEmpty(value, name);
  if (!/^0x[0-9a-fA-F]+$/.test(trimmed)) {
    throw new Error(`${name} must be a 0x-prefixed hex string.`);
  }
  return trimmed.toLowerCase();
}

function parsePositiveInt(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function parsePort(value: string | undefined, name: string, fallback: number): number {
  const parsed = parsePositiveInt(value, name, fallback);
  if (parsed > 65535) {
    throw new Error(`${name} must be between 1 and 65535.`);
  }
  return parsed;
}

function parseOperatorSecretMaterial(value: unknown, name: string): OperatorSecretMaterial {
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

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < hex.length; index += 2) {
    bytes[index / 2] = Number.parseInt(hex.slice(index, index + 2), 16);
  }
  return bytes;
}

function sanitizeSecretCommandText(value: string): string {
  return value
    .replace(
      /"(secretKey|privateKey|secret|token|password)"\s*:\s*"[^"]*"/gi,
      (_, key: string) => `"${key}":"[redacted]"`,
    )
    .replace(/\b[0-9a-f]{64,}\b/gi, '[redacted-hex]')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(' | ');
}

async function runSecretCommand(
  command: string,
  name: string,
  timeoutMs: number = DEFAULT_SECRET_COMMAND_TIMEOUT_MS,
): Promise<string> {
  const trimmedCommand = assertNonEmpty(command, name);

  return new Promise((resolve, reject) => {
    const child = spawn('/bin/sh', ['-lc', trimmedCommand], {
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
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
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
        const status =
          code === null ? `signal ${signal ?? 'unknown'}` : `exit code ${code}`;
        reject(
          new Error(
            details
              ? `${name} failed (${status}): ${details}`
              : `${name} failed (${status}).`,
          ),
        );
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

function parseJsonOrRaw(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Secret command output was empty.');
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return trimmed;
  }
}

async function loadJsonFile<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw) as T;
}

function parseVrfKeypairPayload(payload: VrfKeypairFile): {
  secretKey: string;
  publicKey: string | null;
} {
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

async function loadVrfKeypairFromPath(filePath: string): Promise<{
  secretKey: string;
  publicKey: string | null;
}> {
  return parseVrfKeypairPayload(await loadJsonFile<VrfKeypairFile>(filePath));
}

async function loadVrfKeypairFromCommand(command: string): Promise<{
  secretKey: string;
  publicKey: string | null;
}> {
  const payload = parseJsonOrRaw(await runSecretCommand(command, 'VRF_KEYPAIR_COMMAND'));
  if (!payload || typeof payload !== 'object') {
    throw new Error('VRF_KEYPAIR_COMMAND must output a JSON object with secretKey/publicKey.');
  }

  return parseVrfKeypairPayload(payload as VrfKeypairFile);
}

async function loadOperatorSecretFromPath(filePath: string): Promise<OperatorSecretMaterial> {
  const payload = await loadJsonFile<OperatorKeyFile>(filePath);
  const value = payload.privateKey ?? payload.secretKey;
  return parseOperatorSecretMaterial(value, 'operator secret');
}

async function loadOperatorSecretFromCommand(command: string): Promise<OperatorSecretMaterial> {
  const payload = parseJsonOrRaw(await runSecretCommand(command, 'OPERATOR_KEY_COMMAND'));
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const value = (payload as OperatorKeyFile).privateKey ?? (payload as OperatorKeyFile).secretKey;
    return parseOperatorSecretMaterial(value, 'operator secret');
  }

  return parseOperatorSecretMaterial(payload, 'operator secret');
}

function resolvePath(rawPath: string, name: string): string {
  const resolved = path.resolve(process.cwd(), rawPath);
  if (!resolved) {
    throw new Error(`Unable to resolve ${name}.`);
  }
  return resolved;
}

export async function loadConfig(env: NodeJS.ProcessEnv = process.env): Promise<NodeConfig> {
  const rpcUrl = assertNonEmpty(env.IOTA_RPC_URL ?? DEFAULT_RPC_URL, 'IOTA_RPC_URL');
  new URL(rpcUrl);

  const coordinatorPackageId = parseAddress(
    env.COORDINATOR_PACKAGE_ID ?? '',
    'COORDINATOR_PACKAGE_ID',
  );
  const coordinatorObjectId = parseAddress(
    env.COORDINATOR_OBJECT_ID ?? '',
    'COORDINATOR_OBJECT_ID',
  );

  const fastcryptoCliPath = resolvePath(
    env.FASTCRYPTO_CLI_PATH ?? DEFAULT_FASTCRYPTO_CLI_PATH,
    'FASTCRYPTO_CLI_PATH',
  );
  await fs.access(fastcryptoCliPath);

  const stateDir = resolvePath(env.STATE_DIR ?? DEFAULT_STATE_DIR, 'STATE_DIR');
  const opsHost = assertNonEmpty(env.OPS_HOST ?? DEFAULT_OPS_HOST, 'OPS_HOST');
  const opsPort = parsePort(env.OPS_PORT, 'OPS_PORT', DEFAULT_OPS_PORT);
  const envVrfPublicKey =
    env.VRF_PUBLIC_KEY && env.VRF_PUBLIC_KEY.trim() !== ''
      ? normalizeHex(env.VRF_PUBLIC_KEY, 'VRF_PUBLIC_KEY', 32)
      : null;

  let vrfSecretKey: string;
  let vrfPublicKey: string | null = null;
  let vrfSecretSource: SecretSource;

  if (env.VRF_SECRET_KEY && env.VRF_SECRET_KEY.trim() !== '') {
    vrfSecretKey = normalizeHex(env.VRF_SECRET_KEY, 'VRF_SECRET_KEY', 32);
    if (!envVrfPublicKey) {
      throw new Error('VRF_PUBLIC_KEY is required when VRF_SECRET_KEY is provided.');
    }
    vrfPublicKey = envVrfPublicKey;
    vrfSecretSource = 'env';
  } else if (env.VRF_KEYPAIR_COMMAND && env.VRF_KEYPAIR_COMMAND.trim() !== '') {
    const vrfKeypair = await loadVrfKeypairFromCommand(env.VRF_KEYPAIR_COMMAND);
    vrfSecretKey = vrfKeypair.secretKey;
    vrfPublicKey = envVrfPublicKey ?? vrfKeypair.publicKey;
    vrfSecretSource = 'command';
  } else {
    const vrfKeypairPath = resolvePath(
      env.VRF_KEYPAIR_PATH ?? DEFAULT_VRF_KEYPAIR_PATH,
      'VRF_KEYPAIR_PATH',
    );
    const vrfKeypair = await loadVrfKeypairFromPath(vrfKeypairPath);
    vrfSecretKey = vrfKeypair.secretKey;
    vrfPublicKey = envVrfPublicKey ?? vrfKeypair.publicKey;
    vrfSecretSource = 'path';
  }

  let operatorSecret: OperatorSecretMaterial;
  let operatorSecretSource: SecretSource;

  if (env.OPERATOR_PRIVATE_KEY && env.OPERATOR_PRIVATE_KEY.trim() !== '') {
    operatorSecret = parseOperatorSecretMaterial(
      env.OPERATOR_PRIVATE_KEY,
      'OPERATOR_PRIVATE_KEY',
    );
    operatorSecretSource = 'env';
  } else if (env.OPERATOR_KEY_COMMAND && env.OPERATOR_KEY_COMMAND.trim() !== '') {
    operatorSecret = await loadOperatorSecretFromCommand(env.OPERATOR_KEY_COMMAND);
    operatorSecretSource = 'command';
  } else {
    const operatorKeypairPath = resolvePath(
      env.OPERATOR_KEYPAIR_PATH ?? DEFAULT_OPERATOR_KEYPAIR_PATH,
      'OPERATOR_KEYPAIR_PATH',
    );
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
    backfillWindowSec: parsePositiveInt(
      env.BACKFILL_WINDOW_SEC,
      'BACKFILL_WINDOW_SEC',
      DEFAULT_BACKFILL_WINDOW_SEC,
    ),
    eventPageSize: parsePositiveInt(
      env.EVENT_PAGE_SIZE,
      'EVENT_PAGE_SIZE',
      DEFAULT_EVENT_PAGE_SIZE,
    ),
    maxRetryAttempts: parsePositiveInt(
      env.MAX_RETRY_ATTEMPTS,
      'MAX_RETRY_ATTEMPTS',
      DEFAULT_MAX_RETRY_ATTEMPTS,
    ),
    retryBaseDelayMs: parsePositiveInt(
      env.RETRY_BASE_DELAY_MS,
      'RETRY_BASE_DELAY_MS',
      DEFAULT_RETRY_BASE_DELAY_MS,
    ),
    retryMaxDelayMs: parsePositiveInt(
      env.RETRY_MAX_DELAY_MS,
      'RETRY_MAX_DELAY_MS',
      DEFAULT_RETRY_MAX_DELAY_MS,
    ),
    rpcCircuitBreakerFailureThreshold: parsePositiveInt(
      env.RPC_CIRCUIT_BREAKER_FAILURE_THRESHOLD,
      'RPC_CIRCUIT_BREAKER_FAILURE_THRESHOLD',
      DEFAULT_RPC_CIRCUIT_BREAKER_FAILURE_THRESHOLD,
    ),
    rpcCircuitBreakerCooldownMs: parsePositiveInt(
      env.RPC_CIRCUIT_BREAKER_COOLDOWN_MS,
      'RPC_CIRCUIT_BREAKER_COOLDOWN_MS',
      DEFAULT_RPC_CIRCUIT_BREAKER_COOLDOWN_MS,
    ),
  };
}
