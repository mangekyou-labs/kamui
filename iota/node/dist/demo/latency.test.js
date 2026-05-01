"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const latency_1 = require("./latency");
const measurements = [
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
        requestToFulfilledMs: 1200,
        requestToConsumedMs: 1450,
    },
    {
        iteration: 3,
        requestId: '3',
        requestTxDigest: '0x3',
        fulfillTxDigest: '0xe',
        consumeTxDigest: '0xf',
        requestToFulfilledMs: 2400,
        requestToConsumedMs: 2900,
    },
];
(0, node_test_1.default)('percentile interpolates across sorted samples', () => {
    strict_1.default.equal((0, latency_1.percentile)([100, 200, 300, 400], 0.5), 250);
    strict_1.default.equal((0, latency_1.percentile)([100, 200, 300, 400], 0.95), 385);
});
(0, node_test_1.default)('summarizeLatency computes p95 target status', () => {
    const summary = (0, latency_1.summarizeLatency)(measurements, 2000);
    strict_1.default.equal(summary.iterations, 3);
    strict_1.default.equal(summary.meetsTarget, false);
    strict_1.default.equal(summary.requestToFulfilledMs.minMs, 800);
    strict_1.default.equal(summary.requestToFulfilledMs.maxMs, 2400);
    strict_1.default.equal(summary.requestToFulfilledMs.p50Ms, 1200);
    strict_1.default.ok(summary.requestToFulfilledMs.p95Ms > 2000);
});
(0, node_test_1.default)('recommendTuning points to supported config levers', () => {
    const summary = (0, latency_1.summarizeLatency)(measurements, 2000);
    const recommendations = (0, latency_1.recommendTuning)(summary, {
        pollIntervalMs: 500,
        eventPageSize: 50,
        maxRetryAttempts: 3,
        retryBaseDelayMs: 2000,
    });
    strict_1.default.match(recommendations.join('\n'), /POLL_INTERVAL_MS/);
    strict_1.default.match(recommendations.join('\n'), /EVENT_PAGE_SIZE/);
    strict_1.default.match(recommendations.join('\n'), /MAX_RETRY_ATTEMPTS/);
    strict_1.default.match(recommendations.join('\n'), /RETRY_BASE_DELAY_MS/);
});
