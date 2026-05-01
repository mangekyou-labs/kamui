export interface LatencyMeasurement {
  iteration: number;
  requestId: string;
  requestTxDigest: string;
  fulfillTxDigest: string | null;
  consumeTxDigest: string;
  requestToFulfilledMs: number;
  requestToConsumedMs: number;
}

export interface LatencyDistribution {
  minMs: number;
  maxMs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

export interface LatencySummary {
  iterations: number;
  targetP95Ms: number;
  meetsTarget: boolean;
  requestToFulfilledMs: LatencyDistribution;
  requestToConsumedMs: LatencyDistribution;
}

export interface TuningInputs {
  pollIntervalMs: number;
  eventPageSize: number;
  maxRetryAttempts: number;
  retryBaseDelayMs: number;
}

function assertNonEmpty(values: number[]): number[] {
  if (values.length === 0) {
    throw new Error('Cannot summarize an empty latency sample set.');
  }
  return [...values].sort((left, right) => left - right);
}

export function percentile(values: number[], quantile: number): number {
  const sorted = assertNonEmpty(values);
  if (quantile <= 0) {
    return sorted[0];
  }
  if (quantile >= 1) {
    return sorted[sorted.length - 1];
  }

  const position = (sorted.length - 1) * quantile;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  if (lowerIndex === upperIndex) {
    return sorted[lowerIndex];
  }

  const weight = position - lowerIndex;
  return sorted[lowerIndex] * (1 - weight) + sorted[upperIndex] * weight;
}

export function summarizeDistribution(values: number[]): LatencyDistribution {
  const sorted = assertNonEmpty(values);
  const total = sorted.reduce((sum, value) => sum + value, 0);

  return {
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    avgMs: total / sorted.length,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
  };
}

export function summarizeLatency(
  measurements: LatencyMeasurement[],
  targetP95Ms: number,
): LatencySummary {
  if (measurements.length === 0) {
    throw new Error('At least one latency measurement is required.');
  }

  const fulfilled = measurements.map((item) => item.requestToFulfilledMs);
  const consumed = measurements.map((item) => item.requestToConsumedMs);
  const fulfilledSummary = summarizeDistribution(fulfilled);

  return {
    iterations: measurements.length,
    targetP95Ms,
    meetsTarget: fulfilledSummary.p95Ms <= targetP95Ms,
    requestToFulfilledMs: fulfilledSummary,
    requestToConsumedMs: summarizeDistribution(consumed),
  };
}

export function recommendTuning(
  summary: LatencySummary,
  inputs: TuningInputs,
): string[] {
  const recommendations: string[] = [];

  if (summary.meetsTarget) {
    recommendations.push(
      `Current p95 (${summary.requestToFulfilledMs.p95Ms.toFixed(1)}ms) meets the ${summary.targetP95Ms}ms target.`,
    );
  } else {
    recommendations.push(
      `Current p95 (${summary.requestToFulfilledMs.p95Ms.toFixed(1)}ms) exceeds the ${summary.targetP95Ms}ms target.`,
    );
  }

  if (!summary.meetsTarget && inputs.pollIntervalMs > 250) {
    recommendations.push(
      `Lower POLL_INTERVAL_MS from ${inputs.pollIntervalMs}ms toward 100-250ms to reduce request detection lag.`,
    );
  }

  if (!summary.meetsTarget && inputs.eventPageSize < 100) {
    recommendations.push(
      `Increase EVENT_PAGE_SIZE above ${inputs.eventPageSize} to reduce pagination overhead under burst traffic.`,
    );
  }

  if (!summary.meetsTarget && inputs.maxRetryAttempts < 5) {
    recommendations.push(
      `Raise MAX_RETRY_ATTEMPTS above ${inputs.maxRetryAttempts} if transient RPC failures are cutting requests short.`,
    );
  }

  if (!summary.meetsTarget && inputs.retryBaseDelayMs > 1_000) {
    recommendations.push(
      `Reduce RETRY_BASE_DELAY_MS below ${inputs.retryBaseDelayMs}ms if retries are dominating tail latency.`,
    );
  }

  if (
    summary.requestToConsumedMs.p95Ms - summary.requestToFulfilledMs.p95Ms >
    250
  ) {
    recommendations.push(
      'The consumer step adds noticeable delay after fulfillment; keep KPI tracking focused on request-to-fulfilled latency.',
    );
  }

  recommendations.push(
    'Inspect /metrics for kamui_iota_vrf_request_processing_duration_seconds and kamui_iota_vrf_request_errors_total while running the benchmark.',
  );

  return recommendations;
}
