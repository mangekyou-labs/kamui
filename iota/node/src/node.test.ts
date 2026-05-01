import { mkdtemp } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { InMemoryRuntimeMonitor } from './api/runtime-monitor';
import { computeRetryDelayMs, VrfNode } from './node';
import type {
  ChainRequestState,
  CoordinatorReader,
  EventCursor,
  EventIngestor,
  EventPage,
  FulfillmentSubmitter,
  Logger,
  PendingRequest,
  Prover,
} from './types';
import { JsonStateStore } from './store/json-state';
import { SubmissionError } from './submit/fulfill';

const noopLogger: Logger = {
  info() {},
  warn() {},
  error() {},
};

function buildRequest(requestId: string): PendingRequest {
  return {
    requestId,
    subscriptionId: '2',
    requester: '0x3',
    seedHex: 'abcd',
    numWords: 1,
    timestampMs: Date.now(),
    eventId: `0xfeed:${requestId}`,
    cursor: { txDigest: '0xfeed', eventSeq: requestId },
    type: '0x1::request::RandomnessRequested',
  };
}

class StaticIngestor implements EventIngestor {
  constructor(private readonly page: EventPage) {}

  async fetchPage(_cursor: EventCursor | null): Promise<EventPage> {
    return {
      events: this.page.events.map((e) => ({ ...e, cursor: { ...e.cursor } })),
      nextCursor: this.page.nextCursor ? { ...this.page.nextCursor } : null,
      hasNextPage: this.page.hasNextPage,
    };
  }
}

class SequenceIngestor implements EventIngestor {
  public calls = 0;

  constructor(private readonly outcomes: Array<EventPage | Error>) {}

  async fetchPage(_cursor: EventCursor | null): Promise<EventPage> {
    const outcome = this.outcomes[this.calls] ?? this.outcomes[this.outcomes.length - 1];
    this.calls += 1;
    if (outcome instanceof Error) {
      throw outcome;
    }
    return {
      events: outcome.events.map((e) => ({ ...e, cursor: { ...e.cursor } })),
      nextCursor: outcome.nextCursor ? { ...outcome.nextCursor } : null,
      hasNextPage: outcome.hasNextPage,
    };
  }
}

class MockProver implements Prover {
  async generateProof() {
    return {
      proofHex: 'ab'.repeat(80),
      outputHex: 'cd'.repeat(64),
    };
  }

  getPublicKey(): string | null {
    return '11'.repeat(32);
  }
}

class MockCoordinatorReader implements CoordinatorReader {
  constructor(
    private readonly requestState: ChainRequestState = 'pending',
    private readonly activeVrfPublicKey = '11'.repeat(32),
  ) {}

  async getActiveVrfPublicKey(): Promise<string> {
    return this.activeVrfPublicKey;
  }

  async getRequestStatus(): Promise<ChainRequestState> {
    return this.requestState;
  }
}

function createMonitor(): InMemoryRuntimeMonitor {
  return new InMemoryRuntimeMonitor(1_000);
}

test('computeRetryDelayMs applies capped equal jitter', () => {
  assert.equal(computeRetryDelayMs(0, 1_000, 30_000, () => 0), 500);
  assert.equal(computeRetryDelayMs(1, 1_000, 30_000, () => 0), 1_000);

  const capped = computeRetryDelayMs(10, 1_000, 5_000, () => 0.999999);
  assert.ok(capped >= 2_500);
  assert.ok(capped <= 5_000);
});

test('VrfNode records fulfilled requests', async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'iota-node-run-once-'));
  const store = new JsonStateStore(stateDir);
  await store.initialize();

  const request = buildRequest('1');
  const submitter: FulfillmentSubmitter = {
    getOperatorAddress: () => '0xabc',
    submitFulfillment: async () => ({ txDigest: '0xdeadbeef' }),
  };
  const monitor = createMonitor();

  const node = new VrfNode(
    {
      pollIntervalMs: 1,
      maxRetryAttempts: 5,
      retryBaseDelayMs: 1_000,
    },
    store,
    new StaticIngestor({
      events: [request],
      nextCursor: request.cursor,
      hasNextPage: false,
    }),
    new MockProver(),
    new MockCoordinatorReader(),
    submitter,
    monitor,
    noopLogger,
  );

  await node.runOnce();

  assert.equal(store.getRequest('1')?.status, 'fulfilled');
  assert.equal(store.getRequest('1')?.txDigest, '0xdeadbeef');
  assert.match(monitor.renderPrometheus(), /kamui_iota_vrf_requests_total\{outcome="fulfilled"\} 1/);
});

