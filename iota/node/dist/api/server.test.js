"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_http_1 = require("node:http");
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const server_1 = require("./server");
const runtime_monitor_1 = require("./runtime-monitor");
const noopLogger = {
    info() { },
    warn() { },
    error() { },
};
async function performRequest(port, path, method = 'GET') {
    return new Promise((resolve, reject) => {
        const req = (0, node_http_1.request)({
            host: '127.0.0.1',
            port,
            path,
            method,
        }, (res) => {
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
        });
        req.on('error', reject);
        req.end();
    });
}
(0, node_test_1.default)('OpsServer serves health, readiness, and metrics endpoints', async (t) => {
    let currentTime = Date.parse('2026-03-17T00:00:00.000Z');
    const monitor = new runtime_monitor_1.InMemoryRuntimeMonitor(1000, () => currentTime);
    const server = new server_1.OpsServer({
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
    strict_1.default.equal(health.statusCode, 200);
    strict_1.default.equal(health.headers['content-type'], 'application/json');
    strict_1.default.deepEqual(JSON.parse(health.body), {
        status: 'ok',
        startedAt: '2026-03-17T00:00:00.000Z',
        uptimeSec: 0,
    });
    let ready = await performRequest(address.port, '/readyz');
    strict_1.default.equal(ready.statusCode, 503);
    strict_1.default.deepEqual(JSON.parse(ready.body), {
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
    strict_1.default.equal(ready.statusCode, 200);
    strict_1.default.deepEqual(JSON.parse(ready.body), {
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
    strict_1.default.equal(metrics.statusCode, 200);
    strict_1.default.equal(metrics.headers['content-type'], 'text/plain; version=0.0.4');
    strict_1.default.match(metrics.body, /kamui_iota_vrf_node_up 1/);
    strict_1.default.match(metrics.body, /kamui_iota_vrf_node_ready 1/);
    monitor.recordCircuitBreaker({
        state: 'open',
        consecutiveFailures: 3,
        openUntil: '2026-03-17T00:00:05.250Z',
        lastError: 'rpc timeout',
    });
    ready = await performRequest(address.port, '/readyz');
    strict_1.default.equal(ready.statusCode, 503);
    strict_1.default.deepEqual(JSON.parse(ready.body), {
        status: 'not_ready',
        initialized: true,
        lastSuccessfulPollAt: '2026-03-17T00:00:00.250Z',
        lastPollError: null,
        circuitBreakerState: 'open',
        circuitBreakerOpenUntil: '2026-03-17T00:00:05.250Z',
        circuitBreakerLastError: 'rpc timeout',
        staleAfterMs: 5000,
    });
    currentTime += 5001;
    ready = await performRequest(address.port, '/readyz');
    strict_1.default.equal(ready.statusCode, 503);
});
(0, node_test_1.default)('OpsServer rejects non-GET methods and unknown routes', async (t) => {
    const monitor = new runtime_monitor_1.InMemoryRuntimeMonitor(1000);
    const server = new server_1.OpsServer({
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
    strict_1.default.equal(notFound.statusCode, 404);
    const methodNotAllowed = await performRequest(address.port, '/healthz', 'POST');
    strict_1.default.equal(methodNotAllowed.statusCode, 405);
    strict_1.default.equal(methodNotAllowed.headers.allow, 'GET');
});
