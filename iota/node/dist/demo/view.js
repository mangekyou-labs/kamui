#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const common_1 = require("./common");
async function main() {
    const context = await (0, common_1.loadDemoContext)({ requireDemoConsumer: true });
    const state = await (0, common_1.viewDemoConsumerState)(context);
    const requestStatus = state.hasActiveRequest && state.activeRequestId !== '0'
        ? await context.coordinatorReader.getRequestStatus(state.activeRequestId)
        : null;
    console.log(JSON.stringify({
        ...(0, common_1.createDemoSummary)(state),
        active_request_status: requestStatus,
    }, null, 2));
}
main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
