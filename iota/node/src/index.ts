#!/usr/bin/env node

import { IotaClient } from '@iota/iota-sdk/client';
import { Ed25519Keypair } from '@iota/iota-sdk/keypairs/ed25519';

import { InMemoryRuntimeMonitor } from './api/runtime-monitor';
import { OpsServer } from './api/server';
import { loadConfig } from './config';
import { IotaEventIngestor } from './ingest/query-events';
import { createLogger, VrfNode } from './node';
import { FastcryptoCliProver } from './prove/fastcrypto';
import { IotaCoordinatorReader } from './read/coordinator';
import { JsonStateStore } from './store/json-state';
import { IotaFulfillmentSubmitter } from './submit/fulfill';

function createSigner(secret: string | Uint8Array): any {
  return (Ed25519Keypair as any).fromSecretKey(secret);
}

async function main(): Promise<void> {
  const logger = createLogger();
  const config = await loadConfig();

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
  const client = new IotaClient({ url: config.rpcUrl } as any);
  const prover = new FastcryptoCliProver(
    config.fastcryptoCliPath,
    config.vrfSecretKey,
    logger,
    config.vrfPublicKey,
  );
  const store = new JsonStateStore(config.stateDir);
  await store.initialize();

  const ingestor = new IotaEventIngestor(
    client as any,
    config.coordinatorPackageId,
    config.backfillWindowSec,
    config.eventPageSize,
    logger,
  );
  const coordinatorReader = new IotaCoordinatorReader(
    client as any,
    config.coordinatorPackageId,
    config.coordinatorObjectId,
  );
  const submitter = new IotaFulfillmentSubmitter(
    client as any,
    signer,
    config.coordinatorPackageId,
    config.coordinatorObjectId,
    logger,
  );
  const monitor = new InMemoryRuntimeMonitor(config.pollIntervalMs);
  monitor.markProcessStarted();
  const opsServer = new OpsServer({
    host: config.opsHost,
    port: config.opsPort,
    logger,
    monitor,
  });
  await opsServer.start();
  const node = new VrfNode(
    {
      pollIntervalMs: config.pollIntervalMs,
      maxRetryAttempts: config.maxRetryAttempts,
      retryBaseDelayMs: config.retryBaseDelayMs,
      retryMaxDelayMs: config.retryMaxDelayMs,
      circuitBreakerFailureThreshold: config.rpcCircuitBreakerFailureThreshold,
      circuitBreakerCooldownMs: config.rpcCircuitBreakerCooldownMs,
    },
    store,
    ingestor,
    prover,
    coordinatorReader,
    submitter,
    monitor,
    logger,
  );

  await node.start();
}

main().catch((error) => {
  console.error(
    `[${new Date().toISOString()}] ERROR Fatal node startup error`,
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
