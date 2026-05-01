"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpsServer = void 0;
const node_http_1 = require("node:http");
class OpsServer {
    constructor(options) {
        this.options = options;
        this.listeningAddress = null;
        this.server = (0, node_http_1.createServer)((request, response) => {
            void this.handleRequest(request, response);
        });
    }
    async start() {
        await new Promise((resolve, reject) => {
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
    async close() {
        if (!this.server.listening) {
            return;
        }
        await new Promise((resolve, reject) => {
            this.server.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve();
            });
        });
    }
    get address() {
        return this.listeningAddress;
    }
    async handleRequest(request, response) {
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
    healthPayload() {
        const snapshot = this.options.monitor.snapshot();
        const uptimeMs = (this.options.now ?? (() => Date.now()))() - Date.parse(snapshot.startedAt);
        return {
            status: 'ok',
            startedAt: snapshot.startedAt,
            uptimeSec: Math.max(0, Math.floor(uptimeMs / 1000)),
        };
    }
    readyPayload() {
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
    writeJson(response, statusCode, payload) {
        response.statusCode = statusCode;
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify(payload));
    }
}
exports.OpsServer = OpsServer;