test('VrfNode skips already fulfilled requests after restart', async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'iota-node-restart-'));
  const store = new JsonStateStore(stateDir);
  await store.initialize();

  const request = buildRequest('1');
  await store.markFulfilled(request, 1, '0xfirst');

  let submitCount = 0;
  const submitter: FulfillmentSubmitter = {
    getOperatorAddress: () => '0xabc',
    submitFulfillment: async () => {
      submitCount += 1;
      return { txDigest: '0xsecond' };
    },
  };
  const monitor = createMonitor();

  const reloadedStore = new JsonStateStore(stateDir);
  await reloadedStore.initialize();

  const node = new VrfNode(
    {
      pollIntervalMs: 1,
      maxRetryAttempts: 5,
      retryBaseDelayMs: 1_000,
    },
    reloadedStore,
    new StaticIngestor({
      events: [request],
      nextCursor: request.cursor,
      hasNextPage: false,
    }),
    new MockProver(),
    new MockCoordinatorReader(),
    submitter,
    monitor,
    noopLogger,
  );

  await node.runOnce();

  assert.equal(submitCount, 0);
  assert.equal(reloadedStore.getRequest('1')?.txDigest, '0xfirst');
});

test('VrfNode marks terminal aborts and stops retrying them', async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'iota-node-terminal-'));
  const store = new JsonStateStore(stateDir);
  await store.initialize();

  const request = buildRequest('1');
  let submitCount = 0;
  const submitter: FulfillmentSubmitter = {
    getOperatorAddress: () => '0xabc',
    submitFulfillment: async () => {
      submitCount += 1;
      throw new SubmissionError('terminal_abort', 'MoveAbort: abort code 7', false);
    },
  };
  const monitor = createMonitor();

  const node = new VrfNode(
    {
      pollIntervalMs: 1,
      maxRetryAttempts: 5,
      retryBaseDelayMs: 1_000,
    },
    store,
    new StaticIngestor({
      events: [request],
      nextCursor: request.cursor,
      hasNextPage: false,
    }),
    new MockProver(),
    new MockCoordinatorReader(),
    submitter,
    monitor,
    noopLogger,
  );

  await node.runOnce();
  await node.runOnce();

  assert.equal(submitCount, 1);
  assert.equal(store.getRequest('1')?.status, 'terminal');
  assert.match(monitor.renderPrometheus(), /kamui_iota_vrf_request_errors_total\{retryable="false",stage="submit"\} 1/);
  assert.match(monitor.renderPrometheus(), /kamui_iota_vrf_requests_total\{outcome="terminal"\} 1/);
});

test('VrfNode skips submit when request is already fulfilled on-chain', async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'iota-node-onchain-fulfilled-'));
  const store = new JsonStateStore(stateDir);
  await store.initialize();

  const request = buildRequest('1');
  let submitCount = 0;
  const submitter: FulfillmentSubmitter = {
    getOperatorAddress: () => '0xabc',
    submitFulfillment: async () => {
      submitCount += 1;
      return { txDigest: '0xshould-not-happen' };
    },
  };
  const monitor = createMonitor();

  const node = new VrfNode(
    {
      pollIntervalMs: 1,
      maxRetryAttempts: 5,
      retryBaseDelayMs: 1_000,
    },
    store,
    new StaticIngestor({
      events: [request],
      nextCursor: request.cursor,
      hasNextPage: false,
    }),
    new MockProver(),
    new MockCoordinatorReader('fulfilled'),
    submitter,
    monitor,
    noopLogger,
  );

  await node.runOnce();

  assert.equal(submitCount, 0);
  assert.equal(store.getRequest('1')?.status, 'fulfilled');
  assert.equal(store.getRequest('1')?.txDigest, null);
  assert.match(
    monitor.renderPrometheus(),
    /kamui_iota_vrf_requests_total\{outcome="skipped_fulfilled"\} 1/,
  );
});

test('VrfNode startup fails when local and on-chain VRF keys differ', async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'iota-node-key-mismatch-'));
  const store = new JsonStateStore(stateDir);
  await store.initialize();
  const monitor = createMonitor();

  const node = new VrfNode(
    {
      pollIntervalMs: 1,
      maxRetryAttempts: 5,
      retryBaseDelayMs: 1_000,
    },
    store,
    new StaticIngestor({
      events: [],
      nextCursor: null,
      hasNextPage: false,
    }),
    new MockProver(),
    new MockCoordinatorReader('pending', '22'.repeat(32)),
    {
      getOperatorAddress: () => '0xabc',
      submitFulfillment: async () => ({ txDigest: '0xdeadbeef' }),
    },
    monitor,
    noopLogger,
  );

  await assert.rejects(() => node.initialize(), /does not match coordinator key/);
});

