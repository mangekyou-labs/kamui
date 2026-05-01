"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const query_events_1 = require("./query-events");
const noopLogger = {
    info() { },
    warn() { },
    error() { },
};
function buildRawEvent(overrides = {}) {
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
(0, node_test_1.default)('normalizeSeedHex rejects empty string', () => {
    strict_1.default.throws(() => (0, query_events_1.normalizeSeedHex)(''), /seed must be hex encoded/);
});
(0, node_test_1.default)('normalizeSeedHex rejects invalid hex characters', () => {
    strict_1.default.throws(() => (0, query_events_1.normalizeSeedHex)('0xgghh'), /seed must be hex encoded/);
    strict_1.default.throws(() => (0, query_events_1.normalizeSeedHex)('xyz1'), /seed must be hex encoded/);
});
(0, node_test_1.default)('normalizeSeedHex strips 0x prefix and normalizes case', () => {
    strict_1.default.equal((0, query_events_1.normalizeSeedHex)('0x0A0b'), '0a0b');
    strict_1.default.equal((0, query_events_1.normalizeSeedHex)('0XDEADBEEF'), 'deadbeef');
});
(0, node_test_1.default)('normalizeSeedHex accepts odd-length hex strings (no even-length validation)', () => {
    strict_1.default.equal((0, query_events_1.normalizeSeedHex)('0a'), '0a');
    strict_1.default.equal((0, query_events_1.normalizeSeedHex)('0xabc'), 'abc');
    // Note: byte arrays with any length are accepted (no length validation)
    strict_1.default.equal((0, query_events_1.normalizeSeedHex)([0]), '00');
    strict_1.default.equal((0, query_events_1.normalizeSeedHex)([0, 1]), '0001');
    strict_1.default.equal((0, query_events_1.normalizeSeedHex)([0, 1, 2]), '000102');
});
(0, node_test_1.default)('normalizeSeedHex rejects byte arrays with non-integer or out-of-range values', () => {
    strict_1.default.throws(() => (0, query_events_1.normalizeSeedHex)([0, 1, -1]), /seed must be/);
    strict_1.default.throws(() => (0, query_events_1.normalizeSeedHex)([0, 256]), /seed must be/);
    strict_1.default.throws(() => (0, query_events_1.normalizeSeedHex)([1.5]), /seed must be/);
});
(0, node_test_1.default)('normalizeSeedHex rejects empty byte array', () => {
    strict_1.default.equal((0, query_events_1.normalizeSeedHex)([]), '');
});
// ─── IotaEventIngestor edge cases ───────────────────────────────────────────
(0, node_test_1.default)('IotaEventIngestor skips events with non-matching event type', async () => {
    const now = Date.now();
    const ingestor = new query_events_1.IotaEventIngestor({
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
    }, '0x42', 30, 50, noopLogger);
    const page = await ingestor.fetchPage({ txDigest: '0xfeed', eventSeq: '6' });
    strict_1.default.equal(page.events.length, 1);
    strict_1.default.equal(page.events[0]?.requestId, 'ignored');
});
(0, node_test_1.default)('IotaEventIngestor skips events whose id field is missing', async () => {
    const now = Date.now();
    const ingestor = new query_events_1.IotaEventIngestor({
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
    }, '0x42', 30, 50, noopLogger);
    const page = await ingestor.fetchPage({ txDigest: '0xfeed', eventSeq: '6' });
    strict_1.default.equal(page.events.length, 0);
});
(0, node_test_1.default)('IotaEventIngestor handles empty data array', async () => {
    const ingestor = new query_events_1.IotaEventIngestor({
        async queryEvents() {
            return {
                data: [],
                nextCursor: null,
                hasNextPage: false,
            };
        },
    }, '0x42', 30, 50, noopLogger);
    const page = await ingestor.fetchPage({ txDigest: '0xfeed', eventSeq: '6' });
    strict_1.default.equal(page.events.length, 0);
    // Forward fetch keeps existing cursor on empty page when nextCursor is missing.
    strict_1.default.deepEqual(page.nextCursor, { txDigest: '0xfeed', eventSeq: '6' });
    strict_1.default.equal(page.hasNextPage, false);
});
(0, node_test_1.default)('IotaEventIngestor advances cursor on non-empty page even when nextCursor is missing', async () => {
    const now = Date.now();
    const ingestor = new query_events_1.IotaEventIngestor({
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
    }, '0x42', 30, 50, noopLogger);
    const page = await ingestor.fetchPage({ txDigest: '0xfeed', eventSeq: '6' });
    strict_1.default.equal(page.events.length, 1);
    // Regression assertion: fallback should advance to last event cursor.
    strict_1.default.deepEqual(page.nextCursor, { txDigest: '0xfeed', eventSeq: '42' });
    strict_1.default.equal(page.hasNextPage, false);
});
(0, node_test_1.default)('IotaEventIngestor skips events with missing timestampMs during bootstrap windowing', async () => {
    const ingestor = new query_events_1.IotaEventIngestor({
        async queryEvents() {
            return {
                data: [buildRawEvent({ timestampMs: undefined })],
                nextCursor: { txDigest: '0xfeed', eventSeq: '8' },
                hasNextPage: false,
            };
        },
    }, '0x42', 30, 50, noopLogger);
    // Bootstrap path applies backfill filtering; timestamp 0 is older than window.
    const page = await ingestor.fetchPage(null);
    strict_1.default.equal(page.events.length, 0);
});
(0, node_test_1.default)('IotaEventIngestor skips events with non-numeric timestampMs during bootstrap windowing', async () => {
    const ingestor = new query_events_1.IotaEventIngestor({
        async queryEvents() {
            return {
                data: [buildRawEvent({ timestampMs: 'not-a-number' })],
                nextCursor: { txDigest: '0xfeed', eventSeq: '8' },
                hasNextPage: false,
            };
        },
    }, '0x42', 30, 50, noopLogger);
    // Bootstrap path applies backfill filtering; timestamp 0 is older than window.
    const page = await ingestor.fetchPage(null);
    strict_1.default.equal(page.events.length, 0);
});
(0, node_test_1.default)('IotaEventIngestor normalizes num_words from string', async () => {
    const now = Date.now();
    const ingestor = new query_events_1.IotaEventIngestor({
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
    }, '0x42', 30, 50, noopLogger);
    const page = await ingestor.fetchPage(null);
    strict_1.default.equal(page.events.length, 1);
    strict_1.default.equal(page.events[0]?.numWords, 4);
});
(0, node_test_1.default)('IotaEventIngestor rejects malformed num_words', async () => {
    const now = Date.now();
    const ingestor = new query_events_1.IotaEventIngestor({
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
    }, '0x42', 30, 50, noopLogger);
    const page = await ingestor.fetchPage(null);
    strict_1.default.equal(page.events.length, 0);
});
(0, node_test_1.default)('IotaEventIngestor normalizes camelCase request_id and subscription_id fields', async () => {
    const now = Date.now();
    const ingestor = new query_events_1.IotaEventIngestor({
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
    }, '0x42', 30, 50, noopLogger);
    const page = await ingestor.fetchPage(null);
    strict_1.default.equal(page.events.length, 1);
    strict_1.default.equal(page.events[0]?.requestId, '5');
    strict_1.default.equal(page.events[0]?.subscriptionId, '10');
});
