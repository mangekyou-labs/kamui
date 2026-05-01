#!/usr/bin/env node

import {
  createDemoSummary,
  loadDemoContext,
  readDemoNumWords,
  resolveBytesFromEnv,
  submitDemoRequest,
} from './common';

async function main(): Promise<void> {
  const context = await loadDemoContext({ requireDemoConsumer: true });

  const seed = resolveBytesFromEnv(
    'DEMO_SEED_HEX',
    'DEMO_SEED_TEXT',
    'kamui-testnet-demo',
  );
  const callbackData = resolveBytesFromEnv(
    'DEMO_CALLBACK_HEX',
    'DEMO_CALLBACK_TEXT',
    'round-1',
  );
  const numWords = readDemoNumWords();

  const { txDigest, state } = await submitDemoRequest(context, {
    seedBytes: seed.bytes,
    callbackDataBytes: callbackData.bytes,
    numWords,
  });

  console.log(
    JSON.stringify(
      {
        tx_digest: txDigest,
        request_seed_hex: seed.hex,
        request_seed_text: seed.text,
        callback_data_hex: callbackData.hex,
        callback_data_text: callbackData.text,
        num_words: numWords,
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
