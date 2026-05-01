#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const common_1 = require("./common");
async function main() {
    const context = await (0, common_1.loadDemoContext)();
    const tx = (0, common_1.createTransaction)();
    const txAny = tx;
    const feePerRequest = await (0, common_1.viewCoordinatorU64)(context, 'fee_per_request', [context.config.coordinatorObjectId]);
    const fundAmount = process.env.DEMO_SUBSCRIPTION_FUND_AMOUNT?.trim() ||
        (BigInt(feePerRequest) * 2n).toString();
    const subscriptionId = txAny.moveCall({
        target: `${context.config.coordinatorPackageId}::coordinator::create_subscription`,
        arguments: [
            txAny.object(context.config.coordinatorObjectId),
            (0, common_1.pureAddress)(txAny, context.signerAddress),
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
    const result = await (0, common_1.executeTransaction)(context.client, context.signer, tx, {
        showObjectChanges: true,
    });
    const demoConsumerObjectId = (0, common_1.findCreatedObjectId)(result.objectChanges, '::demo_consumer::DemoConsumer');
    if (!demoConsumerObjectId) {
        throw new Error(`Transaction ${result.digest} succeeded but no DemoConsumer object was detected in object changes.`);
    }
    process.env.DEMO_CONSUMER_OBJECT_ID = demoConsumerObjectId;
    const state = await (0, common_1.viewDemoConsumerState)({
        ...context,
        demoConsumerObjectId,
    });
    console.log(JSON.stringify({
        tx_digest: result.digest,
        demo_consumer_object_id: demoConsumerObjectId,
        funded_amount: fundAmount,
        ...(0, common_1.createDemoSummary)(state),
    }, null, 2));
}
main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
