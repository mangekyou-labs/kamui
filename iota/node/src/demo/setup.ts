#!/usr/bin/env node

import {
  createTransaction,
  executeTransaction,
  findCreatedObjectId,
  loadDemoContext,
  pureAddress,
  viewCoordinatorU64,
  viewDemoConsumerState,
  createDemoSummary,
} from './common';

async function main(): Promise<void> {
  const context = await loadDemoContext();
  const tx = createTransaction();
  const txAny = tx as any;

  const feePerRequest = await viewCoordinatorU64(
    context,
    'fee_per_request',
    [context.config.coordinatorObjectId],
  );
  const fundAmount =
    process.env.DEMO_SUBSCRIPTION_FUND_AMOUNT?.trim() ||
    (BigInt(feePerRequest) * 2n).toString();

  const subscriptionId = txAny.moveCall({
    target: `${context.config.coordinatorPackageId}::coordinator::create_subscription`,
    arguments: [
      txAny.object(context.config.coordinatorObjectId),
      pureAddress(txAny, context.signerAddress),
    ],
  });

  const [paymentCoin] = txAny.splitCoins(txAny.gas, [fundAmount]);
  txAny.moveCall({
    target: `${context.config.coordinatorPackageId}::coordinator::fund_subscription`,
    arguments: [
      txAny.object(context.config.coordinatorObjectId),
      subscriptionId,
      paymentCoin,
    ],
  });

  txAny.moveCall({
    target: `${context.config.coordinatorPackageId}::demo_consumer::create_demo_consumer`,
    arguments: [subscriptionId],
  });

  const result = await executeTransaction(context.client, context.signer, tx, {
    showObjectChanges: true,
  });

  const demoConsumerObjectId = findCreatedObjectId(
    result.objectChanges,
    '::demo_consumer::DemoConsumer',
  );
  if (!demoConsumerObjectId) {
    throw new Error(
      `Transaction ${result.digest} succeeded but no DemoConsumer object was detected in object changes.`,
    );
  }

  process.env.DEMO_CONSUMER_OBJECT_ID = demoConsumerObjectId;
  const state = await viewDemoConsumerState({
    ...context,
    demoConsumerObjectId,
  });

  console.log(
    JSON.stringify(
      {
        tx_digest: result.digest,
        demo_consumer_object_id: demoConsumerObjectId,
        funded_amount: fundAmount,
        ...createDemoSummary(state),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
