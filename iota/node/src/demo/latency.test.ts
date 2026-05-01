import test from 'node:test';
import assert from 'node:assert/strict';

import {
  percentile,
  recommendTuning,
  summarizeLatency,
  type LatencyMeasurement,
} from './latency';

const measurements: LatencyMeasurement[] = [
  {
    iteration: 1,
    requestId: '1',
    requestTxDigest: '0x1',
    fulfillTxDigest: '0xa',
    consumeTxDigest: '0xb',
    requestToFulfilledMs: 800,
    requestToConsumedMs: 900,
  },
  {
    iteration: 2,
    requestId: '2',
    requestTxDigest: '0x2',
    fulfillTxDigest: '0xc',
    consumeTxDigest: '0xd',
    requestToFulfilledMs: 1_200,
    requestToConsumedMs: 1_450,
  },
  {
    iteration: 3,
    requestId: '3',
    requestTxDigest: '0x3',
    fulfillTxDigest: '0xe',
    consumeTxDigest: '0xf',
    requestToFulfilledMs: 2_400,
    requestToConsumedMs: 2_900,
  },
];

test('percentile interpolates across sorted samples', () => {
  assert.equal(percentile([100, 200, 300, 400], 0.5), 250);
  assert.equal(percentile([100, 200, 300, 400], 0.95), 385);
});

test('summarizeLatency computes p95 target status', () => {
  const summary = summarizeLatency(measurements, 2_000);

  assert.equal(summary.iterations, 3);
  assert.equal(summary.meetsTarget, false);
  assert.equal(summary.requestToFulfilledMs.minMs, 800);
  assert.equal(summary.requestToFulfilledMs.maxMs, 2_400);
  assert.equal(summary.requestToFulfilledMs.p50Ms, 1_200);
  assert.ok(summary.requestToFulfilledMs.p95Ms > 2_000);
});

test('recommendTuning points to supported config levers', () => {
  const summary = summarizeLatency(measurements, 2_000);
  const recommendations = recommendTuning(summary, {
    pollIntervalMs: 500,
    eventPageSize: 50,
    maxRetryAttempts: 3,
    retryBaseDelayMs: 2_000,
  });

  assert.match(recommendations.join('\n'), /POLL_INTERVAL_MS/);
  assert.match(recommendations.join('\n'), /EVENT_PAGE_SIZE/);
  assert.match(recommendations.join('\n'), /MAX_RETRY_ATTEMPTS/);
  assert.match(recommendations.join('\n'), /RETRY_BASE_DELAY_MS/);
});
