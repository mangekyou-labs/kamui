import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Logger, RuntimeMonitor } from '../types';

interface OpsServerOptions {
  host: string;
  logger: Logger;
  monitor: RuntimeMonitor;
  now?: () => number;
  port: number;
}

export class OpsServer {
  private readonly server: Server;
  private listeningAddress: AddressInfo | null = null;

  constructor(private readonly options: OpsServerOptions) {
    this.server = createServer((request, response) => {
      void this.handleRequest(request, response);
    });
  }

  async start(): Promise<AddressInfo> {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.options.port, this.options.host, () => {
        this.server.off('error', reject);
        resolve();
      });
    });

    const address = this.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Ops server failed to bind to a TCP address.');
    }

    this.listeningAddress = address;
    this.options.logger.info('Started node ops server', {
      ops_host: address.address,
      ops_port: address.port,
    });
    return address;
  }

  async close(): Promise<void> {
    if (!this.server.listening) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  get address(): AddressInfo | null {
    return this.listeningAddress;
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if ((request.method ?? 'GET').toUpperCase() !== 'GET') {
      response.statusCode = 405;
      response.setHeader('Allow', 'GET');
      response.end();
      return;
    }

    const path = request.url ?? '/';
    if (path === '/healthz') {
      this.writeJson(response, 200, this.healthPayload());
      return;
    }
    if (path === '/readyz') {
      const payload = this.readyPayload();
      this.writeJson(response, payload.ready ? 200 : 503, payload.body);
      return;
    }
    if (path === '/metrics') {
      response.statusCode = 200;
      response.setHeader('Content-Type', 'text/plain; version=0.0.4');
      response.end(this.options.monitor.renderPrometheus());
      return;
    }

    response.statusCode = 404;
    response.end();
  }

  private healthPayload(): { startedAt: string; status: 'ok'; uptimeSec: number } {
    const snapshot = this.options.monitor.snapshot();
    const uptimeMs = (this.options.now ?? (() => Date.now()))() - Date.parse(snapshot.startedAt);
    return {
      status: 'ok',
      startedAt: snapshot.startedAt,
      uptimeSec: Math.max(0, Math.floor(uptimeMs / 1000)),
    };
  }

  private readyPayload(): {
    ready: boolean;
      body: {
        status: 'ready' | 'not_ready';
        initialized: boolean;
        lastSuccessfulPollAt: string | null;
        lastPollError: string | null;
        circuitBreakerState: string;
        circuitBreakerOpenUntil: string | null;
        circuitBreakerLastError: string | null;
        staleAfterMs: number;
      };
  } {
    const snapshot = this.options.monitor.snapshot();
    return {
      ready: snapshot.ready,
      body: {
        status: snapshot.ready ? 'ready' : 'not_ready',
        initialized: snapshot.initializedAt !== null,
        lastSuccessfulPollAt: snapshot.lastSuccessfulPollAt,
        lastPollError: snapshot.lastPollError,
        circuitBreakerState: snapshot.circuitBreaker.state,
        circuitBreakerOpenUntil: snapshot.circuitBreaker.openUntil,
        circuitBreakerLastError: snapshot.circuitBreaker.lastError,
        staleAfterMs: snapshot.staleAfterMs,
      },
    };
  }

  private writeJson(response: ServerResponse, statusCode: number, payload: unknown): void {
    response.statusCode = statusCode;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(payload));
  }
}
