"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const rpc_circuit_breaker_1 = require("./rpc-circuit-breaker");
(0, node_test_1.default)('RpcCircuitBreaker opens after consecutive failures and recovers after cooldown', () => {
    let currentTime = Date.parse('2026-03-17T00:00:00.000Z');
    const breaker = new rpc_circuit_breaker_1.RpcCircuitBreaker({
        failureThreshold: 2,
        cooldownMs: 5000,
        now: () => currentTime,
    });
    strict_1.default.equal(breaker.allowRequest(), true);
    breaker.recordFailure('rpc timeout');
    strict_1.default.deepEqual(breaker.snapshot(), {
        state: 'closed',
        consecutiveFailures: 1,
        openUntil: null,
        lastError: 'rpc timeout',
    });
    breaker.recordFailure('rpc timeout');
    strict_1.default.deepEqual(breaker.snapshot(), {
        state: 'open',
        consecutiveFailures: 2,
        openUntil: '2026-03-17T00:00:05.000Z',
        lastError: 'rpc timeout',
    });
    strict_1.default.equal(breaker.allowRequest(), false);
    currentTime += 5000;
    strict_1.default.equal(breaker.allowRequest(), true);
    strict_1.default.deepEqual(breaker.snapshot(), {
        state: 'half_open',
        consecutiveFailures: 2,
        openUntil: null,
        lastError: 'rpc timeout',
    });
    breaker.recordSuccess();
    strict_1.default.deepEqual(breaker.snapshot(), {
        state: 'closed',
        consecutiveFailures: 0,
        openUntil: null,
        lastError: null,
    });
});
(0, node_test_1.default)('RpcCircuitBreaker re-opens immediately when a half-open probe fails', () => {
    let currentTime = Date.parse('2026-03-17T00:00:00.000Z');
    const breaker = new rpc_circuit_breaker_1.RpcCircuitBreaker({
        failureThreshold: 3,
        cooldownMs: 10000,
        now: () => currentTime,
    });
    breaker.recordFailure('rpc timeout');
    breaker.recordFailure('rpc timeout');
    breaker.recordFailure('rpc timeout');
    currentTime += 10000;
    strict_1.default.equal(breaker.allowRequest(), true);
    breaker.recordFailure('rpc timeout again');
    strict_1.default.deepEqual(breaker.snapshot(), {
        state: 'open',
        consecutiveFailures: 3,
        openUntil: '2026-03-17T00:00:20.000Z',
        lastError: 'rpc timeout again',
    });
});
