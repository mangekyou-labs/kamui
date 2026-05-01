import test from 'node:test';
import assert from 'node:assert/strict';

import { summarizeLatency, type LatencyMeasurement } from './latency';

// Inline copy of parseBoolEnv to avoid importing from measure.ts, which has
// top-level side effects (main() call) that make it unsuitable for test imports.
function parseBoolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function makeSample(iteration: number, fulfilledMs: number, consumedMs: number): LatencyMeasurement {
  return {
    iteration,
    requestId: String(iteration),
    requestTxDigest: `0x${iteration}`,
    fulfillTxDigest: `0x${iteration}a`,
    consumeTxDigest: `0x${iteration}b`,
    requestToFulfilledMs: fulfilledMs,
    requestToConsumedMs: consumedMs,
  };
}

test('KPI enforcement: meetsTarget is true when all samples are within the target', () => {
  const samples = [
    makeSample(1, 800, 900),
    makeSample(2, 1_200, 1_300),
    makeSample(3, 1_500, 1_600),
    makeSample(4, 1_100, 1_250),
    makeSample(5, 900, 1_000),
  ];
  const summary = summarizeLatency(samples, 2_000);
  assert.equal(summary.meetsTarget, true);
  assert.ok(summary.requestToFulfilledMs.p95Ms <= 2_000);
});

test('KPI enforcement: meetsTarget is false when p95 exceeds the target', () => {
  const samples = [
    makeSample(1, 800, 900),
    makeSample(2, 1_200, 1_300),
    makeSample(3, 2_400, 2_600),
    makeSample(4, 1_800, 1_950),
    makeSample(5, 2_100, 2_300),
  ];
  const summary = summarizeLatency(samples, 2_000);
  assert.equal(summary.meetsTarget, false);
  assert.ok(summary.requestToFulfilledMs.p95Ms > 2_000);
});

test('KPI enforcement: single-sample pass', () => {
  const summary = summarizeLatency([makeSample(1, 1_500, 1_600)], 2_000);
  assert.equal(summary.meetsTarget, true);
});

test('KPI enforcement: single-sample fail', () => {
  const summary = summarizeLatency([makeSample(1, 2_500, 2_600)], 2_000);
  assert.equal(summary.meetsTarget, false);
});

test('parseBoolEnv returns fallback for undefined env var', () => {
  const original = process.env.TEST_KPI_BOOL;
  delete process.env.TEST_KPI_BOOL;
  assert.equal(parseBoolEnv('TEST_KPI_BOOL', false), false);
  assert.equal(parseBoolEnv('TEST_KPI_BOOL', true), true);
  if (original !== undefined) process.env.TEST_KPI_BOOL = original;
});

test('parseBoolEnv returns fallback for empty string', () => {
  process.env.TEST_KPI_BOOL = '  ';
  assert.equal(parseBoolEnv('TEST_KPI_BOOL', false), false);
  delete process.env.TEST_KPI_BOOL;
});

test('parseBoolEnv recognizes truthy values', () => {
  for (const value of ['1', 'true', 'TRUE', 'True', 'yes', 'YES', 'Yes']) {
    process.env.TEST_KPI_BOOL = value;
    assert.equal(parseBoolEnv('TEST_KPI_BOOL', false), true, `expected true for "${value}"`);
  }
  delete process.env.TEST_KPI_BOOL;
});

test('parseBoolEnv returns false for non-truthy values', () => {
  for (const value of ['0', 'false', 'no', 'off', 'random']) {
    process.env.TEST_KPI_BOOL = value;
    assert.equal(parseBoolEnv('TEST_KPI_BOOL', true), false, `expected false for "${value}"`);
  }
  delete process.env.TEST_KPI_BOOL;
});
