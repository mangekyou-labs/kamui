#!/usr/bin/env node

import {
  consumeDemoRequest,
  createDemoSummary,
  loadDemoContext,
  viewDemoConsumerState,
  waitForRequestState,
} from './common';

async function main(): Promise<void> {
  const context = await loadDemoContext({ requireDemoConsumer: true });
  const initialState = await viewDemoConsumerState(context);

  if (!initialState.hasActiveRequest) {
    console.log(
      JSON.stringify(
        {
          message: 'No active request to consume.',
          ...createDemoSummary(initialState),
        },
        null,
        2,
      ),
    );
    return;
  }

  const finalState = await waitForRequestState(
    context,
    initialState.activeRequestId,
    'fulfilled',
  );

  if (finalState !== 'fulfilled') {
    throw new Error(
      `Request ${initialState.activeRequestId} ended in state ${finalState} before it could be consumed.`,
    );
  }

  const { txDigest, state } = await consumeDemoRequest(context);

  console.log(
    JSON.stringify(
      {
        tx_digest: txDigest,
        consumed_request_id: state.lastConsumedRequestId,
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
