import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyCoordinatorReadError,
  IotaCoordinatorReader,
  CoordinatorReadError,
} from './coordinator';

test('classifyCoordinatorReadError returns already-classified errors unchanged', () => {
  const original = new CoordinatorReadError('request_missing', 'boom', false);
  assert.equal(classifyCoordinatorReadError(original), original);
});

test('classifyCoordinatorReadError normalizes error message case-insensitively', () => {
  const rpcError = classifyCoordinatorReadError(new Error('NETWORK TIMEOUT'));
  assert.equal(rpcError.retryable, true);
  assert.equal(rpcError.code, 'view_unavailable');

  const abort7 = classifyCoordinatorReadError(new Error('E_REQUEST_NOT_PENDING'));
  assert.equal(abort7.retryable, false);
  assert.equal(abort7.code, 'request_missing');

  const fieldNotFound = classifyCoordinatorReadError(new Error('Dynamic field not found'));
  assert.equal(fieldNotFound.retryable, false);
  assert.equal(fieldNotFound.code, 'request_missing');

  const unsupported = classifyCoordinatorReadError(new Error('UNSUPPORTED FEATURE'));
  assert.equal(unsupported.retryable, false);
  assert.equal(unsupported.code, 'view_unsupported');
});

test('classifyCoordinatorReadError handles abort code 7 in regex patterns', () => {
  // Standard format: 'MoveAbort: abort code 7'
  const error = classifyCoordinatorReadError(
    new Error('MoveAbort: abort code 7'),
  );
  assert.equal(error.retryable, false);
  assert.equal(error.code, 'request_missing');

  // Lowercase variant also works
  const raw7 = classifyCoordinatorReadError(
    new Error('moveabort: abort code 7'),
  );
  assert.equal(raw7.retryable, false);
  assert.equal(raw7.code, 'request_missing');
});

test('classifyCoordinatorReadError default case is retryable', () => {
  const error = classifyCoordinatorReadError(new Error('something completely unrelated'));
  assert.equal(error.retryable, true);
  assert.equal(error.code, 'view_failed');
});

test('IotaCoordinatorReader returns invalid_view_response when functionReturnValues is empty', async () => {
  const reader = new IotaCoordinatorReader(
    {
      async view() {
        return {
          functionReturnValues: [],
        };
      },
    },
    '0x42',
    '0xabc',
  );

  await assert.rejects(
    () => reader.getRequestStatus('1'),
    (error: unknown) =>
      error instanceof CoordinatorReadError &&
      error.code === 'invalid_view_response' &&
      error.retryable === false,
  );
});

test('IotaCoordinatorReader classifies unknown executionError strings as retryable view_failed', async () => {
  // An executionError string that doesn't match any known pattern falls through to view_failed
  const reader = new IotaCoordinatorReader(
    {
      async view() {
        return {
          executionError: 'something unknown',
        };
      },
    },
    '0x42',
    '0xabc',
  );

  await assert.rejects(
    () => reader.getRequestStatus('1'),
    (error: unknown) =>
      error instanceof CoordinatorReadError &&
      error.code === 'view_failed' &&
      error.retryable === true,
  );
});

test('IotaCoordinatorReader propagates getObject failures as retryable view_failed', async () => {
  // getObject failures are retryable (network/disk errors) rather than view_unavailable
  const reader = new IotaCoordinatorReader(
    {
      async getObject() {
        throw new Error('Object not found');
      },
    },
    '0x42',
    '0xabc',
  );

  await assert.rejects(
    () => reader.getActiveVrfPublicKey(),
    (error: unknown) =>
      error instanceof CoordinatorReadError &&
      error.code === 'view_failed' &&
      error.retryable === true,
  );
});

test('IotaCoordinatorReader maps unsupported status values to error', async () => {
  const reader = new IotaCoordinatorReader(
    {
      async getDynamicFieldObject() {
        return {
          data: {
            content: {
              fields: {
                status: 99,
              },
            },
          },
        };
      },
      async getObject() {
        return {
          data: {
            content: {
              fields: {
                vrf_public_key: '00',
                requests: { fields: { id: { id: '0xfeed' } } },
              },
            },
          },
        };
      },
    },
    '0x42',
    '0xabc',
  );

  await assert.rejects(
    () => reader.getRequestStatus('1'),
    (error: unknown) =>
      error instanceof CoordinatorReadError &&
      error.code === 'invalid_view_value' &&
      error.retryable === false,
  );
});
