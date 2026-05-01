import test from 'node:test';
import assert from 'node:assert/strict';

import { IotaEventIngestor, normalizeSeedHex } from './query-events';

const noopLogger = {
  info() {},
  warn() {},
  error() {},
};

function buildRawEvent(eventSeq: string, timestampMs: number) {
  return {
    id: { txDigest: '0xfeed', eventSeq },
    type: '0x42::request::RandomnessRequested',
    parsedJson: {
      request_id: eventSeq,
      subscription_id: '7',
      requester: '0xabc',
      seed: '0a0b',
      num_words: 1,
    },
    timestampMs: String(timestampMs),
  };
}

test('normalizeSeedHex accepts byte arrays', () => {
  assert.equal(normalizeSeedHex([0, 1, 255]), '0001ff');
});

test('normalizeSeedHex accepts hex strings', () => {
  assert.equal(normalizeSeedHex('0x0A0b'), '0a0b');
});

test('IotaEventIngestor bootstraps from recent request events only', async () => {
  const now = Date.now();
  const calls: unknown[] = [];
  const ingestor = new IotaEventIngestor(
    {
      async queryEvents(input: unknown) {
        calls.push(input);
        return {
          data: [buildRawEvent('10', now), buildRawEvent('9', now - 60_000)],
          nextCursor: { txDigest: '0xfeed', eventSeq: '9' },
          hasNextPage: true,
        };
      },
    },
    '0x42',
    30,
    50,
    noopLogger,
  );

  const page = await ingestor.fetchPage(null);

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    query: {
      MoveEventType: '0x42::request::RandomnessRequested',
    },
    cursor: undefined,
    limit: 50,
    descendingOrder: true,
  });
  assert.equal(page.events.length, 1);
  assert.equal(page.events[0]?.requestId, '10');
  assert.deepEqual(page.nextCursor, { txDigest: '0xfeed', eventSeq: '10' });
  assert.equal(page.hasNextPage, false);
});

test('IotaEventIngestor saves the latest cursor even when bootstrap finds no recent requests', async () => {
  const now = Date.now();
  const ingestor = new IotaEventIngestor(
    {
      async queryEvents() {
        return {
          data: [buildRawEvent('11', now - 60_000)],
          nextCursor: { txDigest: '0xfeed', eventSeq: '11' },
          hasNextPage: false,
        };
      },
    },
    '0x42',
    30,
    50,
    noopLogger,
  );

  const page = await ingestor.fetchPage(null);

  assert.deepEqual(page.events, []);
  assert.deepEqual(page.nextCursor, { txDigest: '0xfeed', eventSeq: '11' });
  assert.equal(page.hasNextPage, false);
});

test('IotaEventIngestor uses ascending queries after a cursor is established', async () => {
  const calls: unknown[] = [];
  const ingestor = new IotaEventIngestor(
    {
      async queryEvents(input: unknown) {
        calls.push(input);
        return {
          data: [buildRawEvent('12', Date.now())],
          nextCursor: { txDigest: '0xfeed', eventSeq: '12' },
          hasNextPage: false,
        };
      },
    },
    '0x42',
    30,
    25,
    noopLogger,
  );

  const page = await ingestor.fetchPage({ txDigest: '0xfeed', eventSeq: '11' });

  assert.deepEqual(calls[0], {
    query: {
      MoveEventType: '0x42::request::RandomnessRequested',
    },
    cursor: { txDigest: '0xfeed', eventSeq: '11' },
    limit: 25,
    descendingOrder: false,
  });
  assert.equal(page.events[0]?.requestId, '12');
  assert.deepEqual(page.nextCursor, { txDigest: '0xfeed', eventSeq: '12' });
});
