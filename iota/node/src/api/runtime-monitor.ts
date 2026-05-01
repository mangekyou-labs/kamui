import { PrometheusRegistry } from './metrics';
import type {
  OpsSnapshot,
  RequestErrorStage,
  RequestOutcome,
  RpcCircuitBreakerSnapshot,
  RuntimeMonitor,
} from '../types';

const REQUEST_DURATION_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10];

function toIso(timestampMs: number | null): string | null {
  return timestampMs === null ? null : new Date(timestampMs).toISOString();
}

function toEpochSeconds(timestampMs: number | null): number {
  return timestampMs === null ? 0 : timestampMs / 1000;
}

export class InMemoryRuntimeMonitor implements RuntimeMonitor {
  private startedAtMs: number | null = null;
  private initializedAtMs: number | null = null;
  private lastPollStartedAtMs: number | null = null;
  private lastSuccessfulPollAtMs: number | null = null;
  private lastSuccessfulFulfillmentAtMs: number | null = null;
  private lastPollError: string | null = null;
  private inflightRequests = 0;
  private dueRetries = 0;
  private circuitBreaker: RpcCircuitBreakerSnapshot = {
    state: 'closed',
    consecutiveFailures: 0,
    openUntil: null,
    lastError: null,
  };

  private readonly registry = new PrometheusRegistry();
  private readonly nodeUp = this.registry.gauge(
    'kamui_iota_vrf_node_up',
    'Whether the IOTA VRF node process is alive.',
  );
  private readonly nodeReady = this.registry.gauge(
    'kamui_iota_vrf_node_ready',
    'Whether the IOTA VRF node is ready to process requests.',
  );
  private readonly pollCyclesTotal = this.registry.counter(
    'kamui_iota_vrf_poll_cycles_total',
    'Total poll cycles by result.',
  );
  private readonly eventsSeenTotal = this.registry.counter(
    'kamui_iota_vrf_events_seen_total',
    'Total request events seen during fresh event polling.',
  );
  private readonly dueRetriesGauge = this.registry.gauge(
    'kamui_iota_vrf_due_retries',
    'Number of requests due for retry at the start of the latest poll cycle.',
  );
  private readonly inflightRequestsGauge = this.registry.gauge(
    'kamui_iota_vrf_inflight_requests',
    'Number of requests currently being processed.',
  );
  private readonly requestsTotal = this.registry.counter(
    'kamui_iota_vrf_requests_total',
    'Request processing outcomes.',
  );
  private readonly requestErrorsTotal = this.registry.counter(
    'kamui_iota_vrf_request_errors_total',
    'Request processing errors by stage and retryability.',
  );
  private readonly requestDuration = this.registry.histogram(
    'kamui_iota_vrf_request_processing_duration_seconds',
    'Request processing durations in seconds.',
    REQUEST_DURATION_BUCKETS,
  );
  private readonly lastSuccessfulPollTimestamp = this.registry.gauge(
    'kamui_iota_vrf_last_successful_poll_timestamp_seconds',
    'Unix timestamp of the latest successful poll cycle.',
  );
  private readonly lastSuccessfulFulfillmentTimestamp = this.registry.gauge(
    'kamui_iota_vrf_last_successful_fulfillment_timestamp_seconds',
    'Unix timestamp of the latest successful fulfillment.',
  );
  private readonly rpcCircuitBreakerState = this.registry.gauge(
    'kamui_iota_vrf_rpc_circuit_breaker_state',
    'RPC circuit breaker state by label.',
  );
  private readonly rpcCircuitBreakerConsecutiveFailures = this.registry.gauge(
    'kamui_iota_vrf_rpc_circuit_breaker_consecutive_failures',
    'Current consecutive retryable RPC failures tracked by the circuit breaker.',
  );
  private readonly rpcCircuitBreakerOpenUntil = this.registry.gauge(
    'kamui_iota_vrf_rpc_circuit_breaker_open_until_seconds',
    'Unix timestamp until which the RPC circuit breaker remains open.',
  );

