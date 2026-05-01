"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const runtime_monitor_1 = require("./runtime-monitor");
(0, node_test_1.default)('InMemoryRuntimeMonitor readiness follows init and poll success state', () => {
    let currentTime = Date.parse('2026-03-17T00:00:00.000Z');
    const monitor = new runtime_monitor_1.InMemoryRuntimeMonitor(1000, () => currentTime);
    strict_1.default.equal(monitor.snapshot().ready, false);
    monitor.markInitialized();
    strict_1.default.equal(monitor.snapshot().ready, false);
    monitor.recordPollStart(2);
    currentTime += 250;
    monitor.recordPollSuccess(3);
    let snapshot = monitor.snapshot();
    strict_1.default.equal(snapshot.ready, true);
    strict_1.default.equal(snapshot.inflightRequests, 0);
    strict_1.default.equal(snapshot.staleAfterMs, 5000);
    strict_1.default.equal(snapshot.lastPollError, null);
    strict_1.default.equal(snapshot.circuitBreaker.state, 'closed');
    monitor.recordCircuitBreaker({
        state: 'open',
        consecutiveFailures: 3,
        openUntil: '2026-03-17T00:00:05.250Z',
        lastError: 'rpc timeout',
    });
    snapshot = monitor.snapshot();
    strict_1.default.equal(snapshot.ready, false);
    strict_1.default.equal(snapshot.circuitBreaker.state, 'open');
    currentTime += 5001;
    snapshot = monitor.snapshot();
    strict_1.default.equal(snapshot.ready, false);
});
(0, node_test_1.default)('InMemoryRuntimeMonitor records request metrics and poll gauges', () => {
    let currentTime = Date.parse('2026-03-17T00:00:00.000Z');
    const monitor = new runtime_monitor_1.InMemoryRuntimeMonitor(500, () => currentTime);
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
    strict_1.default.match(output, /kamui_iota_vrf_due_retries 4/);
    strict_1.default.match(output, /kamui_iota_vrf_events_seen_total 5/);
    strict_1.default.match(output, /kamui_iota_vrf_inflight_requests 0/);
    strict_1.default.match(output, /kamui_iota_vrf_request_errors_total\{retryable="true",stage="prove"\} 1/);
    strict_1.default.match(output, /kamui_iota_vrf_requests_total\{outcome="retry"\} 1/);
    strict_1.default.match(output, /kamui_iota_vrf_request_processing_duration_seconds_count 1/);
    strict_1.default.match(output, /kamui_iota_vrf_node_ready 0/);
    strict_1.default.match(output, /kamui_iota_vrf_rpc_circuit_breaker_state\{state="open"\} 1/);
    strict_1.default.match(output, /kamui_iota_vrf_rpc_circuit_breaker_state\{state="closed"\} 0/);
    strict_1.default.match(output, /kamui_iota_vrf_rpc_circuit_breaker_consecutive_failures 2/);
});
