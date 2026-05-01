import test from 'node:test';
import assert from 'node:assert/strict';

import { InMemoryRuntimeMonitor } from './runtime-monitor';

test('InMemoryRuntimeMonitor readiness follows init and poll success state', () => {
  let currentTime = Date.parse('2026-03-17T00:00:00.000Z');
  const monitor = new InMemoryRuntimeMonitor(1_000, () => currentTime);

  assert.equal(monitor.snapshot().ready, false);

  monitor.markInitialized();
  assert.equal(monitor.snapshot().ready, false);

  monitor.recordPollStart(2);
  currentTime += 250;
  monitor.recordPollSuccess(3);

  let snapshot = monitor.snapshot();
  assert.equal(snapshot.ready, true);
  assert.equal(snapshot.inflightRequests, 0);
  assert.equal(snapshot.staleAfterMs, 5_000);
  assert.equal(snapshot.lastPollError, null);
  assert.equal(snapshot.circuitBreaker.state, 'closed');

  monitor.recordCircuitBreaker({
    state: 'open',
    consecutiveFailures: 3,
    openUntil: '2026-03-17T00:00:05.250Z',
    lastError: 'rpc timeout',
  });
  snapshot = monitor.snapshot();
  assert.equal(snapshot.ready, false);
  assert.equal(snapshot.circuitBreaker.state, 'open');

  currentTime += 5_001;
  snapshot = monitor.snapshot();
  assert.equal(snapshot.ready, false);
});

test('InMemoryRuntimeMonitor records request metrics and poll gauges', () => {
  let currentTime = Date.parse('2026-03-17T00:00:00.000Z');
  const monitor = new InMemoryRuntimeMonitor(500, () => currentTime);

  monitor.markInitialized();
  monitor.recordPollStart(4);
  monitor.recordRequestStart();
  monitor.recordRequestError('prove', true);
  currentTime += 200;
  monitor.recordRequestOutcome('retry', 200);
  currentTime += 300;
  monitor.recordPollSuccess(5);
  monitor.recordCircuitBreaker({
    state: 'open',
    consecutiveFailures: 2,
    openUntil: '2026-03-17T00:00:10.500Z',
    lastError: 'rpc timeout',
  });

  const output = monitor.renderPrometheus();

  assert.match(output, /kamui_iota_vrf_due_retries 4/);
  assert.match(output, /kamui_iota_vrf_events_seen_total 5/);
  assert.match(output, /kamui_iota_vrf_inflight_requests 0/);
  assert.match(output, /kamui_iota_vrf_request_errors_total\{retryable="true",stage="prove"\} 1/);
  assert.match(output, /kamui_iota_vrf_requests_total\{outcome="retry"\} 1/);
  assert.match(output, /kamui_iota_vrf_request_processing_duration_seconds_count 1/);
  assert.match(output, /kamui_iota_vrf_node_ready 0/);
  assert.match(output, /kamui_iota_vrf_rpc_circuit_breaker_state\{state="open"\} 1/);
  assert.match(output, /kamui_iota_vrf_rpc_circuit_breaker_state\{state="closed"\} 0/);
  assert.match(output, /kamui_iota_vrf_rpc_circuit_breaker_consecutive_failures 2/);
});
