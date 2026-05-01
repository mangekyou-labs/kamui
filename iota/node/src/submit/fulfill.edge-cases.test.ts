import test from 'node:test';
import assert from 'node:assert/strict';

import type { PendingRequest } from '../types';
import {
  classifyFulfillmentError,
  IotaFulfillmentSubmitter,
  SubmissionError,
} from './fulfill';

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

function createSigner() {
  return { toIotaAddress: () => '0x1111111111111111111111111111111111111111111111111111111111111111' };
}

const noopLogger = {
  info() {},
  warn() {},
  error() {},
};

// ─── classifyFulfillmentError ────────────────────────────────────────────────

test('classifyFulfillmentError marks invalid proof abort as terminal', () => {
  const error = classifyFulfillmentError(new Error('MoveAbort: abort code 8'));
  assert.equal(error.retryable, false);
  assert.equal(error.code, 'terminal_abort');
});

test('classifyFulfillmentError matches standard abort code 7 format', () => {
  // Standard IOTA format: 'MoveAbort: abort code 7'
  const error = classifyFulfillmentError(new Error('MoveAbort: abort code 7'));
  assert.equal(error.retryable, false);
  assert.equal(error.code, 'terminal_abort');
});

test('classifyFulfillmentError preserves SubmissionError instances', () => {
  const original = new SubmissionError('missing_digest', 'no digest', true);
  assert.equal(classifyFulfillmentError(original), original);
});

test('classifyFulfillmentError default case is retryable', () => {
  const error = classifyFulfillmentError(new Error('some unexpected RPC error'));
  assert.equal(error.retryable, true);
  assert.equal(error.code, 'transient_failure');
});

// ─── IotaFulfillmentSubmitter edge cases ─────────────────────────────────────

test('IotaFulfillmentSubmitter rejects when checkpoint is absent and waitForTransaction is missing', async () => {
  const client = {
    async signAndExecuteTransaction() {
      return { digest: '0xdeadbeef', checkpoint: null };
    },
  };

  const submitter = new IotaFulfillmentSubmitter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client as any, createSigner() as any, '0xpackage', '0xcoordinator', noopLogger,
  );

  await assert.rejects(
    () => submitter.submitFulfillment(request, 'ab'.repeat(80), 'cd'.repeat(64)),
    (error: unknown) =>
      error instanceof SubmissionError &&
      error.code === 'unconfirmed_execution' &&
      error.retryable === true,
  );
});

test('IotaFulfillmentSubmitter rejects when signAndExecuteTransaction returns no digest', async () => {
  const client = { async signAndExecuteTransaction() { return {}; } };

  const submitter = new IotaFulfillmentSubmitter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client as any, createSigner() as any, '0xpackage', '0xcoordinator', noopLogger,
  );

  await assert.rejects(
    () => submitter.submitFulfillment(request, 'ab'.repeat(80), 'cd'.repeat(64)),
    (error: unknown) =>
      error instanceof SubmissionError &&
      error.code === 'missing_digest' &&
      error.retryable === true,
  );
});

test('IotaFulfillmentSubmitter throws unconfirmed_execution when effects are absent in waitForTransaction', async () => {
  // When waitForTransaction is present but returns no checkpoint, hasCheckpoint returns false.
  // This triggers 'unconfirmed_execution', not 'missing_effects'.
  const client = {
    async signAndExecuteTransaction() { return { digest: '0xdeadbeef' }; },
    async waitForTransaction() { return {}; }, // no checkpoint
  };

  const submitter = new IotaFulfillmentSubmitter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client as any, createSigner() as any, '0xpackage', '0xcoordinator', noopLogger,
  );

  await assert.rejects(
    () => submitter.submitFulfillment(request, 'ab'.repeat(80), 'cd'.repeat(64)),
    (error: unknown) =>
      error instanceof SubmissionError &&
      error.code === 'unconfirmed_execution' &&
      error.retryable === true,
  );
});

