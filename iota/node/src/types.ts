export type ChainU64 = string;
export type ChainRequestState = 'missing' | 'pending' | 'fulfilled' | 'cancelled';
export type CircuitBreakerState = 'closed' | 'open' | 'half_open';
export type RequestOutcome =
  | 'fulfilled'
  | 'retry'
  | 'terminal'
  | 'skipped_fulfilled'
  | 'skipped_missing'
  | 'skipped_cancelled';
export type RequestErrorStage = 'read' | 'prove' | 'submit';

export interface EventCursor {
  txDigest: string;
  eventSeq: string;
}

export interface PendingRequest {
  requestId: ChainU64;
  subscriptionId: ChainU64;
  requester: string;
  seedHex: string;
  numWords: number;
  timestampMs: number;
  eventId: string;
  cursor: EventCursor;
  type: string;
}

export type RequestStatus = 'retry' | 'fulfilled' | 'terminal';

export interface RequestAttemptRecord {
  request: PendingRequest;
  status: RequestStatus;
  attempts: number;
  updatedAt: string;
  nextRetryAt: string | null;
  lastError: string | null;
  txDigest: string | null;
}

export interface ProofResult {
  proofHex: string;
  outputHex: string;
}

export interface Logger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export interface RpcCircuitBreakerSnapshot {
  state: CircuitBreakerState;
  consecutiveFailures: number;
  openUntil: string | null;
  lastError: string | null;
}

export interface OpsSnapshot {
  startedAt: string;
  initializedAt: string | null;
  lastPollStartedAt: string | null;
  lastSuccessfulPollAt: string | null;
  lastPollError: string | null;
  inflightRequests: number;
  circuitBreaker: RpcCircuitBreakerSnapshot;
  ready: boolean;
  staleAfterMs: number;
}

export interface RuntimeMonitor {
  markProcessStarted(): void;
  markInitialized(): void;
  recordPollStart(dueRetries: number): void;
  recordPollSuccess(eventsSeen: number): void;
  recordPollFailure(error: string): void;
  recordRequestStart(): void;
  recordRequestOutcome(outcome: RequestOutcome, latencyMs?: number): void;
  recordRequestError(stage: RequestErrorStage, retryable: boolean): void;
  recordCircuitBreaker(snapshot: RpcCircuitBreakerSnapshot): void;
  snapshot(): OpsSnapshot;
  renderPrometheus(): string;
}

export interface Prover {
  generateProof(seedHex: string): Promise<ProofResult>;
  getPublicKey(): string | null;
}

export interface CoordinatorReader {
  getActiveVrfPublicKey(): Promise<string>;
  getRequestStatus(requestId: ChainU64): Promise<ChainRequestState>;
}

export interface EventPage {
  events: PendingRequest[];
  nextCursor: EventCursor | null;
  hasNextPage: boolean;
}

export interface EventIngestor {
  fetchPage(cursor: EventCursor | null): Promise<EventPage>;
}

export interface FulfillmentSubmitter {
  getOperatorAddress(): string;
  submitFulfillment(
    request: PendingRequest,
    proofHex: string,
    outputHex: string,
  ): Promise<{ txDigest: string }>;
}
