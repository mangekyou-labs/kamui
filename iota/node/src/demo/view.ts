#!/usr/bin/env node

import {
  createDemoSummary,
  loadDemoContext,
  viewDemoConsumerState,
} from './common';

async function main(): Promise<void> {
  const context = await loadDemoContext({ requireDemoConsumer: true });
  const state = await viewDemoConsumerState(context);
  const requestStatus =
    state.hasActiveRequest && state.activeRequestId !== '0'
      ? await context.coordinatorReader.getRequestStatus(state.activeRequestId)
      : null;

  console.log(
    JSON.stringify(
      {
        ...createDemoSummary(state),
        active_request_status: requestStatus,
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
