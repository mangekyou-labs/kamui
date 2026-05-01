import { IotaClient } from '@iota/iota-sdk/client';
import { Ed25519Keypair } from '@iota/iota-sdk/keypairs/ed25519';
import { Transaction } from '@iota/iota-sdk/transactions';

import { loadConfig, type NodeConfig } from '../config';
import { IotaCoordinatorReader } from '../read/coordinator';
import type { ChainRequestState } from '../types';

type MoveValue =
  | number
  | boolean
  | string
  | Array<number | string | boolean | null | Record<string, unknown>>
  | null
  | Record<string, unknown>;

interface ExecutionStatusView {
  error?: unknown;
  status?: unknown;
}

interface TransactionEffectsView {
  status?: ExecutionStatusView | null;
}

interface TransactionResponseView {
  effects?: TransactionEffectsView | null;
}

interface ObjectDataView {
  content?: {
    fields?: Record<string, unknown>;
  } | null;
}

interface ObjectResponseView {
  data?: ObjectDataView | null;
}

export interface DemoContext {
  client: IotaClient;
  signer: any;
  signerAddress: string;
  config: NodeConfig;
  coordinatorReader: IotaCoordinatorReader;
  demoConsumerObjectId: string | null;
}

export interface DemoConsumerState {
  owner: string;
  subscriptionId: string;
  hasActiveRequest: boolean;
  activeRequestId: string;
  lastConsumedRequestId: string;
  lastOutputHex: string;
  lastOutputText: string | null;
  lastCallbackDataHex: string;
  lastCallbackDataText: string | null;
  consumedCount: string;
}

export interface DemoRequestInput {
  seedBytes: number[];
  callbackDataBytes: number[];
  numWords: number;
}

function createSigner(secret: string | Uint8Array): any {
  return (Ed25519Keypair as any).fromSecretKey(secret);
}

function deriveSignerAddress(signer: any): string {
  if (typeof signer?.toIotaAddress === 'function') {
    return signer.toIotaAddress();
  }
  if (typeof signer?.getPublicKey === 'function') {
    const publicKey = signer.getPublicKey();
    if (typeof publicKey?.toIotaAddress === 'function') {
      return publicKey.toIotaAddress();
    }
  }
  throw new Error('Unable to derive signer address.');
}

function parseFunctionReturnValue(result: unknown, functionName: string): MoveValue {
  if (!result || typeof result !== 'object') {
    throw new Error(`View call ${functionName} returned an invalid response.`);
  }

  if ('executionError' in result) {
    const message = String((result as { executionError?: unknown }).executionError ?? 'unknown view error');
    throw new Error(`View call ${functionName} failed: ${message}`);
  }

  if (!('functionReturnValues' in result)) {
    throw new Error(`View call ${functionName} did not include functionReturnValues.`);
  }

  const values = (result as { functionReturnValues?: MoveValue[] }).functionReturnValues ?? [];
  if (values.length === 0) {
    throw new Error(`View call ${functionName} returned no values.`);
  }

  return values[0] ?? null;
}

function normalizeHex(value: string, name: string): string {
  const normalized = value.trim().replace(/^0x/i, '').toLowerCase();
  if (!/^[0-9a-f]*$/.test(normalized) || normalized.length % 2 !== 0) {
    throw new Error(`${name} must be an even-length hex string.`);
  }
  return normalized;
}

function normalizeAddress(value: MoveValue, name: string): string {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new Error(`${name} is not a valid address.`);
  }
  return value.toLowerCase();
}

