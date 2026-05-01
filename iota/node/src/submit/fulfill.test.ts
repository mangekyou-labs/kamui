import test from 'node:test';
import assert from 'node:assert/strict';

import type { Logger, PendingRequest } from '../types';
import {
  classifyFulfillmentError,
  IotaFulfillmentSubmitter,
  SubmissionError,
} from './fulfill';

const noopLogger: Logger = {
  info() {},
  warn() {},
  error() {},
};

const request: PendingRequest = {
  requestId: '7',
  subscriptionId: '3',
  requester: '0xabc',
  seedHex: 'abcd',
  numWords: 1,
  timestampMs: 123,
  eventId: '0xfeed:7',
  cursor: { txDigest: '0xfeed', eventSeq: '7' },
  type: '0x1::request::RandomnessRequested',
};

function createSigner(): { toIotaAddress(): string } {
  return {
    toIotaAddress() {
      return '0x1111111111111111111111111111111111111111111111111111111111111111';
    },
  };
}

test('classifyFulfillmentError marks request-not-pending aborts terminal', () => {
  const error = classifyFulfillmentError(new Error('MoveAbort: abort code 7'));
  assert.equal(error.retryable, false);
  assert.equal(error.code, 'terminal_abort');
});

test('classifyFulfillmentError keeps RPC failures retryable', () => {
  const error = classifyFulfillmentError(new Error('RPC timeout'));
  assert.equal(error.retryable, true);
});

test('classifyFulfillmentError preserves SubmissionError instances', () => {
  const original = new SubmissionError('bad_hex', 'bad hex', false);
  assert.equal(classifyFulfillmentError(original), original);
});

test('IotaFulfillmentSubmitter waits for checkpointed success before returning', async () => {
  const client = {
    async signAndExecuteTransaction() {
      return {
        digest: '0xdeadbeef',
        effects: {
          status: {
            status: 'success',
          },
        },
      };
    },
    async waitForTransaction() {
      return {
        digest: '0xdeadbeef',
        checkpoint: '42',
        effects: {
          status: {
            status: 'success',
          },
        },
      };
    },
  };

  const submitter = new IotaFulfillmentSubmitter(
    client,
    createSigner(),
    '0xpackage',
    '0xcoordinator',
    noopLogger,
  );

  const result = await submitter.submitFulfillment(request, 'ab'.repeat(80), 'cd'.repeat(64));
  assert.equal(result.txDigest, '0xdeadbeef');
});

test('IotaFulfillmentSubmitter rejects checkpointed failed transactions even when they have a digest', async () => {
  const client = {
    async signAndExecuteTransaction() {
      return {
        digest: '0xdeadbeef',
      };
    },
    async waitForTransaction() {
      return {
        digest: '0xdeadbeef',
        checkpoint: '42',
        effects: {
          status: {
            status: 'failure',
            error: 'MoveAbort: abort code 7',
          },
        },
      };
    },
  };

  const submitter = new IotaFulfillmentSubmitter(
    client,
    createSigner(),
    '0xpackage',
    '0xcoordinator',
    noopLogger,
  );

  await assert.rejects(
    () => submitter.submitFulfillment(request, 'ab'.repeat(80), 'cd'.repeat(64)),
    (error: unknown) =>
      error instanceof SubmissionError &&
      error.code === 'terminal_abort' &&
      error.retryable === false,
  );
});
