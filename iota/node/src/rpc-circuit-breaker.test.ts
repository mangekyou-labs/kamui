import test from 'node:test';
import assert from 'node:assert/strict';

import { RpcCircuitBreaker } from './rpc-circuit-breaker';

test('RpcCircuitBreaker opens after consecutive failures and recovers after cooldown', () => {
  let currentTime = Date.parse('2026-03-17T00:00:00.000Z');
  const breaker = new RpcCircuitBreaker({
    failureThreshold: 2,
    cooldownMs: 5_000,
    now: () => currentTime,
  });

  assert.equal(breaker.allowRequest(), true);

  breaker.recordFailure('rpc timeout');
  assert.deepEqual(breaker.snapshot(), {
    state: 'closed',
    consecutiveFailures: 1,
    openUntil: null,
    lastError: 'rpc timeout',
  });

  breaker.recordFailure('rpc timeout');
  assert.deepEqual(breaker.snapshot(), {
    state: 'open',
    consecutiveFailures: 2,
    openUntil: '2026-03-17T00:00:05.000Z',
    lastError: 'rpc timeout',
  });
  assert.equal(breaker.allowRequest(), false);

  currentTime += 5_000;
  assert.equal(breaker.allowRequest(), true);
  assert.deepEqual(breaker.snapshot(), {
    state: 'half_open',
    consecutiveFailures: 2,
    openUntil: null,
    lastError: 'rpc timeout',
  });

  breaker.recordSuccess();
  assert.deepEqual(breaker.snapshot(), {
    state: 'closed',
    consecutiveFailures: 0,
    openUntil: null,
    lastError: null,
  });
});

test('RpcCircuitBreaker re-opens immediately when a half-open probe fails', () => {
  let currentTime = Date.parse('2026-03-17T00:00:00.000Z');
  const breaker = new RpcCircuitBreaker({
    failureThreshold: 3,
    cooldownMs: 10_000,
    now: () => currentTime,
  });

  breaker.recordFailure('rpc timeout');
  breaker.recordFailure('rpc timeout');
  breaker.recordFailure('rpc timeout');
  currentTime += 10_000;
  assert.equal(breaker.allowRequest(), true);

  breaker.recordFailure('rpc timeout again');
  assert.deepEqual(breaker.snapshot(), {
    state: 'open',
    consecutiveFailures: 3,
    openUntil: '2026-03-17T00:00:20.000Z',
    lastError: 'rpc timeout again',
  });
});
