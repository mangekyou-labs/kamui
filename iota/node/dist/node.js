"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VrfNode = void 0;
exports.computeRetryDelayMs = computeRetryDelayMs;
exports.createLogger = createLogger;
const rpc_circuit_breaker_1 = require("./rpc-circuit-breaker");
function log(level, message, fields) {
    if (fields && Object.keys(fields).length > 0) {
        console.log(`[${new Date().toISOString()}] ${level} ${message} ${JSON.stringify(fields)}`);
        return;
    }
    console.log(`[${new Date().toISOString()}] ${level} ${message}`);
}
function redactHex(value) {
    if (!value || value.length < 8) {
        return value;
    }
    return `${value.slice(0, 8)}...${value.slice(-8)}`;
}
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function normalizeError(error) {
    if (typeof error === 'object' && error !== null && 'retryable' in error) {
        return {
            message: error instanceof Error ? error.message : String(error),
            retryable: Boolean(error.retryable),
        };
    }
    return {
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
    };
}
function isRetryableError(error) {
    return normalizeError(error).retryable;
}
const DEFAULT_RETRY_MAX_DELAY_MS = 30000;
const DEFAULT_CIRCUIT_BREAKER_FAILURE_THRESHOLD = 3;
const DEFAULT_CIRCUIT_BREAKER_COOLDOWN_MS = 30000;
function computeRetryDelayMs(previousAttempts, baseDelayMs, maxDelayMs, random = Math.random) {
    const cappedDelayMs = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, previousAttempts));
    const minDelayMs = Math.max(1, Math.floor(cappedDelayMs / 2));
    const jitterSpanMs = Math.max(1, cappedDelayMs - minDelayMs);
    return minDelayMs + Math.floor(random() * (jitterSpanMs + 1));
}
function nextRetrySchedule(previousAttempts, baseDelayMs, maxDelayMs, now, random) {
    const delayMs = computeRetryDelayMs(previousAttempts, baseDelayMs, maxDelayMs, random);
    return {
        delayMs,
        scheduledFor: new Date(now() + delayMs).toISOString(),
    };
}
function createLogger() {
    return {
        info(message, fields) {
            log('INFO', message, fields);
        },
        warn(message, fields) {
            log('WARN', message, fields);
        },
        error(message, fields) {
            log('ERROR', message, fields);
        },
    };
}
class VrfNode {
    constructor(options, store, ingestor, prover, coordinatorReader, submitter, monitor, logger) {
        this.options = options;
        this.store = store;
        this.ingestor = ingestor;
        this.prover = prover;
        this.coordinatorReader = coordinatorReader;
        this.submitter = submitter;
        this.monitor = monitor;
        this.logger = logger;
        this.now = options.now ?? (() => Date.now());
        this.random = options.random ?? (() => Math.random());
        this.retryMaxDelayMs = options.retryMaxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS;
        this.circuitBreaker = new rpc_circuit_breaker_1.RpcCircuitBreaker({
            failureThreshold: options.circuitBreakerFailureThreshold ?? DEFAULT_CIRCUIT_BREAKER_FAILURE_THRESHOLD,
            cooldownMs: options.circuitBreakerCooldownMs ?? DEFAULT_CIRCUIT_BREAKER_COOLDOWN_MS,
            now: this.now,
        });
        this.syncCircuitBreaker();
    }
    async initialize() {
        const localPublicKey = this.prover.getPublicKey();
        if (!localPublicKey) {
            throw new Error('VRF public key is required for startup validation.');
        }
        let activePublicKey;
        try {
            activePublicKey = await this.coordinatorReader.getActiveVrfPublicKey();
        }
        catch (error) {
            this.monitor.recordRequestError('read', isRetryableError(error));
            throw error;
        }
        if (localPublicKey.toLowerCase() !== activePublicKey.toLowerCase()) {
            throw new Error(`Configured VRF public key ${redactHex(localPublicKey)} does not match coordinator key ${redactHex(activePublicKey)}.`);
        }
        this.logger.info('Validated coordinator VRF public key', {
            vrf_public_key: redactHex(activePublicKey),
        });
        this.monitor.markInitialized();
    }
    async start() {
        await this.initialize();
        this.logger.info('Starting IOTA VRF node', {
            operator: this.submitter.getOperatorAddress(),
            vrf_public_key: redactHex(this.prover.getPublicKey()),
        });
        // eslint-disable-next-line no-constant-condition
        while (true) {
            try {
                await this.runOnce();
            }
            catch (error) {
                this.monitor.recordPollFailure(error instanceof Error ? error.message : String(error));
                this.logger.error('Poll loop failed', {
                    error: error instanceof Error ? error.message : String(error),
                });
            }
            await delay(this.options.pollIntervalMs);
        }
    }
    async runOnce() {
        const dueRetries = this.store.listDueRetries();
        this.monitor.recordPollStart(dueRetries.length);
        if (!this.circuitBreaker.allowRequest()) {
            this.syncCircuitBreaker();
            const snapshot = this.circuitBreaker.snapshot();
            const error = snapshot.openUntil === null
                ? 'RPC circuit breaker is open.'
                : `RPC circuit breaker is open until ${snapshot.openUntil}.`;
            this.monitor.recordPollFailure(error);
            this.logger.warn('Skipping poll cycle while RPC circuit breaker is open', {
                open_until: snapshot.openUntil,
                last_error: snapshot.lastError,
            });
            return;
        }
        this.syncCircuitBreaker();
        await this.processDueRetries(dueRetries);
        const eventsSeen = await this.processFreshEvents();
        this.monitor.recordPollSuccess(eventsSeen);
    }
    async processDueRetries(dueRetries) {
        for (const record of dueRetries) {
            if (this.circuitBreaker.snapshot().state === 'open') {
                break;
            }
            await this.processRequest(record.request, record.attempts);
        }
    }
    async processFreshEvents() {
        let cursor = this.store.getCursor();
        let eventsSeen = 0;
        while (true) {
            if (this.circuitBreaker.snapshot().state === 'open') {
                break;
            }
            let pageInterrupted = false;
            const page = await this.fetchEventPage(cursor);
            eventsSeen += page.events.length;
            for (const event of page.events) {
                if (this.circuitBreaker.snapshot().state === 'open') {
                    pageInterrupted = true;
                    break;
                }
                const existing = this.store.getRequest(event.requestId);
                if (existing && existing.status !== 'retry') {
                    continue;
                }
                if (existing?.status === 'retry' && existing.nextRetryAt) {
                    continue;
                }
                await this.processRequest(event, existing?.attempts ?? 0);
            }
            if (pageInterrupted) {
                break;
            }
            const advancedCursor = page.nextCursor;
            if (advancedCursor) {
                await this.store.saveCursor(advancedCursor);
            }
            const cursorDidNotAdvance = cursor !== null &&
                advancedCursor !== null &&
                cursor.txDigest === advancedCursor.txDigest &&
                cursor.eventSeq === advancedCursor.eventSeq;
            if (!page.hasNextPage || !advancedCursor || cursorDidNotAdvance) {
                break;
            }
            cursor = advancedCursor;
        }
        return eventsSeen;
    }
    async processRequest(request, previousAttempts) {
        const attempt = previousAttempts + 1;
        const startedAt = Date.now();
        this.monitor.recordRequestStart();
        this.logger.info('Processing randomness request', {
            request_id: request.requestId,
            event_id: request.eventId,
            attempt,
        });
        try {
            const chainStatus = await this.runStage('read', () => this.coordinatorReader.getRequestStatus(request.requestId));
            if (chainStatus !== 'pending') {
                const outcome = await this.handleNonPendingRequest(request, attempt, chainStatus);
                this.monitor.recordRequestOutcome(outcome);
                return;
            }
            const proof = await this.runStage('prove', () => this.prover.generateProof(request.seedHex));
            const submission = await this.runStage('submit', () => this.submitter.submitFulfillment(request, proof.proofHex, proof.outputHex));
            await this.store.markFulfilled(request, attempt, submission.txDigest);
            this.monitor.recordRequestOutcome('fulfilled', Date.now() - startedAt);
            this.logger.info('Randomness request fulfilled', {
                request_id: request.requestId,
                event_id: request.eventId,
                attempt,
                latency_ms: Date.now() - startedAt,
                tx_digest: submission.txDigest,
            });
        }
        catch (error) {
            const normalized = normalizeError(error);
            if (normalized.retryable && attempt < this.options.maxRetryAttempts) {
                const retrySchedule = nextRetrySchedule(previousAttempts, this.options.retryBaseDelayMs, this.retryMaxDelayMs, this.now, this.random);
                await this.store.markRetry(request, previousAttempts, normalized.message, retrySchedule.scheduledFor);
                this.monitor.recordRequestOutcome('retry', Date.now() - startedAt);
                this.logger.warn('Scheduled retry for randomness request', {
                    request_id: request.requestId,
                    event_id: request.eventId,
                    attempt,
                    next_retry_at: retrySchedule.scheduledFor,
                    next_retry_delay_ms: retrySchedule.delayMs,
                    error: normalized.message,
                });
                return;
            }
            await this.store.markTerminal(request, attempt, normalized.message);
            this.monitor.recordRequestOutcome('terminal', Date.now() - startedAt);
            this.logger.error('Marked randomness request terminal', {
                request_id: request.requestId,
                event_id: request.eventId,
                attempt,
                error: normalized.message,
            });
        }
    }
    async handleNonPendingRequest(request, attempt, chainStatus) {
        if (chainStatus === 'fulfilled') {
            await this.store.markFulfilled(request, attempt, null);
            this.logger.info('Request already fulfilled on-chain; skipping submit', {
                request_id: request.requestId,
                event_id: request.eventId,
                attempt,
            });
            return 'skipped_fulfilled';
        }
        await this.store.markTerminal(request, attempt, chainStatus === 'missing'
            ? 'request no longer exists on-chain'
            : `request is ${chainStatus} on-chain`);
        this.logger.warn('Request is not pending on-chain; skipping submit', {
            request_id: request.requestId,
            event_id: request.eventId,
            attempt,
            chain_status: chainStatus,
        });
        if (chainStatus === 'missing') {
            return 'skipped_missing';
        }
        return 'skipped_cancelled';
    }
    async runStage(stage, fn) {
        try {
            const result = await fn();
            if (stage !== 'prove') {
                this.recordRpcSuccess();
            }
            return result;
        }
        catch (error) {
            this.monitor.recordRequestError(stage, isRetryableError(error));
            if (stage !== 'prove') {
                this.recordRpcFailure(error);
            }
            throw error;
        }
    }
    async fetchEventPage(cursor) {
        try {
            const page = await this.ingestor.fetchPage(cursor);
            this.recordRpcSuccess();
            return page;
        }
        catch (error) {
            this.recordRpcFailure(error);
            throw error;
        }
    }
    recordRpcSuccess() {
        this.circuitBreaker.recordSuccess();
        this.syncCircuitBreaker();
    }
    recordRpcFailure(error) {
        if (!isRetryableError(error)) {
            return;
        }
        this.circuitBreaker.recordFailure(error instanceof Error ? error.message : String(error));
        this.syncCircuitBreaker();
    }
    syncCircuitBreaker() {
        this.monitor.recordCircuitBreaker(this.circuitBreaker.snapshot());
    }
}
exports.VrfNode = VrfNode;
