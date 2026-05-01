import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyCoordinatorReadError, IotaCoordinatorReader } from './coordinator';

test('IotaCoordinatorReader normalizes vrf_public_key from byte arrays', async () => {
  const reader = new IotaCoordinatorReader(
    {
      async getObject() {
        return {
          data: {
            content: {
              fields: {
                vrf_public_key: [0, 1, 255],
                requests: {
                  fields: {
                    id: {
                      id: '0xdead',
                    },
                  },
                },
              },
            },
          },
        };
      },
      async view() {
        return {
          functionReturnValues: [[0, 1, 255]],
        };
      },
    },
    '0x42',
    '0xabc',
  );

  assert.equal(await reader.getActiveVrfPublicKey(), '0001ff');
});

test('IotaCoordinatorReader maps missing requests to the missing state', async () => {
  const reader = new IotaCoordinatorReader(
    {
      async getObject() {
        return {
          data: {
            content: {
              fields: {
                requests: {
                  fields: {
                    id: {
                      id: '0xfeed',
                    },
                  },
                },
                vrf_public_key: '00',
              },
            },
          },
        };
      },
      async getDynamicFieldObject() {
        throw new Error('dynamic field not found');
      },
      async view(_input: unknown) {
        return {
          executionError: 'MoveAbort: abort code 7',
        };
      },
    },
    '0x42',
    '0xabc',
  );

  assert.equal(await reader.getRequestStatus('1'), 'missing');
});

test('IotaCoordinatorReader does not collapse coordinator lookup failures into missing requests', async () => {
  const reader = new IotaCoordinatorReader(
    {
      async getObject() {
        throw new Error('Object not found');
      },
      async getDynamicFieldObject() {
        throw new Error('dynamic field not found');
      },
    },
    '0x42',
    '0xabc',
  );

  await assert.rejects(
    () => reader.getRequestStatus('1'),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'view_failed' &&
      'retryable' in error &&
      error.retryable === true,
  );
});

test('IotaCoordinatorReader reads request status from dynamic fields', async () => {
  const reader = new IotaCoordinatorReader(
    {
      async getObject() {
        return {
          data: {
            content: {
              fields: {
                requests: {
                  fields: {
                    id: {
                      id: '0xfeed',
                    },
                  },
                },
                vrf_public_key: '00',
              },
            },
          },
        };
      },
      async getDynamicFieldObject() {
        return {
          data: {
            content: {
              fields: {
                value: {
                  fields: {
                    status: '1',
                  },
                },
              },
            },
          },
        };
      },
    },
    '0x42',
    '0xabc',
  );

  assert.equal(await reader.getRequestStatus('7'), 'fulfilled');
});

test('classifyCoordinatorReadError preserves retryable rpc failures', () => {
  const error = classifyCoordinatorReadError(new Error('RPC timeout'));
  assert.equal(error.retryable, true);
  assert.equal(error.code, 'view_unavailable');
});

test('classifyCoordinatorReadError marks mainnet view unsupported as terminal', () => {
  const error = classifyCoordinatorReadError(
    new Error('Unsupported Feature: View function calls not supported yet on mainnet'),
  );
  assert.equal(error.retryable, false);
  assert.equal(error.code, 'view_unsupported');
});

test('classifyCoordinatorReadError keeps generic object-not-found failures retryable', () => {
  const error = classifyCoordinatorReadError(new Error('Object not found'));
  assert.equal(error.retryable, true);
  assert.equal(error.code, 'view_failed');
});
