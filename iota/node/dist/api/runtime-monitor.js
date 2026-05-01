"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InMemoryRuntimeMonitor = void 0;
const metrics_1 = require("./metrics");
const REQUEST_DURATION_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10];
function toIso(timestampMs) {
    return timestampMs === null ? null : new Date(timestampMs).toISOString();
}
function toEpochSeconds(timestampMs) {
    return timestampMs === null ? 0 : timestampMs / 1000;
}
class InMemoryRuntimeMonitor {
    constructor(pollIntervalMs, now = () => Date.now()) {
        this.pollIntervalMs = pollIntervalMs;
        this.now = now;
        this.startedAtMs = null;
        this.initializedAtMs = null;
        this.lastPollStartedAtMs = null;
        this.lastSuccessfulPollAtMs = null;
        this.lastSuccessfulFulfillmentAtMs = null;
        this.lastPollError = null;
        this.inflightRequests = 0;
        this.dueRetries = 0;
        this.circuitBreaker = {
            state: 'closed',
            consecutiveFailures: 0,
            openUntil: null,
            lastError: null,
        };
        this.registry = new metrics_1.PrometheusRegistry();
        this.nodeUp = this.registry.gauge('kamui_iota_vrf_node_up', 'Whether the IOTA VRF node process is alive.');
        this.nodeReady = this.registry.gauge('kamui_iota_vrf_node_ready', 'Whether the IOTA VRF node is ready to process requests.');
        this.pollCyclesTotal = this.registry.counter('kamui_iota_vrf_poll_cycles_total', 'Total poll cycles by result.');
        this.eventsSeenTotal = this.registry.counter('kamui_iota_vrf_events_seen_total', 'Total request events seen during fresh event polling.');
        this.dueRetriesGauge = this.registry.gauge('kamui_iota_vrf_due_retries', 'Number of requests due for retry at the start of the latest poll cycle.');
        this.inflightRequestsGauge = this.registry.gauge('kamui_iota_vrf_inflight_requests', 'Number of requests currently being processed.');
        this.requestsTotal = this.registry.counter('kamui_iota_vrf_requests_total', 'Request processing outcomes.');
        this.requestErrorsTotal = this.registry.counter('kamui_iota_vrf_request_errors_total', 'Request processing errors by stage and retryability.');
        this.requestDuration = this.registry.histogram('kamui_iota_vrf_request_processing_duration_seconds', 'Request processing durations in seconds.', REQUEST_DURATION_BUCKETS);
        this.lastSuccessfulPollTimestamp = this.registry.gauge('kamui_iota_vrf_last_successful_poll_timestamp_seconds', 'Unix timestamp of the latest successful poll cycle.');
        this.lastSuccessfulFulfillmentTimestamp = this.registry.gauge('kamui_iota_vrf_last_successful_fulfillment_timestamp_seconds', 'Unix timestamp of the latest successful fulfillment.');
        this.rpcCircuitBreakerState = this.registry.gauge('kamui_iota_vrf_rpc_circuit_breaker_state', 'RPC circuit breaker state by label.');
        this.rpcCircuitBreakerConsecutiveFailures = this.registry.gauge('kamui_iota_vrf_rpc_circuit_breaker_consecutive_failures', 'Current consecutive retryable RPC failures tracked by the circuit breaker.');
        this.rpcCircuitBreakerOpenUntil = this.registry.gauge('kamui_iota_vrf_rpc_circuit_breaker_open_until_seconds', 'Unix timestamp until which the RPC circuit breaker remains open.');
        this.markProcessStarted();
    }
    markProcessStarted() {
        if (this.startedAtMs === null) {
            this.startedAtMs = this.now();
        }
        this.nodeUp.set({}, 1);
        this.inflightRequestsGauge.set({}, this.inflightRequests);
        this.dueRetriesGauge.set({}, this.dueRetries);
    }
    markInitialized() {
        if (this.initializedAtMs === null) {
            this.initializedAtMs = this.now();
        }
    }
    recordPollStart(dueRetries) {
        this.lastPollStartedAtMs = this.now();
        this.dueRetries = dueRetries;
        this.dueRetriesGauge.set({}, dueRetries);
    }
    recordPollSuccess(eventsSeen) {
        this.lastSuccessfulPollAtMs = this.now();
        this.lastPollError = null;
        this.pollCyclesTotal.inc({ result: 'success' });
        this.eventsSeenTotal.inc({}, eventsSeen);
        this.lastSuccessfulPollTimestamp.set({}, toEpochSeconds(this.lastSuccessfulPollAtMs));
    }
    recordPollFailure(error) {
        this.lastPollError = error;
        this.pollCyclesTotal.inc({ result: 'failure' });
    }
    recordRequestStart() {
        this.inflightRequests += 1;
        this.inflightRequestsGauge.set({}, this.inflightRequests);
    }
    recordRequestOutcome(outcome, latencyMs) {
        this.inflightRequests = Math.max(0, this.inflightRequests - 1);
        this.inflightRequestsGauge.set({}, this.inflightRequests);
        this.requestsTotal.inc({ outcome });
        if (latencyMs !== undefined) {
            this.requestDuration.observe({}, latencyMs / 1000);
        }
        if (outcome === 'fulfilled') {
            this.lastSuccessfulFulfillmentAtMs = this.now();
            this.lastSuccessfulFulfillmentTimestamp.set({}, toEpochSeconds(this.lastSuccessfulFulfillmentAtMs));
        }
    }
    recordRequestError(stage, retryable) {
        this.requestErrorsTotal.inc({
            stage,
            retryable: String(retryable),
        });
    }
    recordCircuitBreaker(snapshot) {
        this.circuitBreaker = { ...snapshot };
    }
    snapshot() {
        const currentTime = this.now();
        const ready = this.initializedAtMs !== null &&
            this.lastSuccessfulPollAtMs !== null &&
            currentTime - this.lastSuccessfulPollAtMs <= this.staleAfterMs &&
            this.circuitBreaker.state === 'closed';
        return {
            startedAt: toIso(this.startedAtMs ?? currentTime) ?? new Date(currentTime).toISOString(),
            initializedAt: toIso(this.initializedAtMs),
            lastPollStartedAt: toIso(this.lastPollStartedAtMs),
            lastSuccessfulPollAt: toIso(this.lastSuccessfulPollAtMs),
            lastPollError: this.lastPollError,
            inflightRequests: this.inflightRequests,
            circuitBreaker: { ...this.circuitBreaker },
            ready,
            staleAfterMs: this.staleAfterMs,
        };
    }
    renderPrometheus() {
        const snapshot = this.snapshot();
        this.nodeReady.set({}, snapshot.ready ? 1 : 0);
        this.lastSuccessfulPollTimestamp.set({}, toEpochSeconds(this.lastSuccessfulPollAtMs));
        this.lastSuccessfulFulfillmentTimestamp.set({}, toEpochSeconds(this.lastSuccessfulFulfillmentAtMs));
        this.inflightRequestsGauge.set({}, this.inflightRequests);
        this.dueRetriesGauge.set({}, this.dueRetries);
        for (const state of ['closed', 'open', 'half_open']) {
            this.rpcCircuitBreakerState.set({ state }, snapshot.circuitBreaker.state === state ? 1 : 0);
        }
        this.rpcCircuitBreakerConsecutiveFailures.set({}, snapshot.circuitBreaker.consecutiveFailures);
        this.rpcCircuitBreakerOpenUntil.set({}, toEpochSeconds(snapshot.circuitBreaker.openUntil === null
            ? null
            : Date.parse(snapshot.circuitBreaker.openUntil)));
        this.nodeUp.set({}, 1);
        return this.registry.render();
    }
    get staleAfterMs() {
        return Math.max(5000, this.pollIntervalMs * 3);
    }
}
exports.InMemoryRuntimeMonitor = InMemoryRuntimeMonitor;
