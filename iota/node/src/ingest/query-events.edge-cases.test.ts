import test from 'node:test';
import assert from 'node:assert/strict';

import { IotaEventIngestor, normalizeSeedHex } from './query-events';

const noopLogger = {
  info() {},
  warn() {},
  error() {},
};

function buildRawEvent(overrides: Partial<{
  id: unknown;
  type: string;
  parsedJson: Record<string, unknown>;
  timestampMs: unknown;
  sender: string;
}> = {}) {
  return {
    id: { txDigest: '0xfeed', eventSeq: '7' },
    type: '0x42::request::RandomnessRequested',
    parsedJson: {
      request_id: '7',
      subscription_id: '3',
      requester: '0xabc',
      seed: '0a0b',
      num_words: 1,
    },
    timestampMs: Date.now(),
    ...overrides,
  };
}

// ─── normalizeSeedHex edge cases ─────────────────────────────────────────────

test('normalizeSeedHex rejects empty string', () => {
  assert.throws(() => normalizeSeedHex(''), /seed must be hex encoded/);
});

test('normalizeSeedHex rejects invalid hex characters', () => {
  assert.throws(() => normalizeSeedHex('0xgghh'), /seed must be hex encoded/);
  assert.throws(() => normalizeSeedHex('xyz1'), /seed must be hex encoded/);
});

test('normalizeSeedHex strips 0x prefix and normalizes case', () => {
  assert.equal(normalizeSeedHex('0x0A0b'), '0a0b');
  assert.equal(normalizeSeedHex('0XDEADBEEF'), 'deadbeef');
});

test('normalizeSeedHex accepts odd-length hex strings (no even-length validation)', () => {
  assert.equal(normalizeSeedHex('0a'), '0a');
  assert.equal(normalizeSeedHex('0xabc'), 'abc');
  // Note: byte arrays with any length are accepted (no length validation)
  assert.equal(normalizeSeedHex([0]), '00');
  assert.equal(normalizeSeedHex([0, 1]), '0001');
  assert.equal(normalizeSeedHex([0, 1, 2]), '000102');
});

test('normalizeSeedHex rejects byte arrays with non-integer or out-of-range values', () => {
  assert.throws(() => normalizeSeedHex([0, 1, -1] as number[]), /seed must be/);
  assert.throws(() => normalizeSeedHex([0, 256] as number[]), /seed must be/);
  assert.throws(() => normalizeSeedHex([1.5] as number[]), /seed must be/);
});

test('normalizeSeedHex rejects empty byte array', () => {
  assert.equal(normalizeSeedHex([]), '');
});

// ─── IotaEventIngestor edge cases ───────────────────────────────────────────

test('IotaEventIngestor skips events with non-matching event type', async () => {
  const now = Date.now();
  const ingestor = new IotaEventIngestor(
    {
      async queryEvents() {
        return {
          data: [
            buildRawEvent({ type: '0x42::request::RandomnessFulfilled' }),
            {
              id: { txDigest: '0xfeed', eventSeq: '99' },
              type: '0x42::request::RandomnessRequested',
              parsedJson: { request_id: 'ignored', subscription_id: '1', requester: '0xabc', seed: '00', num_words: 1 },
              timestampMs: now,
            },
            buildRawEvent({ type: '0x99::something::Else' }),
          ],
          nextCursor: { txDigest: '0xfeed', eventSeq: '7' },
          hasNextPage: false,
        };
      },
    },
    '0x42',
    30,
    50,
    noopLogger,
  );

  const page = await ingestor.fetchPage({ txDigest: '0xfeed', eventSeq: '6' });
  assert.equal(page.events.length, 1);
  assert.equal(page.events[0]?.requestId, 'ignored');
});

test('IotaEventIngestor skips events whose id field is missing', async () => {
  const now = Date.now();
  const ingestor = new IotaEventIngestor(
    {
      async queryEvents() {
        return {
          data: [
            buildRawEvent({ id: null }),
            buildRawEvent({ id: { txDigest: '0xfeed' } }),
            buildRawEvent({ id: {} }),
          ],
          nextCursor: null,
          hasNextPage: false,
        };
      },
    },
    '0x42',
    30,
    50,
    noopLogger,
  );

  const page = await ingestor.fetchPage({ txDigest: '0xfeed', eventSeq: '6' });
  assert.equal(page.events.length, 0);
});

test('IotaEventIngestor handles empty data array', async () => {
  const ingestor = new IotaEventIngestor(
    {
      async queryEvents() {
        return {
          data: [],
          nextCursor: null,
          hasNextPage: false,
        };
      },
    },
    '0x42',
    30,
    50,
    noopLogger,
  );

  const page = await ingestor.fetchPage({ txDigest: '0xfeed', eventSeq: '6' });
  assert.equal(page.events.length, 0);
  // Forward fetch keeps existing cursor on empty page when nextCursor is missing.
  assert.deepEqual(page.nextCursor, { txDigest: '0xfeed', eventSeq: '6' });
  assert.equal(page.hasNextPage, false);
});