test('VrfNode records skipped_missing outcomes', async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'iota-node-missing-'));
  const store = new JsonStateStore(stateDir);
  await store.initialize();
  const request = buildRequest('1');
  const monitor = createMonitor();

  const node = new VrfNode(
    {
      pollIntervalMs: 1,
      maxRetryAttempts: 5,
      retryBaseDelayMs: 1_000,
    },
    store,
    new StaticIngestor({
      events: [request],
      nextCursor: request.cursor,
      hasNextPage: false,
    }),
    new MockProver(),
    new MockCoordinatorReader('missing'),
    {
      getOperatorAddress: () => '0xabc',
      submitFulfillment: async () => ({ txDigest: '0xdeadbeef' }),
    },
    monitor,
    noopLogger,
  );

  await node.runOnce();

  assert.equal(store.getRequest('1')?.status, 'terminal');
  assert.match(monitor.renderPrometheus(), /kamui_iota_vrf_requests_total\{outcome="skipped_missing"\} 1/);
});

test('VrfNode records skipped_cancelled outcomes', async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'iota-node-cancelled-'));
  const store = new JsonStateStore(stateDir);
  await store.initialize();
  const request = buildRequest('1');
  const monitor = createMonitor();

  const node = new VrfNode(
    {
      pollIntervalMs: 1,
      maxRetryAttempts: 5,
      retryBaseDelayMs: 1_000,
    },
    store,
    new StaticIngestor({
      events: [request],
      nextCursor: request.cursor,
      hasNextPage: false,
    }),
    new MockProver(),
    new MockCoordinatorReader('cancelled'),
    {
      getOperatorAddress: () => '0xabc',
      submitFulfillment: async () => ({ txDigest: '0xdeadbeef' }),
    },
    monitor,
    noopLogger,
  );

  await node.runOnce();

  assert.equal(store.getRequest('1')?.status, 'terminal');
  assert.match(
    monitor.renderPrometheus(),
    /kamui_iota_vrf_requests_total\{outcome="skipped_cancelled"\} 1/,
  );
});

// ─── Additional node integration tests ────────────────────────────────────────

test('VrfNode retries retryable failures with exponential backoff', async () => {
  // Keep synthetic clock aligned with wall clock because JsonStateStore.listDueRetries
  // compares against real Date.now().
  let currentTime = Date.now();
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'iota-node-retry-backoff-'));
  const store = new JsonStateStore(stateDir);
  await store.initialize();

  // event '1' is marked fulfilled so processFreshEvents skips it.
  await store.markFulfilled(buildRequest('1'), 1, '0xskip');
  // pre-seed a retry so only processDueRetries executes submit.
  await store.markRetry(buildRequest('1'), 0, 'prev', new Date().toISOString());

  let attemptCount = 0;
  const submitter: FulfillmentSubmitter = {
    getOperatorAddress: () => '0xabc',
    submitFulfillment: async () => {
      attemptCount += 1;
      throw new SubmissionError('transient_failure', 'RPC timeout', true);
    },
  };

  let nodeTime = currentTime;
  const node = new VrfNode(
    {
      pollIntervalMs: 1,
      maxRetryAttempts: 5,
      retryBaseDelayMs: 1_000,
      retryMaxDelayMs: 30_000,
      now: () => nodeTime,
    },
    store,
    new StaticIngestor({
      events: [buildRequest('1')],
      nextCursor: { txDigest: '0xfeed', eventSeq: '1' },
      hasNextPage: false,
    }),
    new MockProver(),
    new MockCoordinatorReader(),
    submitter,
    new InMemoryRuntimeMonitor(1_000),
    noopLogger,
  );

  await node.runOnce();
  assert.equal(attemptCount, 1);

  // Force not-due to avoid wall-clock race with immediate rerun.
  await store.markRetry(buildRequest('1'), 1, 'prev', new Date(Date.now() + 60_000).toISOString());

  await node.runOnce();
  assert.equal(attemptCount, 1); // still not due

  // Force due and rerun.
  await store.markRetry(buildRequest('1'), 1, 'prev', new Date(Date.now() - 1_000).toISOString());
  await node.runOnce();
  assert.equal(attemptCount, 2);
  assert.equal(store.getRequest('1')?.status, 'retry');
});

