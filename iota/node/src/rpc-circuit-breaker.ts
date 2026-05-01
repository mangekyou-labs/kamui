import type { RpcCircuitBreakerSnapshot } from './types';

interface RpcCircuitBreakerOptions {
  failureThreshold: number;
  cooldownMs: number;
  now?: () => number;
}

function toIso(timestampMs: number | null): string | null {
  return timestampMs === null ? null : new Date(timestampMs).toISOString();
}

export class RpcCircuitBreaker {
  private state: RpcCircuitBreakerSnapshot['state'] = 'closed';
  private consecutiveFailures = 0;
  private openUntilMs: number | null = null;
  private lastError: string | null = null;

  constructor(private readonly options: RpcCircuitBreakerOptions) {}

  allowRequest(): boolean {
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

  recordSuccess(): void {
    this.state = 'closed';
    this.consecutiveFailures = 0;
    this.openUntilMs = null;
    this.lastError = null;
  }

  recordFailure(message: string): void {
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

  snapshot(): RpcCircuitBreakerSnapshot {
    return {
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      openUntil: toIso(this.openUntilMs),
      lastError: this.lastError,
    };
  }

  private open(): void {
    this.state = 'open';
    this.consecutiveFailures = this.options.failureThreshold;
    this.openUntilMs = this.now() + this.options.cooldownMs;
  }

  private now(): number {
    return (this.options.now ?? (() => Date.now()))();
  }
}
