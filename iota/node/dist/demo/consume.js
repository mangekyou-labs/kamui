#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const common_1 = require("./common");
async function main() {
    const context = await (0, common_1.loadDemoContext)({ requireDemoConsumer: true });
    const initialState = await (0, common_1.viewDemoConsumerState)(context);
    if (!initialState.hasActiveRequest) {
        console.log(JSON.stringify({
            message: 'No active request to consume.',
            ...(0, common_1.createDemoSummary)(initialState),
        }, null, 2));
        return;
    }
    const finalState = await (0, common_1.waitForRequestState)(context, initialState.activeRequestId, 'fulfilled');
    if (finalState !== 'fulfilled') {
        throw new Error(`Request ${initialState.activeRequestId} ended in state ${finalState} before it could be consumed.`);
    }
    const { txDigest, state } = await (0, common_1.consumeDemoRequest)(context);
    console.log(JSON.stringify({
        tx_digest: txDigest,
        consumed_request_id: state.lastConsumedRequestId,
        ...(0, common_1.createDemoSummary)(state),
    }, null, 2));
}
main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