test('VrfNode does not submit when getPublicKey returns null at startup', async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'iota-node-null-pk-'));
  const store = new JsonStateStore(stateDir);
  await store.initialize();

  const nullPkProver: Prover = {
    async generateProof() {
      return { proofHex: 'ab'.repeat(80), outputHex: 'cd'.repeat(64) };
    },
    getPublicKey(): string | null {
      return null;
    },
  };

  const node = new VrfNode(
    {
      pollIntervalMs: 1,
      maxRetryAttempts: 5,
      retryBaseDelayMs: 1_000,
    },
    store,
    new StaticIngestor({ events: [], nextCursor: null, hasNextPage: false }),
    nullPkProver,
    new MockCoordinatorReader(),
    {
      getOperatorAddress: () => '0xabc',
      submitFulfillment: async () => ({ txDigest: '0xdeadbeef' }),
    },
    new InMemoryRuntimeMonitor(1_000),
    noopLogger,
  );

  await assert.rejects(
    () => node.initialize(),
    /VRF public key is required/,
  );
});

test('VrfNode skips processing when circuit breaker opens mid-page', async () => {
  let currentTime = Date.parse('2026-03-17T00:00:00.000Z');
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'iota-node-cb-skip-'));
  const store = new JsonStateStore(stateDir);
  await store.initialize();

  // Skip fresh events by pre-marking them fulfilled.
  for (const id of ['1', '2', '3']) {
    await store.markFulfilled(buildRequest(id), 1, `0x${id}-skip`);
  }

  // Due retries that will be processed; second retry opens breaker.
  await store.markRetry(buildRequest('4'), 1, 'prev', new Date().toISOString());
  await store.markRetry(buildRequest('5'), 1, 'prev', new Date().toISOString());

  const seenRetryIds: string[] = [];
  const node = new VrfNode(
    {
      pollIntervalMs: 1,
      maxRetryAttempts: 5,
      retryBaseDelayMs: 1_000,
      circuitBreakerFailureThreshold: 2,
      circuitBreakerCooldownMs: 10_000,
      now: () => currentTime,
    },
    store,
    new StaticIngestor({
      events: [buildRequest('1'), buildRequest('2'), buildRequest('3')],
      nextCursor: { txDigest: '0xfeed', eventSeq: '3' },
      hasNextPage: false,
    }),
    new MockProver(),
    new MockCoordinatorReader(),
    {
      async submitFulfillment(req: PendingRequest) {
        seenRetryIds.push(req.requestId);
        throw Object.assign(new Error('transient rpc timeout'), { retryable: true });
      },
      getOperatorAddress: () => '0xabc',
    },
    new InMemoryRuntimeMonitor(1_000, () => currentTime),
    noopLogger,
  );

  await node.runOnce();
  assert.deepEqual(seenRetryIds, ['4', '5']);
  assert.equal(store.getRequest('4')?.status, 'retry');
  assert.equal(store.getRequest('5')?.status, 'retry');
});

test('VrfNode processes multiple requests in a single poll cycle', async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'iota-node-multi-'));
  const store = new JsonStateStore(stateDir);
  await store.initialize();

  // This test verifies single-run processing for 3 independent requests.
  const seenRequestIds: string[] = [];
  const node = new VrfNode(
    {
      pollIntervalMs: 1,
      maxRetryAttempts: 5,
      retryBaseDelayMs: 1_000,
    },
    store,
    new SequenceIngestor([
      {
        events: [buildRequest('a'), buildRequest('b'), buildRequest('c')],
        nextCursor: { txDigest: '0xfeed', eventSeq: 'c' },
        hasNextPage: false,
      },
    ]),
    new MockProver(),
    new MockCoordinatorReader(),
    {
      async submitFulfillment(req: PendingRequest) {
        seenRequestIds.push(req.requestId);
        return { txDigest: `0x${req.requestId}` };
      },
      getOperatorAddress: () => '0xabc',
    },
    new InMemoryRuntimeMonitor(1_000),
    noopLogger,
  );

  await node.runOnce();

  assert.deepEqual(seenRequestIds, ['a', 'b', 'c']);
  assert.equal(store.getRequest('a')?.status, 'fulfilled');
  assert.equal(store.getRequest('b')?.status, 'fulfilled');
  assert.equal(store.getRequest('c')?.status, 'fulfilled');
});

