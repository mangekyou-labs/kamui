#!/usr/bin/env node

import { JsonStateStore } from '../store/json-state';
import type { ChainRequestState } from '../types';
import {
  consumeDemoRequest,
  loadDemoContext,
  readDemoNumWords,
  readDemoWaitSettings,
  resolveBytesFromEnv,
  submitDemoRequest,
  viewDemoConsumerState,
  waitForRequestState,
} from './common';
import {
  recommendTuning,
  summarizeLatency,
  type LatencyMeasurement,
} from './latency';

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}

function parseBoolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFulfillmentRecord(
  stateDir: string,
  requestId: string,
): Promise<string | null> {
  const { pollIntervalMs, timeoutMs } = readDemoWaitSettings();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    const store = new JsonStateStore(stateDir);
    await store.initialize();
    const record = store.getRequest(requestId);

    if (record?.status === 'fulfilled') {
      return record.txDigest;
    }

    if (record?.status === 'terminal') {
      throw new Error(
        `Request ${requestId} became terminal while waiting for the fulfillment record: ${record.lastError ?? 'unknown error'}.`,
      );
    }

    await delay(pollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for request ${requestId} to appear as fulfilled in local node state.`,
  );
}

async function clearFulfilledActiveRequest(
  activeState: Awaited<ReturnType<typeof viewDemoConsumerState>>,
  context: Awaited<ReturnType<typeof loadDemoContext>>,
): Promise<void> {
  const requestState = await waitForRequestState(
    context,
    activeState.activeRequestId,
    'fulfilled',
  );

  if (requestState !== 'fulfilled') {
    throw new Error(
      `Demo consumer already has active request ${activeState.activeRequestId} in state ${requestState}; clear it before running latency measurement.`,
    );
  }

  await consumeDemoRequest(context);
}

async function ensureIdleConsumer(
  context: Awaited<ReturnType<typeof loadDemoContext>>,
): Promise<void> {
  const state = await viewDemoConsumerState(context);
  if (!state.hasActiveRequest) {
    return;
  }

  await clearFulfilledActiveRequest(state, context);
}

function buildSeed(iteration: number): { bytes: number[]; hex: string; text: string | null } {
  if (process.env.DEMO_MEASURE_SEED_HEX && process.env.DEMO_MEASURE_SEED_HEX.trim() !== '') {
    return resolveBytesFromEnv('DEMO_MEASURE_SEED_HEX', 'DEMO_MEASURE_SEED_TEXT', 'kamui-latency');
  }

  return resolveBytesFromEnv(
    'DEMO_MEASURE_SEED_HEX',
    'DEMO_MEASURE_SEED_TEXT',
    `kamui-latency-${iteration}`,
  );
}

function buildCallback(iteration: number): { bytes: number[]; hex: string; text: string | null } {
  if (
    process.env.DEMO_MEASURE_CALLBACK_HEX &&
    process.env.DEMO_MEASURE_CALLBACK_HEX.trim() !== ''
  ) {
    return resolveBytesFromEnv(
      'DEMO_MEASURE_CALLBACK_HEX',
      'DEMO_MEASURE_CALLBACK_TEXT',
      'latency-run',
    );
  }

  return resolveBytesFromEnv(
    'DEMO_MEASURE_CALLBACK_HEX',
    'DEMO_MEASURE_CALLBACK_TEXT',
    `latency-run-${iteration}`,
  );
}

async function measureIteration(
  context: Awaited<ReturnType<typeof loadDemoContext>>,
  iteration: number,
): Promise<LatencyMeasurement> {
  const seed = buildSeed(iteration);
  const callback = buildCallback(iteration);
  const requestStartedAt = Date.now();

  const requested = await submitDemoRequest(context, {
    seedBytes: seed.bytes,
    callbackDataBytes: callback.bytes,
    numWords: readDemoNumWords(),
  });
  const requestId = requested.state.activeRequestId;
  const requestState: ChainRequestState = await waitForRequestState(
    context,
    requestId,
    'fulfilled',
  );

  if (requestState !== 'fulfilled') {
    throw new Error(
      `Request ${requestId} ended in state ${requestState} before fulfillment.`,
    );
  }

  const fulfilledAt = Date.now();
  const fulfillTxDigest = await waitForFulfillmentRecord(
    context.config.stateDir,
    requestId,
  );
  const consumed = await consumeDemoRequest(context);
  const consumedAt = Date.now();

  return {
    iteration,
    requestId,
    requestTxDigest: requested.txDigest,
    fulfillTxDigest,
    consumeTxDigest: consumed.txDigest,
    requestToFulfilledMs: fulfilledAt - requestStartedAt,
    requestToConsumedMs: consumedAt - requestStartedAt,
  };
}

async function main(): Promise<void> {
  const context = await loadDemoContext({ requireDemoConsumer: true });
  const iterations = readPositiveIntEnv('DEMO_MEASURE_ITERATIONS', 5);
  const settleMs = readPositiveIntEnv('DEMO_MEASURE_SETTLE_MS', 250);
  const targetP95Ms = readPositiveIntEnv('DEMO_TARGET_P95_MS', 2_000);
  const enforce = parseBoolEnv('DEMO_MEASURE_ENFORCE', false);

  await ensureIdleConsumer(context);

  const samples: LatencyMeasurement[] = [];
  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    samples.push(await measureIteration(context, iteration));
    await delay(settleMs);
  }

  const summary = summarizeLatency(samples, targetP95Ms);
  const tuning = recommendTuning(summary, {
    pollIntervalMs: context.config.pollIntervalMs,
    eventPageSize: context.config.eventPageSize,
    maxRetryAttempts: context.config.maxRetryAttempts,
    retryBaseDelayMs: context.config.retryBaseDelayMs,
  });

  console.log(
    JSON.stringify(
      {
        iterations,
        target_p95_ms: targetP95Ms,
        meets_target: summary.meetsTarget,
        request_to_fulfilled_ms: summary.requestToFulfilledMs,
        request_to_consumed_ms: summary.requestToConsumedMs,
        tuning_recommendations: tuning,
        config_snapshot: {
          poll_interval_ms: context.config.pollIntervalMs,
          event_page_size: context.config.eventPageSize,
          max_retry_attempts: context.config.maxRetryAttempts,
          retry_base_delay_ms: context.config.retryBaseDelayMs,
        },
        samples,
      },
      null,
      2,
    ),
  );

  if (enforce) {
    const p95 = summary.requestToFulfilledMs.p95Ms;
    if (!summary.meetsTarget) {
      console.error(
        `KPI FAIL: p95 ${p95.toFixed(1)}ms exceeds ${targetP95Ms}ms target.`,
      );
      process.exit(1);
    }
    console.error(
      `KPI PASS: p95 ${p95.toFixed(1)}ms meets ${targetP95Ms}ms target.`,
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
