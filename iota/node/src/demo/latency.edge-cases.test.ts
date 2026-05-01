import test from 'node:test';
import assert from 'node:assert/strict';

import {
  percentile,
  summarizeDistribution,
  summarizeLatency,
  type LatencyMeasurement,
} from './latency';

// ─── percentile ─────────────────────────────────────────────────────────────

test('percentile returns the single element for single-element arrays', () => {
  assert.equal(percentile([42], 0.0), 42);
  assert.equal(percentile([42], 0.5), 42);
  assert.equal(percentile([42], 1.0), 42);
});

test('percentile clamps quantile <= 0 to the minimum element', () => {
  assert.equal(percentile([100, 200, 300], -0.5), 100);
  assert.equal(percentile([100, 200, 300], 0), 100);
});

test('percentile clamps quantile >= 1 to the maximum element', () => {
  assert.equal(percentile([100, 200, 300], 1), 300);
  assert.equal(percentile([100, 200, 300], 1.5), 300);
});

test('percentile throws on empty arrays', () => {
  assert.throws(() => percentile([], 0.5), /empty/);
});

test('percentile interpolates linearly at midpoints', () => {
  // [100,200,300,400], n=4, position=(4-1)*0.5=1.5 → lowerIdx=1, upperIdx=2, weight=0.5
  // → 200*(1-0.5) + 300*0.5 = 100+150 = 250
  assert.equal(percentile([100, 200, 300, 400], 0.5), 250);
  // p99 of [1..100]: position=99*0.99=98.01 → lowerIdx=98, upperIdx=99, weight=0.01
  // → 99*(1-0.01) + 100*0.01 = 98.01+1 = 99.01
  assert.equal(percentile(Array.from({ length: 100 }, (_, i) => i + 1), 0.99), 99.01);
});

test('percentile is monotonic for a sorted set of quantile values', () => {
  const samples = [10, 20, 30, 40, 50];
  const results: number[] = [];
  for (let q = 0; q <= 1; q += 0.1) {
    results.push(percentile(samples, q));
  }
  for (let i = 1; i < results.length; i++) {
    assert.ok(results[i]! >= results[i - 1]!, `Monotonicity violated at ${i}: ${results[i - 1]} -> ${results[i]}`);
  }
});

// ─── summarizeDistribution ───────────────────────────────────────────────────

test('summarizeDistribution throws on empty arrays', () => {
  assert.throws(() => summarizeDistribution([]), /empty/);
});

test('summarizeDistribution computes correct avg for single value', () => {
  const result = summarizeDistribution([314]);
  assert.equal(result.minMs, 314);
  assert.equal(result.maxMs, 314);
  assert.equal(result.avgMs, 314);
  assert.equal(result.p50Ms, 314);
  assert.equal(result.p95Ms, 314);
  assert.equal(result.p99Ms, 314);
});

test('summarizeDistribution computes correct min, max, avg', () => {
  const result = summarizeDistribution([500, 1000, 1500, 2000]);
  assert.equal(result.minMs, 500);
  assert.equal(result.maxMs, 2000);
  assert.equal(result.avgMs, 1250);
});

test('summarizeDistribution does not mutate the input array', () => {
  const input = [100, 200, 300];
  summarizeDistribution(input);
  assert.deepEqual(input, [100, 200, 300]);
});

// ─── summarizeLatency ───────────────────────────────────────────────────────

test('summarizeLatency throws on empty measurements', () => {
  assert.throws(() => summarizeLatency([], 2000), /At least one latency/);
});

test('summarizeLatency records the targetP95Ms in the summary', () => {
  const measurement: LatencyMeasurement = {
    iteration: 1,
    requestId: '1',
    requestTxDigest: '0x1',
    fulfillTxDigest: '0xa',
    consumeTxDigest: '0xb',
    requestToFulfilledMs: 500,
    requestToConsumedMs: 600,
  };
  const result = summarizeLatency([measurement], 2000);
  assert.equal(result.targetP95Ms, 2000);
});

test('summarizeLatency returns true meetsTarget when p95 is exactly at the target', () => {
  // Use enough identical samples so p95 equals exactly that value
  const measurements: LatencyMeasurement[] = Array.from({ length: 20 }, (_, i) => ({
    iteration: i + 1,
    requestId: String(i + 1),
    requestTxDigest: `0x${i}`,
    fulfillTxDigest: `0x${i}a`,
    consumeTxDigest: `0x${i}b`,
    requestToFulfilledMs: 2000,
    requestToConsumedMs: 2100,
  }));
  const result = summarizeLatency(measurements, 2000);
  assert.equal(result.meetsTarget, true);
});

test('summarizeLatency returns false meetsTarget when p95 exceeds the target', () => {
  const measurements: LatencyMeasurement[] = Array.from({ length: 20 }, (_, i) => ({
    iteration: i + 1,
    requestId: String(i + 1),
    requestTxDigest: `0x${i}`,
    fulfillTxDigest: `0x${i}a`,
    consumeTxDigest: `0x${i}b`,
    requestToFulfilledMs: 2001,
    requestToConsumedMs: 2100,
  }));
  const result = summarizeLatency(measurements, 2000);
  assert.equal(result.meetsTarget, false);
});

test('summarizeLatency records correct iterations count', () => {
  const measurements: LatencyMeasurement[] = Array.from({ length: 7 }, (_, i) => ({
    iteration: i + 1,
    requestId: String(i + 1),
    requestTxDigest: `0x${i}`,
    fulfillTxDigest: null,
    consumeTxDigest: `0x${i}b`,
    requestToFulfilledMs: 800,
    requestToConsumedMs: 900,
  }));
  const result = summarizeLatency(measurements, 2000);
  assert.equal(result.iterations, 7);
});