test('VrfNode retries are ordered by updatedAt (FIFO)', async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'iota-node-retry-order-'));
  const store = new JsonStateStore(stateDir);
  await store.initialize();

  // Skip fresh event '1'.
  await store.markFulfilled(buildRequest('1'), 1, '0xskip');

  const now = Date.now();
  await store.markRetry(buildRequest('first'), 1, 'prev', new Date(now - 10_000).toISOString());
  await store.markRetry(buildRequest('second'), 1, 'prev', new Date(now - 5_000).toISOString());
  await store.markRetry(buildRequest('third'), 1, 'prev', new Date(now - 1_000).toISOString());

  const seenRetryIds: string[] = [];
  const node = new VrfNode(
    {
      pollIntervalMs: 1,
      maxRetryAttempts: 5,
      retryBaseDelayMs: 1_000,
    },
    store,
    new StaticIngestor({ events: [buildRequest('1')], nextCursor: { txDigest: '0xfeed', eventSeq: '1' }, hasNextPage: false }),
    new MockProver(),
    new MockCoordinatorReader(),
    {
      async submitFulfillment(req: PendingRequest) {
        seenRetryIds.push(req.requestId);
        throw new SubmissionError('transient_failure', 'retry', true);
      },
      getOperatorAddress: () => '0xabc',
    },
    new InMemoryRuntimeMonitor(1_000),
    noopLogger,
  );

  await node.runOnce();

  assert.deepEqual(seenRetryIds, ['first', 'second', 'third']);
});

test('VrfNode respects maxRetryAttempts cap and transitions to terminal', async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'iota-node-max-retries-'));
  const store = new JsonStateStore(stateDir);
  await store.initialize();

  const MAX_ATTEMPTS = 3;

  // Skip fresh event '1'.
  await store.markFulfilled(buildRequest('1'), 1, '0xskip');
  await store.markRetry(buildRequest('1'), MAX_ATTEMPTS - 1, 'RPC timeout', new Date().toISOString());

  const node = new VrfNode(
    {
      pollIntervalMs: 1,
      maxRetryAttempts: MAX_ATTEMPTS,
      retryBaseDelayMs: 1_000,
    },
    store,
    new StaticIngestor({ events: [buildRequest('1')], nextCursor: { txDigest: '0xfeed', eventSeq: '1' }, hasNextPage: false }),
    new MockProver(),
    new MockCoordinatorReader(),
    {
      async submitFulfillment() {
        throw new SubmissionError('transient_failure', 'RPC timeout', true);
      },
      getOperatorAddress: () => '0xabc',
    },
    new InMemoryRuntimeMonitor(1_000),
    noopLogger,
  );

  await node.runOnce();

  assert.equal(store.getRequest('1')?.status, 'terminal');
  assert.equal(store.getRequest('1')?.lastError, 'RPC timeout');
});

// ─── Circuit breaker tests ─────────────────────────────────────────────────────

test('VrfNode opens and recovers the RPC circuit breaker after consecutive RPC failures', async () => {
  let currentTime = Date.parse('2026-03-17T00:00:00.000Z');
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'iota-node-circuit-breaker-'));
  const store = new JsonStateStore(stateDir);
  await store.initialize();

  const retryableRpcError = () =>
    Object.assign(new Error('rpc timeout'), {
      retryable: true,
    });

  const ingestor = new SequenceIngestor([
    retryableRpcError(),
    retryableRpcError(),
    {
      events: [],
      nextCursor: null,
      hasNextPage: false,
    },
  ]);
  const monitor = new InMemoryRuntimeMonitor(1_000, () => currentTime);

  const node = new VrfNode(
    {
      pollIntervalMs: 1,
      maxRetryAttempts: 5,
      retryBaseDelayMs: 1_000,
      circuitBreakerFailureThreshold: 2,
      circuitBreakerCooldownMs: 5_000,
      now: () => currentTime,
    },
    store,
    ingestor,
    new MockProver(),
    new MockCoordinatorReader(),
    {
      getOperatorAddress: () => '0xabc',
      submitFulfillment: async () => ({ txDigest: '0xdeadbeef' }),
    },
    monitor,
    noopLogger,
  );

  await assert.rejects(() => node.runOnce(), /rpc timeout/);
  assert.equal(monitor.snapshot().circuitBreaker.state, 'closed');

  await assert.rejects(() => node.runOnce(), /rpc timeout/);
  assert.equal(monitor.snapshot().circuitBreaker.state, 'open');
  assert.equal(ingestor.calls, 2);

  await node.runOnce();
  assert.equal(ingestor.calls, 2);
  assert.equal(monitor.snapshot().circuitBreaker.state, 'open');

  currentTime += 5_000;
  await node.runOnce();
  assert.equal(ingestor.calls, 3);
  assert.equal(monitor.snapshot().circuitBreaker.state, 'closed');
});