test('IotaFulfillmentSubmitter derives operator address from public key when toIotaAddress is absent', () => {
  const signer = {
    getPublicKey() {
      return {
        toIotaAddress() {
          return '0x2222222222222222222222222222222222222222222222222222222222222222';
        },
      };
    },
  };

  const submitter = new IotaFulfillmentSubmitter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    {} as any, signer as any, '0xpackage', '0xcoordinator', noopLogger,
  );

  assert.equal(submitter.getOperatorAddress(), '0x2222222222222222222222222222222222222222222222222222222222222222');
});

test('IotaFulfillmentSubmitter throws when operator address cannot be derived', () => {
  const signer = {};

  assert.throws(
    () =>
      new IotaFulfillmentSubmitter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {} as any, signer as any, '0xpackage', '0xcoordinator', noopLogger,
      ),
    /Unable to derive operator address/,
  );
});

test('IotaFulfillmentSubmitter classifies unknown abort codes as retryable', async () => {
  const client = {
    async signAndExecuteTransaction() { return { digest: '0xdeadbeef' }; },
    async waitForTransaction() {
      return {
        digest: '0xdeadbeef',
        checkpoint: '42',
        effects: {
          status: {
            status: 'failure',
            error: 'MoveAbort: abort code 99',
          },
        },
      };
    },
  };

  const submitter = new IotaFulfillmentSubmitter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client as any, createSigner() as any, '0xpackage', '0xcoordinator', noopLogger,
  );

  await assert.rejects(
    () => submitter.submitFulfillment(request, 'ab'.repeat(80), 'cd'.repeat(64)),
    (error: unknown) =>
      error instanceof SubmissionError &&
      error.code === 'transient_failure' &&
      error.retryable === true,
  );
});

test('IotaFulfillmentSubmitter rethrows network errors as retryable', async () => {
  const client = {
    async signAndExecuteTransaction() { throw new Error('ECONNREFUSED'); },
  };

  const submitter = new IotaFulfillmentSubmitter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client as any, createSigner() as any, '0xpackage', '0xcoordinator', noopLogger,
  );

  await assert.rejects(
    () => submitter.submitFulfillment(request, 'ab'.repeat(80), 'cd'.repeat(64)),
    (error: unknown) =>
      error instanceof SubmissionError && error.retryable === true,
  );
});

// hexToBytes is called synchronously inside the async submitFulfillment method.
// The error is thrown after the Transaction API is called (inside moveCall),
// which means it surfaces as a rejected promise.
test('IotaFulfillmentSubmitter hexToBytes rejects odd-length proof hex via promise rejection', async () => {
  const client = {
    async signAndExecuteTransaction() { return { digest: '0xdeadbeef' }; },
    async waitForTransaction() {
      return { digest: '0xdeadbeef', checkpoint: '42', effects: { status: { status: 'success' } } };
    },
  };

  const submitter = new IotaFulfillmentSubmitter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client as any, createSigner() as any, '0xpackage', '0xcoordinator', noopLogger,
  );

  await assert.rejects(
    () => submitter.submitFulfillment(request, 'z', 'cafe'), // odd-length proof hex
    (error: unknown) =>
      error instanceof SubmissionError && error.code === 'bad_hex',
  );
});

test('IotaFulfillmentSubmitter hexToBytes rejects non-hex characters in output via promise rejection', async () => {
  const client = {
    async signAndExecuteTransaction() { return { digest: '0xdeadbeef' }; },
    async waitForTransaction() {
      return { digest: '0xdeadbeef', checkpoint: '42', effects: { status: { status: 'success' } } };
    },
  };

  const submitter = new IotaFulfillmentSubmitter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client as any, createSigner() as any, '0xpackage', '0xcoordinator', noopLogger,
  );

  await assert.rejects(
    // Valid-length proof (160 hex chars), but output contains non-hex chars (GGGG)
    () => submitter.submitFulfillment(request, 'ab'.repeat(80), 'GGGG'),
    (error: unknown) =>
      error instanceof SubmissionError && error.code === 'bad_hex',
  );
});