test('IotaEventIngestor advances cursor on non-empty page even when nextCursor is missing', async () => {
  const now = Date.now();
  const ingestor = new IotaEventIngestor(
    {
      async queryEvents() {
        return {
          data: [
            {
              id: { txDigest: '0xfeed', eventSeq: '42' },
              type: '0x42::request::RandomnessRequested',
              parsedJson: {
                request_id: '42',
                subscription_id: '1',
                requester: '0xabc',
                seed: 'deadbeef',
                num_words: 1,
              },
              timestampMs: now,
            },
          ],
          nextCursor: null,
          hasNextPage: false,
        };
      },
    },
    '0x42',
    30,
    50,
    noopLogger,
  );

  const page = await ingestor.fetchPage({ txDigest: '0xfeed', eventSeq: '6' });
  assert.equal(page.events.length, 1);
  // Regression assertion: fallback should advance to last event cursor.
  assert.deepEqual(page.nextCursor, { txDigest: '0xfeed', eventSeq: '42' });
  assert.equal(page.hasNextPage, false);
});

test('IotaEventIngestor skips events with missing timestampMs during bootstrap windowing', async () => {
  const ingestor = new IotaEventIngestor(
    {
      async queryEvents() {
        return {
          data: [buildRawEvent({ timestampMs: undefined })],
          nextCursor: { txDigest: '0xfeed', eventSeq: '8' },
          hasNextPage: false,
        };
      },
    },
    '0x42',
    30,
    50,
    noopLogger,
  );

  // Bootstrap path applies backfill filtering; timestamp 0 is older than window.
  const page = await ingestor.fetchPage(null);
  assert.equal(page.events.length, 0);
});

test('IotaEventIngestor skips events with non-numeric timestampMs during bootstrap windowing', async () => {
  const ingestor = new IotaEventIngestor(
    {
      async queryEvents() {
        return {
          data: [buildRawEvent({ timestampMs: 'not-a-number' })],
          nextCursor: { txDigest: '0xfeed', eventSeq: '8' },
          hasNextPage: false,
        };
      },
    },
    '0x42',
    30,
    50,
    noopLogger,
  );

  // Bootstrap path applies backfill filtering; timestamp 0 is older than window.
  const page = await ingestor.fetchPage(null);
  assert.equal(page.events.length, 0);
});

test('IotaEventIngestor normalizes num_words from string', async () => {
  const now = Date.now();
  const ingestor = new IotaEventIngestor(
    {
      async queryEvents() {
        return {
          data: [
            {
              id: { txDigest: '0xfeed', eventSeq: '9' },
              type: '0x42::request::RandomnessRequested',
              parsedJson: {
                request_id: '9',
                subscription_id: '1',
                requester: '0xabc',
                seed: 'deadbeef',
                num_words: '4',
              },
              timestampMs: now,
            },
          ],
          nextCursor: { txDigest: '0xfeed', eventSeq: '9' },
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
  assert.equal(page.events.length, 1);
  assert.equal(page.events[0]?.numWords, 4);
});

test('IotaEventIngestor rejects malformed num_words', async () => {
  const now = Date.now();
  const ingestor = new IotaEventIngestor(
    {
      async queryEvents() {
        return {
          data: [
            {
              id: { txDigest: '0xfeed', eventSeq: '9' },
              type: '0x42::request::RandomnessRequested',
              parsedJson: {
                request_id: '9',
                subscription_id: '1',
                requester: '0xabc',
                seed: 'deadbeef',
                num_words: 'not-a-number',
              },
              timestampMs: now,
            },
          ],
          nextCursor: { txDigest: '0xfeed', eventSeq: '9' },
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
  assert.equal(page.events.length, 0);
});

test('IotaEventIngestor normalizes camelCase request_id and subscription_id fields', async () => {
  const now = Date.now();
  const ingestor = new IotaEventIngestor(
    {
      async queryEvents() {
        return {
          data: [
            {
              id: { txDigest: '0xfeed', eventSeq: '5' },
              type: '0x42::request::RandomnessRequested',
              parsedJson: {
                requestId: '5', // camelCase variant
                subscriptionId: '10', // camelCase variant
                requester: '0xcamel',
                seed: 'dead',
                num_words: 2,
              },
              timestampMs: now,
            },
          ],
          nextCursor: { txDigest: '0xfeed', eventSeq: '5' },
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
  assert.equal(page.events.length, 1);
  assert.equal(page.events[0]?.requestId, '5');
  assert.equal(page.events[0]?.subscriptionId, '10');
});
