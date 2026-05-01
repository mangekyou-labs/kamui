"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const promises_1 = require("fs/promises");
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const runtime_monitor_1 = require("./api/runtime-monitor");
const node_1 = require("./node");
const json_state_1 = require("./store/json-state");
const fulfill_1 = require("./submit/fulfill");
const noopLogger = {
    info() { },
    warn() { },
    error() { },
};
function buildRequest(requestId) {
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
class StaticIngestor {
    constructor(page) {
        this.page = page;
    }
    async fetchPage(_cursor) {
        return {
            events: this.page.events.map((e) => ({ ...e, cursor: { ...e.cursor } })),
            nextCursor: this.page.nextCursor ? { ...this.page.nextCursor } : null,
            hasNextPage: this.page.hasNextPage,
        };
    }
}
class SequenceIngestor {
    constructor(outcomes) {
        this.outcomes = outcomes;
        this.calls = 0;
    }
    async fetchPage(_cursor) {
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
class MockProver {
    async generateProof() {
        return {
            proofHex: 'ab'.repeat(80),
            outputHex: 'cd'.repeat(64),
        };
    }
    getPublicKey() {
        return '11'.repeat(32);
    }
}
class MockCoordinatorReader {
    constructor(requestState = 'pending', activeVrfPublicKey = '11'.repeat(32)) {
        this.requestState = requestState;
        this.activeVrfPublicKey = activeVrfPublicKey;
    }
    async getActiveVrfPublicKey() {
        return this.activeVrfPublicKey;
    }
    async getRequestStatus() {
        return this.requestState;
    }
}
function createMonitor() {
    return new runtime_monitor_1.InMemoryRuntimeMonitor(1000);
}
(0, node_test_1.default)('computeRetryDelayMs applies capped equal jitter', () => {
    strict_1.default.equal((0, node_1.computeRetryDelayMs)(0, 1000, 30000, () => 0), 500);
    strict_1.default.equal((0, node_1.computeRetryDelayMs)(1, 1000, 30000, () => 0), 1000);
    const capped = (0, node_1.computeRetryDelayMs)(10, 1000, 5000, () => 0.999999);
    strict_1.default.ok(capped >= 2500);
    strict_1.default.ok(capped <= 5000);
});
(0, node_test_1.default)('VrfNode records fulfilled requests', async () => {
    const stateDir = await (0, promises_1.mkdtemp)(path.join(os.tmpdir(), 'iota-node-run-once-'));
    const store = new json_state_1.JsonStateStore(stateDir);
    await store.initialize();
    const request = buildRequest('1');
    const submitter = {
        getOperatorAddress: () => '0xabc',
        submitFulfillment: async () => ({ txDigest: '0xdeadbeef' }),
    };
    const monitor = createMonitor();
    const node = new node_1.VrfNode({
        pollIntervalMs: 1,
        maxRetryAttempts: 5,
        retryBaseDelayMs: 1000,
    }, store, new StaticIngestor({
        events: [request],
        nextCursor: request.cursor,
        hasNextPage: false,
    }), new MockProver(), new MockCoordinatorReader(), submitter, monitor, noopLogger);
    await node.runOnce();
    strict_1.default.equal(store.getRequest('1')?.status, 'fulfilled');
    strict_1.default.equal(store.getRequest('1')?.txDigest, '0xdeadbeef');
    strict_1.default.match(monitor.renderPrometheus(), /kamui_iota_vrf_requests_total\{outcome="fulfilled"\} 1/);
});
(0, node_test_1.default)('VrfNode skips already fulfilled requests after restart', async () => {
    const stateDir = await (0, promises_1.mkdtemp)(path.join(os.tmpdir(), 'iota-node-restart-'));
    const store = new json_state_1.JsonStateStore(stateDir);
    await store.initialize();
    const request = buildRequest('1');
    await store.markFulfilled(request, 1, '0xfirst');
    let submitCount = 0;
    const submitter = {
        getOperatorAddress: () => '0xabc',
        submitFulfillment: async () => {
            submitCount += 1;
            return { txDigest: '0xsecond' };
        },
    };
    const monitor = createMonitor();
    const reloadedStore = new json_state_1.JsonStateStore(stateDir);
    await reloadedStore.initialize();
    const node = new node_1.VrfNode({
        pollIntervalMs: 1,
        maxRetryAttempts: 5,
        retryBaseDelayMs: 1000,
    }, reloadedStore, new StaticIngestor({
        events: [request],
        nextCursor: request.cursor,
        hasNextPage: false,
    }), new MockProver(), new MockCoordinatorReader(), submitter, monitor, noopLogger);
    await node.runOnce();
    strict_1.default.equal(submitCount, 0);
    strict_1.default.equal(reloadedStore.getRequest('1')?.txDigest, '0xfirst');
});
(0, node_test_1.default)('VrfNode marks terminal aborts and stops retrying them', async () => {
    const stateDir = await (0, promises_1.mkdtemp)(path.join(os.tmpdir(), 'iota-node-terminal-'));
    const store = new json_state_1.JsonStateStore(stateDir);
    await store.initialize();
    const request = buildRequest('1');
    let submitCount = 0;
    const submitter = {
        getOperatorAddress: () => '0xabc',
        submitFulfillment: async () => {
            submitCount += 1;
            throw new fulfill_1.SubmissionError('terminal_abort', 'MoveAbort: abort code 7', false);
        },
    };
    const monitor = createMonitor();
    const node = new node_1.VrfNode({
        pollIntervalMs: 1,
        maxRetryAttempts: 5,
        retryBaseDelayMs: 1000,
    }, store, new StaticIngestor({
        events: [request],
        nextCursor: request.cursor,
        hasNextPage: false,
    }), new MockProver(), new MockCoordinatorReader(), submitter, monitor, noopLogger);
    await node.runOnce();
    await node.runOnce();
    strict_1.default.equal(submitCount, 1);
    strict_1.default.equal(store.getRequest('1')?.status, 'terminal');
    strict_1.default.match(monitor.renderPrometheus(), /kamui_iota_vrf_request_errors_total\{retryable="false",stage="submit"\} 1/);
    strict_1.default.match(monitor.renderPrometheus(), /kamui_iota_vrf_requests_total\{outcome="terminal"\} 1/);
});
(0, node_test_1.default)('VrfNode skips submit when request is already fulfilled on-chain', async () => {
    const stateDir = await (0, promises_1.mkdtemp)(path.join(os.tmpdir(), 'iota-node-onchain-fulfilled-'));
    const store = new json_state_1.JsonStateStore(stateDir);
    await store.initialize();
    const request = buildRequest('1');
    let submitCount = 0;
    const submitter = {
        getOperatorAddress: () => '0xabc',
        submitFulfillment: async () => {
            submitCount += 1;
            return { txDigest: '0xshould-not-happen' };
        },
    };
    const monitor = createMonitor();
    const node = new node_1.VrfNode({
        pollIntervalMs: 1,
        maxRetryAttempts: 5,
        retryBaseDelayMs: 1000,
    }, store, new StaticIngestor({
        events: [request],
        nextCursor: request.cursor,
        hasNextPage: false,
    }), new MockProver(), new MockCoordinatorReader('fulfilled'), submitter, monitor, noopLogger);
    await node.runOnce();
    strict_1.default.equal(submitCount, 0);
    strict_1.default.equal(store.getRequest('1')?.status, 'fulfilled');
    strict_1.default.equal(store.getRequest('1')?.txDigest, null);
    strict_1.default.match(monitor.renderPrometheus(), /kamui_iota_vrf_requests_total\{outcome="skipped_fulfilled"\} 1/);
});
(0, node_test_1.default)('VrfNode startup fails when local and on-chain VRF keys differ', async () => {
    const stateDir = await (0, promises_1.mkdtemp)(path.join(os.tmpdir(), 'iota-node-key-mismatch-'));
    const store = new json_state_1.JsonStateStore(stateDir);
    await store.initialize();
    const monitor = createMonitor();
    const node = new node_1.VrfNode({
        pollIntervalMs: 1,
        maxRetryAttempts: 5,
        retryBaseDelayMs: 1000,
    }, store, new StaticIngestor({
        events: [],
        nextCursor: null,
        hasNextPage: false,
    }), new MockProver(), new MockCoordinatorReader('pending', '22'.repeat(32)), {
        getOperatorAddress: () => '0xabc',
        submitFulfillment: async () => ({ txDigest: '0xdeadbeef' }),
    }, monitor, noopLogger);
    await strict_1.default.rejects(() => node.initialize(), /does not match coordinator key/);
});
(0, node_test_1.default)('VrfNode records skipped_missing outcomes', async () => {
    const stateDir = await (0, promises_1.mkdtemp)(path.join(os.tmpdir(), 'iota-node-missing-'));
    const store = new json_state_1.JsonStateStore(stateDir);
    await store.initialize();
    const request = buildRequest('1');
    const monitor = createMonitor();
    const node = new node_1.VrfNode({
        pollIntervalMs: 1,
        maxRetryAttempts: 5,
        retryBaseDelayMs: 1000,
    }, store, new StaticIngestor({
        events: [request],
        nextCursor: request.cursor,
        hasNextPage: false,
    }), new MockProver(), new MockCoordinatorReader('missing'), {
        getOperatorAddress: () => '0xabc',
        submitFulfillment: async () => ({ txDigest: '0xdeadbeef' }),
    }, monitor, noopLogger);
    await node.runOnce();
    strict_1.default.equal(store.getRequest('1')?.status, 'terminal');
    strict_1.default.match(monitor.renderPrometheus(), /kamui_iota_vrf_requests_total\{outcome="skipped_missing"\} 1/);
});
(0, node_test_1.default)('VrfNode records skipped_cancelled outcomes', async () => {
    const stateDir = await (0, promises_1.mkdtemp)(path.join(os.tmpdir(), 'iota-node-cancelled-'));
    const store = new json_state_1.JsonStateStore(stateDir);
    await store.initialize();
    const request = buildRequest('1');
    const monitor = createMonitor();
    const node = new node_1.VrfNode({
        pollIntervalMs: 1,
        maxRetryAttempts: 5,
        retryBaseDelayMs: 1000,
    }, store, new StaticIngestor({
        events: [request],
        nextCursor: request.cursor,
        hasNextPage: false,
    }), new MockProver(), new MockCoordinatorReader('cancelled'), {
        getOperatorAddress: () => '0xabc',
        submitFulfillment: async () => ({ txDigest: '0xdeadbeef' }),
    }, monitor, noopLogger);
    await node.runOnce();
    strict_1.default.equal(store.getRequest('1')?.status, 'terminal');
    strict_1.default.match(monitor.renderPrometheus(), /kamui_iota_vrf_requests_total\{outcome="skipped_cancelled"\} 1/);
});
// ─── Additional node integration tests ────────────────────────────────────────
(0, node_test_1.default)('VrfNode retries retryable failures with exponential backoff', async () => {
    // Keep synthetic clock aligned with wall clock because JsonStateStore.listDueRetries
    // compares against real Date.now().
    let currentTime = Date.now();
    const stateDir = await (0, promises_1.mkdtemp)(path.join(os.tmpdir(), 'iota-node-retry-backoff-'));
    const store = new json_state_1.JsonStateStore(stateDir);
    await store.initialize();
    // event '1' is marked fulfilled so processFreshEvents skips it.
    await store.markFulfilled(buildRequest('1'), 1, '0xskip');
    // pre-seed a retry so only processDueRetries executes submit.
    await store.markRetry(buildRequest('1'), 0, 'prev', new Date().toISOString());
    let attemptCount = 0;
    const submitter = {
        getOperatorAddress: () => '0xabc',
        submitFulfillment: async () => {
            attemptCount += 1;
            throw new fulfill_1.SubmissionError('transient_failure', 'RPC timeout', true);
        },
    };
    let nodeTime = currentTime;
    const node = new node_1.VrfNode({
        pollIntervalMs: 1,
        maxRetryAttempts: 5,
        retryBaseDelayMs: 1000,
        retryMaxDelayMs: 30000,
        now: () => nodeTime,
    }, store, new StaticIngestor({
        events: [buildRequest('1')],
        nextCursor: { txDigest: '0xfeed', eventSeq: '1' },
        hasNextPage: false,
    }), new MockProver(), new MockCoordinatorReader(), submitter, new runtime_monitor_1.InMemoryRuntimeMonitor(1000), noopLogger);
    await node.runOnce();
    strict_1.default.equal(attemptCount, 1);
    // Force not-due to avoid wall-clock race with immediate rerun.
    await store.markRetry(buildRequest('1'), 1, 'prev', new Date(Date.now() + 60000).toISOString());
    await node.runOnce();
    strict_1.default.equal(attemptCount, 1); // still not due
    // Force due and rerun.
    await store.markRetry(buildRequest('1'), 1, 'prev', new Date(Date.now() - 1000).toISOString());
    await node.runOnce();
    strict_1.default.equal(attemptCount, 2);
    strict_1.default.equal(store.getRequest('1')?.status, 'retry');
});
(0, node_test_1.default)('VrfNode does not submit when getPublicKey returns null at startup', async () => {
    const stateDir = await (0, promises_1.mkdtemp)(path.join(os.tmpdir(), 'iota-node-null-pk-'));
    const store = new json_state_1.JsonStateStore(stateDir);
    await store.initialize();
    const nullPkProver = {
        async generateProof() {
            return { proofHex: 'ab'.repeat(80), outputHex: 'cd'.repeat(64) };
        },
        getPublicKey() {
            return null;
        },
    };
    const node = new node_1.VrfNode({
        pollIntervalMs: 1,
        maxRetryAttempts: 5,
        retryBaseDelayMs: 1000,
    }, store, new StaticIngestor({ events: [], nextCursor: null, hasNextPage: false }), nullPkProver, new MockCoordinatorReader(), {
        getOperatorAddress: () => '0xabc',
        submitFulfillment: async () => ({ txDigest: '0xdeadbeef' }),
    }, new runtime_monitor_1.InMemoryRuntimeMonitor(1000), noopLogger);
    await strict_1.default.rejects(() => node.initialize(), /VRF public key is required/);
});
(0, node_test_1.default)('VrfNode skips processing when circuit breaker opens mid-page', async () => {
    let currentTime = Date.parse('2026-03-17T00:00:00.000Z');
    const stateDir = await (0, promises_1.mkdtemp)(path.join(os.tmpdir(), 'iota-node-cb-skip-'));
    const store = new json_state_1.JsonStateStore(stateDir);
    await store.initialize();
    // Skip fresh events by pre-marking them fulfilled.
    for (const id of ['1', '2', '3']) {
        await store.markFulfilled(buildRequest(id), 1, `0x${id}-skip`);
    }
    // Due retries that will be processed; second retry opens breaker.
    await store.markRetry(buildRequest('4'), 1, 'prev', new Date().toISOString());
    await store.markRetry(buildRequest('5'), 1, 'prev', new Date().toISOString());
    const seenRetryIds = [];
    const node = new node_1.VrfNode({
        pollIntervalMs: 1,
        maxRetryAttempts: 5,
        retryBaseDelayMs: 1000,
        circuitBreakerFailureThreshold: 2,
        circuitBreakerCooldownMs: 10000,
        now: () => currentTime,
    }, store, new StaticIngestor({
        events: [buildRequest('1'), buildRequest('2'), buildRequest('3')],
        nextCursor: { txDigest: '0xfeed', eventSeq: '3' },
        hasNextPage: false,
    }), new MockProver(), new MockCoordinatorReader(), {
        async submitFulfillment(req) {
            seenRetryIds.push(req.requestId);
            throw Object.assign(new Error('transient rpc timeout'), { retryable: true });
        },
        getOperatorAddress: () => '0xabc',
    }, new runtime_monitor_1.InMemoryRuntimeMonitor(1000, () => currentTime), noopLogger);
    await node.runOnce();
    strict_1.default.deepEqual(seenRetryIds, ['4', '5']);
    strict_1.default.equal(store.getRequest('4')?.status, 'retry');
    strict_1.default.equal(store.getRequest('5')?.status, 'retry');
});
(0, node_test_1.default)('VrfNode processes multiple requests in a single poll cycle', async () => {
    const stateDir = await (0, promises_1.mkdtemp)(path.join(os.tmpdir(), 'iota-node-multi-'));
    const store = new json_state_1.JsonStateStore(stateDir);
    await store.initialize();
    // This test verifies single-run processing for 3 independent requests.
    const seenRequestIds = [];
    const node = new node_1.VrfNode({
        pollIntervalMs: 1,
        maxRetryAttempts: 5,
        retryBaseDelayMs: 1000,
    }, store, new SequenceIngestor([
        {
            events: [buildRequest('a'), buildRequest('b'), buildRequest('c')],
            nextCursor: { txDigest: '0xfeed', eventSeq: 'c' },
            hasNextPage: false,
        },
    ]), new MockProver(), new MockCoordinatorReader(), {
        async submitFulfillment(req) {
            seenRequestIds.push(req.requestId);
            return { txDigest: `0x${req.requestId}` };
        },
        getOperatorAddress: () => '0xabc',
    }, new runtime_monitor_1.InMemoryRuntimeMonitor(1000), noopLogger);
    await node.runOnce();
    strict_1.default.deepEqual(seenRequestIds, ['a', 'b', 'c']);
    strict_1.default.equal(store.getRequest('a')?.status, 'fulfilled');
    strict_1.default.equal(store.getRequest('b')?.status, 'fulfilled');
    strict_1.default.equal(store.getRequest('c')?.status, 'fulfilled');
});
(0, node_test_1.default)('VrfNode retries are ordered by updatedAt (FIFO)', async () => {
    const stateDir = await (0, promises_1.mkdtemp)(path.join(os.tmpdir(), 'iota-node-retry-order-'));
    const store = new json_state_1.JsonStateStore(stateDir);
    await store.initialize();
    // Skip fresh event '1'.
    await store.markFulfilled(buildRequest('1'), 1, '0xskip');
    const now = Date.now();
    await store.markRetry(buildRequest('first'), 1, 'prev', new Date(now - 10000).toISOString());
    await store.markRetry(buildRequest('second'), 1, 'prev', new Date(now - 5000).toISOString());
    await store.markRetry(buildRequest('third'), 1, 'prev', new Date(now - 1000).toISOString());
    const seenRetryIds = [];
    const node = new node_1.VrfNode({
        pollIntervalMs: 1,
        maxRetryAttempts: 5,
        retryBaseDelayMs: 1000,
    }, store, new StaticIngestor({ events: [buildRequest('1')], nextCursor: { txDigest: '0xfeed', eventSeq: '1' }, hasNextPage: false }), new MockProver(), new MockCoordinatorReader(), {
        async submitFulfillment(req) {
            seenRetryIds.push(req.requestId);
            throw new fulfill_1.SubmissionError('transient_failure', 'retry', true);
        },
        getOperatorAddress: () => '0xabc',
    }, new runtime_monitor_1.InMemoryRuntimeMonitor(1000), noopLogger);
    await node.runOnce();
    strict_1.default.deepEqual(seenRetryIds, ['first', 'second', 'third']);
});
(0, node_test_1.default)('VrfNode respects maxRetryAttempts cap and transitions to terminal', async () => {
    const stateDir = await (0, promises_1.mkdtemp)(path.join(os.tmpdir(), 'iota-node-max-retries-'));
    const store = new json_state_1.JsonStateStore(stateDir);
    await store.initialize();
    const MAX_ATTEMPTS = 3;
    // Skip fresh event '1'.
    await store.markFulfilled(buildRequest('1'), 1, '0xskip');
    await store.markRetry(buildRequest('1'), MAX_ATTEMPTS - 1, 'RPC timeout', new Date().toISOString());
    const node = new node_1.VrfNode({
        pollIntervalMs: 1,
        maxRetryAttempts: MAX_ATTEMPTS,
        retryBaseDelayMs: 1000,
    }, store, new StaticIngestor({ events: [buildRequest('1')], nextCursor: { txDigest: '0xfeed', eventSeq: '1' }, hasNextPage: false }), new MockProver(), new MockCoordinatorReader(), {
        async submitFulfillment() {
            throw new fulfill_1.SubmissionError('transient_failure', 'RPC timeout', true);
        },
        getOperatorAddress: () => '0xabc',
    }, new runtime_monitor_1.InMemoryRuntimeMonitor(1000), noopLogger);
    await node.runOnce();
    strict_1.default.equal(store.getRequest('1')?.status, 'terminal');
    strict_1.default.equal(store.getRequest('1')?.lastError, 'RPC timeout');
});
// ─── Circuit breaker tests ─────────────────────────────────────────────────────
(0, node_test_1.default)('VrfNode opens and recovers the RPC circuit breaker after consecutive RPC failures', async () => {
    let currentTime = Date.parse('2026-03-17T00:00:00.000Z');
    const stateDir = await (0, promises_1.mkdtemp)(path.join(os.tmpdir(), 'iota-node-circuit-breaker-'));
    const store = new json_state_1.JsonStateStore(stateDir);
    await store.initialize();
    const retryableRpcError = () => Object.assign(new Error('rpc timeout'), {
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
    const monitor = new runtime_monitor_1.InMemoryRuntimeMonitor(1000, () => currentTime);
    const node = new node_1.VrfNode({
        pollIntervalMs: 1,
        maxRetryAttempts: 5,
        retryBaseDelayMs: 1000,
        circuitBreakerFailureThreshold: 2,
        circuitBreakerCooldownMs: 5000,
        now: () => currentTime,
    }, store, ingestor, new MockProver(), new MockCoordinatorReader(), {
        getOperatorAddress: () => '0xabc',
        submitFulfillment: async () => ({ txDigest: '0xdeadbeef' }),
    }, monitor, noopLogger);
    await strict_1.default.rejects(() => node.runOnce(), /rpc timeout/);
    strict_1.default.equal(monitor.snapshot().circuitBreaker.state, 'closed');
    await strict_1.default.rejects(() => node.runOnce(), /rpc timeout/);
    strict_1.default.equal(monitor.snapshot().circuitBreaker.state, 'open');
    strict_1.default.equal(ingestor.calls, 2);
    await node.runOnce();
    strict_1.default.equal(ingestor.calls, 2);
    strict_1.default.equal(monitor.snapshot().circuitBreaker.state, 'open');
    currentTime += 5000;
    await node.runOnce();
    strict_1.default.equal(ingestor.calls, 3);
    strict_1.default.equal(monitor.snapshot().circuitBreaker.state, 'closed');
});