function normalizeBool(value: MoveValue, name: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${name} is not a bool.`);
  }
  return value;
}

function normalizeU64(value: MoveValue, name: string): string {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`${name} is not a valid u64.`);
    }
    return String(value);
  }

  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return value;
  }

  throw new Error(`${name} is not a valid u64.`);
}

function normalizeByteArray(value: MoveValue, name: string): string {
  if (typeof value === 'string') {
    return normalizeHex(value, name);
  }

  if (
    Array.isArray(value) &&
    value.every(
      (item) =>
        (typeof item === 'number' && Number.isInteger(item) && item >= 0 && item <= 255) ||
        (typeof item === 'string' && /^\d+$/.test(item)),
    )
  ) {
    return value
      .map((item) => Number(item).toString(16).padStart(2, '0'))
      .join('');
  }

  throw new Error(`${name} is not a byte vector.`);
}

function hexToBytes(hex: string): number[] {
  const normalized = normalizeHex(hex, 'hex input');
  const bytes: number[] = [];
  for (let index = 0; index < normalized.length; index += 2) {
    bytes.push(Number.parseInt(normalized.slice(index, index + 2), 16));
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function decodeUtf8IfPrintable(hex: string): string | null {
  if (!hex) {
    return '';
  }

  try {
    const decoded = new TextDecoder().decode(Uint8Array.from(hexToBytes(hex)));
    const printable = /^[\x09\x0a\x0d\x20-\x7e]*$/.test(decoded);
    return printable ? decoded : null;
  } catch {
    return null;
  }
}

function getExecutionStatus(result: unknown): { error: string | null; status: 'failure' | 'success' } | null {
  if (!result || typeof result !== 'object') {
    return null;
  }

  const effects = (result as TransactionResponseView).effects;
  if (!effects || typeof effects !== 'object') {
    return null;
  }

  const statusView = effects.status;
  if (!statusView || typeof statusView !== 'object') {
    return null;
  }

  const status = statusView.status;
  if (status !== 'success' && status !== 'failure') {
    return null;
  }

  return {
    status,
    error:
      statusView.error === undefined || statusView.error === null
        ? null
        : String(statusView.error),
  };
}

function readEnv(name: string): string | null {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    return null;
  }
  return value.trim();
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = readEnv(name);
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function pureU32(tx: any, value: number): unknown {
  if (tx.pure?.u32) {
    return tx.pure.u32(value);
  }
  return tx.pure(value);
}

export function pureAddress(tx: any, address: string): unknown {
  if (tx.pure?.address) {
    return tx.pure.address(address);
  }
  return tx.pure(address);
}

export function pureVectorU8(tx: any, bytes: number[]): unknown {
  if (tx.pure?.vector) {
    return tx.pure.vector('u8', bytes);
  }
  return tx.pure(bytes);
}

async function viewFunction(
  client: IotaClient,
  target: string,
  args: unknown[],
): Promise<MoveValue> {
  const result = await client.view({
    functionName: target,
    arguments: args,
  });

  return parseFunctionReturnValue(result, target);
}

async function getObjectFields(client: IotaClient, objectId: string): Promise<Record<string, unknown>> {
  const result = await client.getObject({
    id: objectId,
    options: { showContent: true },
  });

  const data =
    result && typeof result === 'object' && 'data' in result
      ? (result as ObjectResponseView).data
      : (result as ObjectDataView);
  const content = data?.content;
  const fields = content?.fields;
  if (!fields || typeof fields !== 'object') {
    throw new Error(`Object ${objectId} did not include Move content fields.`);
  }
  return fields;
}

export async function executeTransaction(
  client: IotaClient,
  signer: any,
  tx: Transaction,
  options: {
    showEvents?: boolean;
    showObjectChanges?: boolean;
  } = {},
): Promise<{ digest: string; events?: unknown[] | null; objectChanges?: unknown[] | null }> {
  const result = await client.signAndExecuteTransaction({
    signer,
    transaction: tx,
    options: {
      showEffects: true,
      showEvents: options.showEvents ?? false,
      showObjectChanges: options.showObjectChanges ?? false,
    },
  });

  const finalized = await client.waitForTransaction({
    digest: result.digest,
    options: {
      showEffects: true,
      showEvents: options.showEvents ?? false,
      showObjectChanges: options.showObjectChanges ?? false,
    },
    waitMode: 'checkpoint',
  });

  const executionStatus = getExecutionStatus(finalized);
  if (!executionStatus) {
    throw new Error(`Transaction ${result.digest} did not return execution effects.`);
  }

  if (executionStatus.status !== 'success') {
    throw new Error(
      executionStatus.error ?? `Transaction ${result.digest} executed with failure status.`,
    );
  }

  return {
    digest: finalized.digest,
    events: finalized.events ?? null,
    objectChanges: finalized.objectChanges ?? null,
  };
}

export function findCreatedObjectId(
  objectChanges: unknown[] | null | undefined,
  objectTypeSuffix: string,
): string | null {
  for (const change of objectChanges ?? []) {
    if (
      change &&
      typeof change === 'object' &&
      (change as { type?: unknown }).type === 'created' &&
      typeof (change as { objectType?: unknown }).objectType === 'string' &&
      typeof (change as { objectId?: unknown }).objectId === 'string' &&
      ((change as { objectType: string }).objectType === objectTypeSuffix ||
        (change as { objectType: string }).objectType.endsWith(objectTypeSuffix))
    ) {
      return (change as { objectId: string }).objectId;
    }
  }
  return null;
}

export async function loadDemoContext(options: {
  requireDemoConsumer?: boolean;
} = {}): Promise<DemoContext> {
  const config = await loadConfig();
  const signer = createSigner(config.operatorSecret);
  const signerAddress = deriveSignerAddress(signer);
  const client = new IotaClient({ url: config.rpcUrl } as any);
  const demoConsumerObjectId = readEnv('DEMO_CONSUMER_OBJECT_ID');

  if (options.requireDemoConsumer && !demoConsumerObjectId) {
    throw new Error('DEMO_CONSUMER_OBJECT_ID is required for this command.');
  }

  return {
    client,
    signer,
    signerAddress,
    config,
    coordinatorReader: new IotaCoordinatorReader(
      client as any,
      config.coordinatorPackageId,
      config.coordinatorObjectId,
    ),
    demoConsumerObjectId,
  };
}

export async function viewCoordinatorU64(
  context: DemoContext,
  functionName: string,
  args: unknown[],
): Promise<string> {
  if (args.length === 1 && args[0] === context.config.coordinatorObjectId) {
    const fields = await getObjectFields(context.client, context.config.coordinatorObjectId);
    if (functionName in fields) {
      return normalizeU64(fields[functionName] as MoveValue, functionName);
    }
  }

  const value = await viewFunction(
    context.client,
    `${context.config.coordinatorPackageId}::coordinator::${functionName}`,
    args,
  );
  return normalizeU64(value, functionName);
}

async function viewDemoConsumerValue(
  context: DemoContext,
  functionName: string,
  args: unknown[],
): Promise<MoveValue> {
  if (
    args.length === 1 &&
    typeof args[0] === 'string' &&
    context.demoConsumerObjectId &&
    args[0] === context.demoConsumerObjectId
  ) {
    const fields = await getObjectFields(context.client, context.demoConsumerObjectId);
    if (functionName in fields) {
      return fields[functionName] as MoveValue;
    }
  }

  return viewFunction(
    context.client,
    `${context.config.coordinatorPackageId}::demo_consumer::${functionName}`,
    args,
  );
}

export async function viewDemoConsumerState(context: DemoContext): Promise<DemoConsumerState> {
  if (!context.demoConsumerObjectId) {
    throw new Error('DEMO_CONSUMER_OBJECT_ID is required.');
  }

  const demoConsumerObjectId = context.demoConsumerObjectId;

  const [
    owner,
    subscriptionId,
    hasActiveRequest,
    activeRequestId,
    lastConsumedRequestId,
    lastOutputHex,
    lastCallbackDataHex,
    consumedCount,
  ] = await Promise.all([
    viewDemoConsumerValue(context, 'owner', [demoConsumerObjectId]),
    viewDemoConsumerValue(context, 'subscription_id', [demoConsumerObjectId]),
    viewDemoConsumerValue(context, 'has_active_request', [demoConsumerObjectId]),
    viewDemoConsumerValue(context, 'active_request_id', [demoConsumerObjectId]),
    viewDemoConsumerValue(context, 'last_consumed_request_id', [demoConsumerObjectId]),
    viewDemoConsumerValue(context, 'last_output', [demoConsumerObjectId]),
    viewDemoConsumerValue(context, 'last_callback_data', [demoConsumerObjectId]),
    viewDemoConsumerValue(context, 'consumed_count', [demoConsumerObjectId]),
  ]);

  const lastOutput = normalizeByteArray(lastOutputHex, 'last_output');
  const lastCallbackData = normalizeByteArray(lastCallbackDataHex, 'last_callback_data');

  return {
    owner: normalizeAddress(owner, 'owner'),
    subscriptionId: normalizeU64(subscriptionId, 'subscription_id'),
    hasActiveRequest: normalizeBool(hasActiveRequest, 'has_active_request'),
    activeRequestId: normalizeU64(activeRequestId, 'active_request_id'),
    lastConsumedRequestId: normalizeU64(lastConsumedRequestId, 'last_consumed_request_id'),
    lastOutputHex: lastOutput,
    lastOutputText: decodeUtf8IfPrintable(lastOutput),
    lastCallbackDataHex: lastCallbackData,
    lastCallbackDataText: decodeUtf8IfPrintable(lastCallbackData),
    consumedCount: normalizeU64(consumedCount, 'consumed_count'),
  };
}

export function resolveBytesFromEnv(
  hexName: string,
  textName: string,
  fallbackText: string,
): { bytes: number[]; hex: string; text: string | null } {
  const rawHex = readEnv(hexName);
  if (rawHex) {
    const normalized = normalizeHex(rawHex, hexName);
    return {
      bytes: hexToBytes(normalized),
      hex: normalized,
      text: decodeUtf8IfPrintable(normalized),
    };
  }

  const text = readEnv(textName) ?? fallbackText;
  const bytes = Array.from(new TextEncoder().encode(text));
  return {
    bytes,
    hex: bytesToHex(Uint8Array.from(bytes)),
    text,
  };
}

export function readDemoNumWords(): number {
  return readPositiveIntEnv('DEMO_NUM_WORDS', 1);
}

export function readDemoWaitSettings(): { pollIntervalMs: number; timeoutMs: number } {
  return {
    pollIntervalMs: readPositiveIntEnv('DEMO_POLL_INTERVAL_MS', 1_000),
    timeoutMs: readPositiveIntEnv('DEMO_WAIT_TIMEOUT_MS', 60_000),
  };
}

export async function waitForRequestState(
  context: DemoContext,
  requestId: string,
  targetState: ChainRequestState,
): Promise<ChainRequestState> {
  const { pollIntervalMs, timeoutMs } = readDemoWaitSettings();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    const state = await context.coordinatorReader.getRequestStatus(requestId);
    if (state === targetState) {
      return state;
    }
    if (state !== 'pending') {
      return state;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(
    `Timed out waiting for request ${requestId} to reach ${targetState} after ${timeoutMs}ms.`,
  );
}

export function createTransaction(): Transaction {
  return new Transaction();
}

export async function submitDemoRequest(
  context: DemoContext,
  input: DemoRequestInput,
): Promise<{ txDigest: string; state: DemoConsumerState }> {
  if (!context.demoConsumerObjectId) {
    throw new Error('DEMO_CONSUMER_OBJECT_ID is required.');
  }

  const tx = createTransaction();
  const txAny = tx as any;
  txAny.moveCall({
    target: `${context.config.coordinatorPackageId}::demo_consumer::request_randomness`,
    arguments: [
      txAny.object(context.demoConsumerObjectId),
      txAny.object(context.config.coordinatorObjectId),
      pureAddress(txAny, context.signerAddress),
      pureVectorU8(txAny, input.seedBytes),
      pureU32(txAny, input.numWords),
      pureVectorU8(txAny, input.callbackDataBytes),
    ],
  });

  const result = await executeTransaction(context.client, context.signer, tx);
  const state = await viewDemoConsumerState(context);

  return {
    txDigest: result.digest,
    state,
  };
}

export async function consumeDemoRequest(
  context: DemoContext,
): Promise<{ txDigest: string; state: DemoConsumerState }> {
  if (!context.demoConsumerObjectId) {
    throw new Error('DEMO_CONSUMER_OBJECT_ID is required.');
  }

  const tx = createTransaction();
  const txAny = tx as any;
  txAny.moveCall({
    target: `${context.config.coordinatorPackageId}::demo_consumer::consume_randomness`,
    arguments: [
      txAny.object(context.demoConsumerObjectId),
      txAny.object(context.config.coordinatorObjectId),
      pureAddress(txAny, context.signerAddress),
    ],
  });

  const result = await executeTransaction(context.client, context.signer, tx);
  const state = await viewDemoConsumerState(context);

  return {
    txDigest: result.digest,
    state,
  };
}

export function createDemoSummary(state: DemoConsumerState): Record<string, unknown> {
  return {
    owner: state.owner,
    subscription_id: state.subscriptionId,
    has_active_request: state.hasActiveRequest,
    active_request_id: state.activeRequestId,
    last_consumed_request_id: state.lastConsumedRequestId,
    last_output_hex: state.lastOutputHex,
    last_output_text: state.lastOutputText,
    last_callback_data_hex: state.lastCallbackDataHex,
    last_callback_data_text: state.lastCallbackDataText,
    consumed_count: state.consumedCount,
  };
}

export { pureU32 };
