#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@iota/iota-sdk/client");
const ed25519_1 = require("@iota/iota-sdk/keypairs/ed25519");
const runtime_monitor_1 = require("./api/runtime-monitor");
const server_1 = require("./api/server");
const config_1 = require("./config");
const query_events_1 = require("./ingest/query-events");
const node_1 = require("./node");
const fastcrypto_1 = require("./prove/fastcrypto");
const coordinator_1 = require("./read/coordinator");
const json_state_1 = require("./store/json-state");
const fulfill_1 = require("./submit/fulfill");
function createSigner(secret) {
    return ed25519_1.Ed25519Keypair.fromSecretKey(secret);
}
async function main() {
    const logger = (0, node_1.createLogger)();
    const config = await (0, config_1.loadConfig)();
    logger.info('Loaded node configuration', {
        rpc_url: config.rpcUrl,
        coordinator_package_id: config.coordinatorPackageId,
        coordinator_object_id: config.coordinatorObjectId,
        state_dir: config.stateDir,
        ops_host: config.opsHost,
        ops_port: config.opsPort,
        vrf_secret_source: config.vrfSecretSource,
        operator_secret_source: config.operatorSecretSource,
    });
    const signer = createSigner(config.operatorSecret);
    const client = new client_1.IotaClient({ url: config.rpcUrl });
    const prover = new fastcrypto_1.FastcryptoCliProver(config.fastcryptoCliPath, config.vrfSecretKey, logger, config.vrfPublicKey);
    const store = new json_state_1.JsonStateStore(config.stateDir);
    await store.initialize();
    const ingestor = new query_events_1.IotaEventIngestor(client, config.coordinatorPackageId, config.backfillWindowSec, config.eventPageSize, logger);
    const coordinatorReader = new coordinator_1.IotaCoordinatorReader(client, config.coordinatorPackageId, config.coordinatorObjectId);
    const submitter = new fulfill_1.IotaFulfillmentSubmitter(client, signer, config.coordinatorPackageId, config.coordinatorObjectId, logger);
    const monitor = new runtime_monitor_1.InMemoryRuntimeMonitor(config.pollIntervalMs);
    monitor.markProcessStarted();
    const opsServer = new server_1.OpsServer({
        host: config.opsHost,
        port: config.opsPort,
        logger,
        monitor,
    });
    await opsServer.start();
    const node = new node_1.VrfNode({
        pollIntervalMs: config.pollIntervalMs,
        maxRetryAttempts: config.maxRetryAttempts,
        retryBaseDelayMs: config.retryBaseDelayMs,
        retryMaxDelayMs: config.retryMaxDelayMs,
        circuitBreakerFailureThreshold: config.rpcCircuitBreakerFailureThreshold,
        circuitBreakerCooldownMs: config.rpcCircuitBreakerCooldownMs,
    }, store, ingestor, prover, coordinatorReader, submitter, monitor, logger);
    await node.start();
}
main().catch((error) => {
    console.error(`[${new Date().toISOString()}] ERROR Fatal node startup error`, error instanceof Error ? error.message : String(error));
    process.exit(1);
});
