"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const latency_1 = require("./latency");
// ─── percentile ─────────────────────────────────────────────────────────────
(0, node_test_1.default)('percentile returns the single element for single-element arrays', () => {
    strict_1.default.equal((0, latency_1.percentile)([42], 0.0), 42);
    strict_1.default.equal((0, latency_1.percentile)([42], 0.5), 42);
    strict_1.default.equal((0, latency_1.percentile)([42], 1.0), 42);
});
(0, node_test_1.default)('percentile clamps quantile <= 0 to the minimum element', () => {
    strict_1.default.equal((0, latency_1.percentile)([100, 200, 300], -0.5), 100);
    strict_1.default.equal((0, latency_1.percentile)([100, 200, 300], 0), 100);
});
(0, node_test_1.default)('percentile clamps quantile >= 1 to the maximum element', () => {
    strict_1.default.equal((0, latency_1.percentile)([100, 200, 300], 1), 300);
    strict_1.default.equal((0, latency_1.percentile)([100, 200, 300], 1.5), 300);
});
(0, node_test_1.default)('percentile throws on empty arrays', () => {
    strict_1.default.throws(() => (0, latency_1.percentile)([], 0.5), /empty/);
});
(0, node_test_1.default)('percentile interpolates linearly at midpoints', () => {
    // [100,200,300,400], n=4, position=(4-1)*0.5=1.5 → lowerIdx=1, upperIdx=2, weight=0.5
    // → 200*(1-0.5) + 300*0.5 = 100+150 = 250
    strict_1.default.equal((0, latency_1.percentile)([100, 200, 300, 400], 0.5), 250);
    // p99 of [1..100]: position=99*0.99=98.01 → lowerIdx=98, upperIdx=99, weight=0.01
    // → 99*(1-0.01) + 100*0.01 = 98.01+1 = 99.01
    strict_1.default.equal((0, latency_1.percentile)(Array.from({ length: 100 }, (_, i) => i + 1), 0.99), 99.01);
});
(0, node_test_1.default)('percentile is monotonic for a sorted set of quantile values', () => {
    const samples = [10, 20, 30, 40, 50];
    const results = [];
    for (let q = 0; q <= 1; q += 0.1) {
        results.push((0, latency_1.percentile)(samples, q));
    }
    for (let i = 1; i < results.length; i++) {
        strict_1.default.ok(results[i] >= results[i - 1], `Monotonicity violated at ${i}: ${results[i - 1]} -> ${results[i]}`);
    }
});
// ─── summarizeDistribution ───────────────────────────────────────────────────
(0, node_test_1.default)('summarizeDistribution throws on empty arrays', () => {
    strict_1.default.throws(() => (0, latency_1.summarizeDistribution)([]), /empty/);
});
(0, node_test_1.default)('summarizeDistribution computes correct avg for single value', () => {
    const result = (0, latency_1.summarizeDistribution)([314]);
    strict_1.default.equal(result.minMs, 314);
    strict_1.default.equal(result.maxMs, 314);
    strict_1.default.equal(result.avgMs, 314);
    strict_1.default.equal(result.p50Ms, 314);
    strict_1.default.equal(result.p95Ms, 314);
    strict_1.default.equal(result.p99Ms, 314);
});
(0, node_test_1.default)('summarizeDistribution computes correct min, max, avg', () => {
    const result = (0, latency_1.summarizeDistribution)([500, 1000, 1500, 2000]);
    strict_1.default.equal(result.minMs, 500);
    strict_1.default.equal(result.maxMs, 2000);
    strict_1.default.equal(result.avgMs, 1250);
});
(0, node_test_1.default)('summarizeDistribution does not mutate the input array', () => {
    const input = [100, 200, 300];
    (0, latency_1.summarizeDistribution)(input);
    strict_1.default.deepEqual(input, [100, 200, 300]);
});
// ─── summarizeLatency ───────────────────────────────────────────────────────
(0, node_test_1.default)('summarizeLatency throws on empty measurements', () => {
    strict_1.default.throws(() => (0, latency_1.summarizeLatency)([], 2000), /At least one latency/);
});
(0, node_test_1.default)('summarizeLatency records the targetP95Ms in the summary', () => {
    const measurement = {
        iteration: 1,
        requestId: '1',
        requestTxDigest: '0x1',
        fulfillTxDigest: '0xa',
        consumeTxDigest: '0xb',
        requestToFulfilledMs: 500,
        requestToConsumedMs: 600,
    };
    const result = (0, latency_1.summarizeLatency)([measurement], 2000);
    strict_1.default.equal(result.targetP95Ms, 2000);
});
(0, node_test_1.default)('summarizeLatency returns true meetsTarget when p95 is exactly at the target', () => {
    // Use enough identical samples so p95 equals exactly that value
    const measurements = Array.from({ length: 20 }, (_, i) => ({
        iteration: i + 1,
        requestId: String(i + 1),
        requestTxDigest: `0x${i}`,
        fulfillTxDigest: `0x${i}a`,
        consumeTxDigest: `0x${i}b`,
        requestToFulfilledMs: 2000,
        requestToConsumedMs: 2100,
    }));
    const result = (0, latency_1.summarizeLatency)(measurements, 2000);
    strict_1.default.equal(result.meetsTarget, true);
});
(0, node_test_1.default)('summarizeLatency returns false meetsTarget when p95 exceeds the target', () => {
    const measurements = Array.from({ length: 20 }, (_, i) => ({
        iteration: i + 1,
        requestId: String(i + 1),
        requestTxDigest: `0x${i}`,
        fulfillTxDigest: `0x${i}a`,
        consumeTxDigest: `0x${i}b`,
        requestToFulfilledMs: 2001,
        requestToConsumedMs: 2100,
    }));
    const result = (0, latency_1.summarizeLatency)(measurements, 2000);
    strict_1.default.equal(result.meetsTarget, false);
});
(0, node_test_1.default)('summarizeLatency records correct iterations count', () => {
    const measurements = Array.from({ length: 7 }, (_, i) => ({
        iteration: i + 1,
        requestId: String(i + 1),
        requestTxDigest: `0x${i}`,
        fulfillTxDigest: null,
        consumeTxDigest: `0x${i}b`,
        requestToFulfilledMs: 800,
        requestToConsumedMs: 900,
    }));
    const result = (0, latency_1.summarizeLatency)(measurements, 2000);
    strict_1.default.equal(result.iterations, 7);
});
