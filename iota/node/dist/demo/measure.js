#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const json_state_1 = require("../store/json-state");
const common_1 = require("./common");
const latency_1 = require("./latency");
function readPositiveIntEnv(name, fallback) {
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
function parseBoolEnv(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === '') {
        return fallback;
    }
    const normalized = raw.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
}
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function waitForFulfillmentRecord(stateDir, requestId) {
    const { pollIntervalMs, timeoutMs } = (0, common_1.readDemoWaitSettings)();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
        const store = new json_state_1.JsonStateStore(stateDir);
        await store.initialize();
        const record = store.getRequest(requestId);
        if (record?.status === 'fulfilled') {
            return record.txDigest;
        }
        if (record?.status === 'terminal') {
            throw new Error(`Request ${requestId} became terminal while waiting for the fulfillment record: ${record.lastError ?? 'unknown error'}.`);
        }
        await delay(pollIntervalMs);
    }
    throw new Error(`Timed out waiting for request ${requestId} to appear as fulfilled in local node state.`);
}
async function clearFulfilledActiveRequest(activeState, context) {
    const requestState = await (0, common_1.waitForRequestState)(context, activeState.activeRequestId, 'fulfilled');
    if (requestState !== 'fulfilled') {
        throw new Error(`Demo consumer already has active request ${activeState.activeRequestId} in state ${requestState}; clear it before running latency measurement.`);
    }
    await (0, common_1.consumeDemoRequest)(context);
}
async function ensureIdleConsumer(context) {
    const state = await (0, common_1.viewDemoConsumerState)(context);
    if (!state.hasActiveRequest) {
        return;
    }
    await clearFulfilledActiveRequest(state, context);
}
function buildSeed(iteration) {
    if (process.env.DEMO_MEASURE_SEED_HEX && process.env.DEMO_MEASURE_SEED_HEX.trim() !== '') {
        return (0, common_1.resolveBytesFromEnv)('DEMO_MEASURE_SEED_HEX', 'DEMO_MEASURE_SEED_TEXT', 'kamui-latency');
    }
    return (0, common_1.resolveBytesFromEnv)('DEMO_MEASURE_SEED_HEX', 'DEMO_MEASURE_SEED_TEXT', `kamui-latency-${iteration}`);
}
function buildCallback(iteration) {
    if (process.env.DEMO_MEASURE_CALLBACK_HEX &&
        process.env.DEMO_MEASURE_CALLBACK_HEX.trim() !== '') {
        return (0, common_1.resolveBytesFromEnv)('DEMO_MEASURE_CALLBACK_HEX', 'DEMO_MEASURE_CALLBACK_TEXT', 'latency-run');
    }
    return (0, common_1.resolveBytesFromEnv)('DEMO_MEASURE_CALLBACK_HEX', 'DEMO_MEASURE_CALLBACK_TEXT', `latency-run-${iteration}`);
}
async function measureIteration(context, iteration) {
    const seed = buildSeed(iteration);
    const callback = buildCallback(iteration);
    const requestStartedAt = Date.now();
    const requested = await (0, common_1.submitDemoRequest)(context, {
        seedBytes: seed.bytes,
        callbackDataBytes: callback.bytes,
        numWords: (0, common_1.readDemoNumWords)(),
    });
    const requestId = requested.state.activeRequestId;
    const requestState = await (0, common_1.waitForRequestState)(context, requestId, 'fulfilled');
    if (requestState !== 'fulfilled') {
        throw new Error(`Request ${requestId} ended in state ${requestState} before fulfillment.`);
    }
    const fulfilledAt = Date.now();
    const fulfillTxDigest = await waitForFulfillmentRecord(context.config.stateDir, requestId);
    const consumed = await (0, common_1.consumeDemoRequest)(context);
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
async function main() {
    const context = await (0, common_1.loadDemoContext)({ requireDemoConsumer: true });
    const iterations = readPositiveIntEnv('DEMO_MEASURE_ITERATIONS', 5);
    const settleMs = readPositiveIntEnv('DEMO_MEASURE_SETTLE_MS', 250);
    const targetP95Ms = readPositiveIntEnv('DEMO_TARGET_P95_MS', 2000);
    const enforce = parseBoolEnv('DEMO_MEASURE_ENFORCE', false);
    await ensureIdleConsumer(context);
    const samples = [];
    for (let iteration = 1; iteration <= iterations; iteration += 1) {
        samples.push(await measureIteration(context, iteration));
        await delay(settleMs);
    }
    const summary = (0, latency_1.summarizeLatency)(samples, targetP95Ms);
    const tuning = (0, latency_1.recommendTuning)(summary, {
        pollIntervalMs: context.config.pollIntervalMs,
        eventPageSize: context.config.eventPageSize,
        maxRetryAttempts: context.config.maxRetryAttempts,
        retryBaseDelayMs: context.config.retryBaseDelayMs,
    });
    console.log(JSON.stringify({
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
    }, null, 2));
    if (enforce) {
        const p95 = summary.requestToFulfilledMs.p95Ms;
        if (!summary.meetsTarget) {
            console.error(`KPI FAIL: p95 ${p95.toFixed(1)}ms exceeds ${targetP95Ms}ms target.`);
            process.exit(1);
        }
        console.error(`KPI PASS: p95 ${p95.toFixed(1)}ms meets ${targetP95Ms}ms target.`);
    }
}
main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
