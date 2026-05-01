import { request as httpRequest } from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';

import { OpsServer } from './server';
import { InMemoryRuntimeMonitor } from './runtime-monitor';
import type { Logger } from '../types';

const noopLogger: Logger = {
  info() {},
  warn() {},
  error() {},
};

async function performRequest(
  port: number,
  path: string,
  method = 'GET',
): Promise<{ body: string; headers: Record<string, string | string[] | undefined>; statusCode: number }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({
            body,
            headers: res.headers,
            statusCode: res.statusCode ?? 0,
          });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

test('OpsServer serves health, readiness, and metrics endpoints', async (t) => {
  let currentTime = Date.parse('2026-03-17T00:00:00.000Z');
  const monitor = new InMemoryRuntimeMonitor(1_000, () => currentTime);
  const server = new OpsServer({
    host: '127.0.0.1',
    port: 0,
    logger: noopLogger,
    monitor,
    now: () => currentTime,
  });
  const address = await server.start();
  t.after(async () => {
    await server.close();
  });

  const health = await performRequest(address.port, '/healthz');
  assert.equal(health.statusCode, 200);
  assert.equal(health.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(health.body), {
    status: 'ok',
    startedAt: '2026-03-17T00:00:00.000Z',
    uptimeSec: 0,
  });

  let ready = await performRequest(address.port, '/readyz');
  assert.equal(ready.statusCode, 503);
  assert.deepEqual(JSON.parse(ready.body), {
    status: 'not_ready',
    initialized: false,
    lastSuccessfulPollAt: null,
    lastPollError: null,
    circuitBreakerState: 'closed',
    circuitBreakerOpenUntil: null,
    circuitBreakerLastError: null,
    staleAfterMs: 5000,
  });

  monitor.markInitialized();
  monitor.recordPollStart(0);
  currentTime += 250;
  monitor.recordPollSuccess(2);

  ready = await performRequest(address.port, '/readyz');
  assert.equal(ready.statusCode, 200);
  assert.deepEqual(JSON.parse(ready.body), {
    status: 'ready',
    initialized: true,
    lastSuccessfulPollAt: '2026-03-17T00:00:00.250Z',
    lastPollError: null,
    circuitBreakerState: 'closed',
    circuitBreakerOpenUntil: null,
    circuitBreakerLastError: null,
    staleAfterMs: 5000,
  });

  const metrics = await performRequest(address.port, '/metrics');
  assert.equal(metrics.statusCode, 200);
  assert.equal(metrics.headers['content-type'], 'text/plain; version=0.0.4');
  assert.match(metrics.body, /kamui_iota_vrf_node_up 1/);
  assert.match(metrics.body, /kamui_iota_vrf_node_ready 1/);

  monitor.recordCircuitBreaker({
    state: 'open',
    consecutiveFailures: 3,
    openUntil: '2026-03-17T00:00:05.250Z',
    lastError: 'rpc timeout',
  });
  ready = await performRequest(address.port, '/readyz');
  assert.equal(ready.statusCode, 503);
  assert.deepEqual(JSON.parse(ready.body), {
    status: 'not_ready',
    initialized: true,
    lastSuccessfulPollAt: '2026-03-17T00:00:00.250Z',
    lastPollError: null,
    circuitBreakerState: 'open',
    circuitBreakerOpenUntil: '2026-03-17T00:00:05.250Z',
    circuitBreakerLastError: 'rpc timeout',
    staleAfterMs: 5000,
  });

  currentTime += 5_001;
  ready = await performRequest(address.port, '/readyz');
  assert.equal(ready.statusCode, 503);
});

test('OpsServer rejects non-GET methods and unknown routes', async (t) => {
  const monitor = new InMemoryRuntimeMonitor(1_000);
  const server = new OpsServer({
    host: '127.0.0.1',
    port: 0,
    logger: noopLogger,
    monitor,
  });
  const address = await server.start();
  t.after(async () => {
    await server.close();
  });

  const notFound = await performRequest(address.port, '/unknown');
  assert.equal(notFound.statusCode, 404);

  const methodNotAllowed = await performRequest(address.port, '/healthz', 'POST');
  assert.equal(methodNotAllowed.statusCode, 405);
  assert.equal(methodNotAllowed.headers.allow, 'GET');
});
