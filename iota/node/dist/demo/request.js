#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const common_1 = require("./common");
async function main() {
    const context = await (0, common_1.loadDemoContext)({ requireDemoConsumer: true });
    const seed = (0, common_1.resolveBytesFromEnv)('DEMO_SEED_HEX', 'DEMO_SEED_TEXT', 'kamui-testnet-demo');
    const callbackData = (0, common_1.resolveBytesFromEnv)('DEMO_CALLBACK_HEX', 'DEMO_CALLBACK_TEXT', 'round-1');
    const numWords = (0, common_1.readDemoNumWords)();
    const { txDigest, state } = await (0, common_1.submitDemoRequest)(context, {
        seedBytes: seed.bytes,
        callbackDataBytes: callbackData.bytes,
        numWords,
    });
    console.log(JSON.stringify({
        tx_digest: txDigest,
        request_seed_hex: seed.hex,
        request_seed_text: seed.text,
        callback_data_hex: callbackData.hex,
        callback_data_text: callbackData.text,
        num_words: numWords,
        ...(0, common_1.createDemoSummary)(state),
    }, null, 2));
}
main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