  constructor(
    private readonly pollIntervalMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.markProcessStarted();
  }

  markProcessStarted(): void {
    if (this.startedAtMs === null) {
      this.startedAtMs = this.now();
    }
    this.nodeUp.set({}, 1);
    this.inflightRequestsGauge.set({}, this.inflightRequests);
    this.dueRetriesGauge.set({}, this.dueRetries);
  }

  markInitialized(): void {
    if (this.initializedAtMs === null) {
      this.initializedAtMs = this.now();
    }
  }

  recordPollStart(dueRetries: number): void {
    this.lastPollStartedAtMs = this.now();
    this.dueRetries = dueRetries;
    this.dueRetriesGauge.set({}, dueRetries);
  }

  recordPollSuccess(eventsSeen: number): void {
    this.lastSuccessfulPollAtMs = this.now();
    this.lastPollError = null;
    this.pollCyclesTotal.inc({ result: 'success' });
    this.eventsSeenTotal.inc({}, eventsSeen);
    this.lastSuccessfulPollTimestamp.set({}, toEpochSeconds(this.lastSuccessfulPollAtMs));
  }

  recordPollFailure(error: string): void {
    this.lastPollError = error;
    this.pollCyclesTotal.inc({ result: 'failure' });
  }

  recordRequestStart(): void {
    this.inflightRequests += 1;
    this.inflightRequestsGauge.set({}, this.inflightRequests);
  }

  recordRequestOutcome(outcome: RequestOutcome, latencyMs?: number): void {
    this.inflightRequests = Math.max(0, this.inflightRequests - 1);
    this.inflightRequestsGauge.set({}, this.inflightRequests);
    this.requestsTotal.inc({ outcome });

    if (latencyMs !== undefined) {
      this.requestDuration.observe({}, latencyMs / 1000);
    }

    if (outcome === 'fulfilled') {
      this.lastSuccessfulFulfillmentAtMs = this.now();
      this.lastSuccessfulFulfillmentTimestamp.set(
        {},
        toEpochSeconds(this.lastSuccessfulFulfillmentAtMs),
      );
    }
  }

  recordRequestError(stage: RequestErrorStage, retryable: boolean): void {
    this.requestErrorsTotal.inc({
      stage,
      retryable: String(retryable),
    });
  }

  recordCircuitBreaker(snapshot: RpcCircuitBreakerSnapshot): void {
    this.circuitBreaker = { ...snapshot };
  }

  snapshot(): OpsSnapshot {
    const currentTime = this.now();
    const ready =
      this.initializedAtMs !== null &&
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

  renderPrometheus(): string {
    const snapshot = this.snapshot();
    this.nodeReady.set({}, snapshot.ready ? 1 : 0);
    this.lastSuccessfulPollTimestamp.set({}, toEpochSeconds(this.lastSuccessfulPollAtMs));
    this.lastSuccessfulFulfillmentTimestamp.set(
      {},
      toEpochSeconds(this.lastSuccessfulFulfillmentAtMs),
    );
    this.inflightRequestsGauge.set({}, this.inflightRequests);
    this.dueRetriesGauge.set({}, this.dueRetries);
    for (const state of ['closed', 'open', 'half_open'] as const) {
      this.rpcCircuitBreakerState.set(
        { state },
        snapshot.circuitBreaker.state === state ? 1 : 0,
      );
    }
    this.rpcCircuitBreakerConsecutiveFailures.set(
      {},
      snapshot.circuitBreaker.consecutiveFailures,
    );
    this.rpcCircuitBreakerOpenUntil.set(
      {},
      toEpochSeconds(
        snapshot.circuitBreaker.openUntil === null
          ? null
          : Date.parse(snapshot.circuitBreaker.openUntil),
      ),
    );
    this.nodeUp.set({}, 1);
    return this.registry.render();
  }

  private get staleAfterMs(): number {
    return Math.max(5000, this.pollIntervalMs * 3);
  }
}
