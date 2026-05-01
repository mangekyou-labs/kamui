"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RpcCircuitBreaker = void 0;
function toIso(timestampMs) {
    return timestampMs === null ? null : new Date(timestampMs).toISOString();
}
class RpcCircuitBreaker {
    constructor(options) {
        this.options = options;
        this.state = 'closed';
        this.consecutiveFailures = 0;
        this.openUntilMs = null;
        this.lastError = null;
    }
    allowRequest() {
        if (this.state !== 'open') {
            return true;
        }
        if (this.openUntilMs !== null && this.now() >= this.openUntilMs) {
            this.state = 'half_open';
            this.openUntilMs = null;
            return true;
        }
        return false;
    }
    recordSuccess() {
        this.state = 'closed';
        this.consecutiveFailures = 0;
        this.openUntilMs = null;
        this.lastError = null;
    }
    recordFailure(message) {
        this.lastError = message;
        if (this.state === 'half_open') {
            this.open();
            return;
        }
        this.consecutiveFailures += 1;
        if (this.consecutiveFailures >= this.options.failureThreshold) {
            this.open();
        }
    }
    snapshot() {
        return {
            state: this.state,
            consecutiveFailures: this.consecutiveFailures,
            openUntil: toIso(this.openUntilMs),
            lastError: this.lastError,
        };
    }
    open() {
        this.state = 'open';
        this.consecutiveFailures = this.options.failureThreshold;
        this.openUntilMs = this.now() + this.options.cooldownMs;
    }
    now() {
        return (this.options.now ?? (() => Date.now()))();
    }
}
exports.RpcCircuitBreaker = RpcCircuitBreaker;
