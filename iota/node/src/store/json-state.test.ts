import * as fs from 'fs/promises';
import { mkdtemp } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { JsonStateStore } from './json-state';

test('JsonStateStore persists cursor and request records', async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'iota-node-state-'));
  const store = new JsonStateStore(stateDir);
  await store.initialize();

  await store.saveCursor({ txDigest: '0xabc', eventSeq: '7' });
  await store.markRetry(
    {
      requestId: '1',
      subscriptionId: '2',
      requester: '0x3',
      seedHex: 'abcd',
      numWords: 1,
      timestampMs: 123,
      eventId: '0xabc:7',
      cursor: { txDigest: '0xabc', eventSeq: '7' },
      type: '0x1::request::RandomnessRequested',
    },
    0,
    'temporary failure',
    '2099-01-01T00:00:00.000Z',
  );

  const reloaded = new JsonStateStore(stateDir);
  await reloaded.initialize();

  assert.deepEqual(reloaded.getCursor(), { txDigest: '0xabc', eventSeq: '7' });
  assert.equal(reloaded.getRequest('1')?.status, 'retry');
  assert.equal(reloaded.getRequest('1')?.attempts, 1);
});

test('JsonStateStore fsyncs the state directory after atomic replace', async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'iota-node-state-'));
  const store = new JsonStateStore(stateDir);
  await store.initialize();

  let directorySyncs = 0;
  const fsModule = require('fs/promises') as typeof fs;
  const originalOpen = fsModule.open;

  fsModule.open = async (...args: Parameters<typeof fs.open>) => {
    const handle = await originalOpen(...args);

    if (args[0] === stateDir) {
      const originalSync = handle.sync.bind(handle);
      (handle as typeof handle & { sync: typeof handle.sync }).sync = async () => {
        directorySyncs += 1;
        return originalSync();
      };
    }

    return handle;
  };
  t.after(() => {
    fsModule.open = originalOpen;
  });

  await store.saveCursor({ txDigest: '0xdef', eventSeq: '8' });
  await store.markTerminal(
    {
      requestId: '2',
      subscriptionId: '3',
      requester: '0x4',
      seedHex: 'dcba',
      numWords: 1,
      timestampMs: 456,
      eventId: '0xdef:8',
      cursor: { txDigest: '0xdef', eventSeq: '8' },
      type: '0x1::request::RandomnessRequested',
    },
    1,
    'permanent failure',
  );

  assert.equal(directorySyncs, 2);
});
