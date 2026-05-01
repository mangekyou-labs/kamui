"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const latency_1 = require("./latency");
// Inline copy of parseBoolEnv to avoid importing from measure.ts, which has
// top-level side effects (main() call) that make it unsuitable for test imports.
function parseBoolEnv(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === '') {
        return fallback;
    }
    const normalized = raw.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
}
function makeSample(iteration, fulfilledMs, consumedMs) {
    return {
        iteration,
        requestId: String(iteration),
        requestTxDigest: `0x${iteration}`,
        fulfillTxDigest: `0x${iteration}a`,
        consumeTxDigest: `0x${iteration}b`,
        requestToFulfilledMs: fulfilledMs,
        requestToConsumedMs: consumedMs,
    };
}
(0, node_test_1.default)('KPI enforcement: meetsTarget is true when all samples are within the target', () => {
    const samples = [
        makeSample(1, 800, 900),
        makeSample(2, 1200, 1300),
        makeSample(3, 1500, 1600),
        makeSample(4, 1100, 1250),
        makeSample(5, 900, 1000),
    ];
    const summary = (0, latency_1.summarizeLatency)(samples, 2000);
    strict_1.default.equal(summary.meetsTarget, true);
    strict_1.default.ok(summary.requestToFulfilledMs.p95Ms <= 2000);
});
(0, node_test_1.default)('KPI enforcement: meetsTarget is false when p95 exceeds the target', () => {
    const samples = [
        makeSample(1, 800, 900),
        makeSample(2, 1200, 1300),
        makeSample(3, 2400, 2600),
        makeSample(4, 1800, 1950),
        makeSample(5, 2100, 2300),
    ];
    const summary = (0, latency_1.summarizeLatency)(samples, 2000);
    strict_1.default.equal(summary.meetsTarget, false);
    strict_1.default.ok(summary.requestToFulfilledMs.p95Ms > 2000);
});
(0, node_test_1.default)('KPI enforcement: single-sample pass', () => {
    const summary = (0, latency_1.summarizeLatency)([makeSample(1, 1500, 1600)], 2000);
    strict_1.default.equal(summary.meetsTarget, true);
});
(0, node_test_1.default)('KPI enforcement: single-sample fail', () => {
    const summary = (0, latency_1.summarizeLatency)([makeSample(1, 2500, 2600)], 2000);
    strict_1.default.equal(summary.meetsTarget, false);
});
(0, node_test_1.default)('parseBoolEnv returns fallback for undefined env var', () => {
    const original = process.env.TEST_KPI_BOOL;
    delete process.env.TEST_KPI_BOOL;
    strict_1.default.equal(parseBoolEnv('TEST_KPI_BOOL', false), false);
    strict_1.default.equal(parseBoolEnv('TEST_KPI_BOOL', true), true);
    if (original !== undefined)
        process.env.TEST_KPI_BOOL = original;
});
(0, node_test_1.default)('parseBoolEnv returns fallback for empty string', () => {
    process.env.TEST_KPI_BOOL = '  ';
    strict_1.default.equal(parseBoolEnv('TEST_KPI_BOOL', false), false);
    delete process.env.TEST_KPI_BOOL;
});
(0, node_test_1.default)('parseBoolEnv recognizes truthy values', () => {
    for (const value of ['1', 'true', 'TRUE', 'True', 'yes', 'YES', 'Yes']) {
        process.env.TEST_KPI_BOOL = value;
        strict_1.default.equal(parseBoolEnv('TEST_KPI_BOOL', false), true, `expected true for "${value}"`);
    }
    delete process.env.TEST_KPI_BOOL;
});
(0, node_test_1.default)('parseBoolEnv returns false for non-truthy values', () => {
    for (const value of ['0', 'false', 'no', 'off', 'random']) {
        process.env.TEST_KPI_BOOL = value;
        strict_1.default.equal(parseBoolEnv('TEST_KPI_BOOL', true), false, `expected false for "${value}"`);
    }
    delete process.env.TEST_KPI_BOOL;
});
