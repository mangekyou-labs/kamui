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
function buildRawEvent(eventSeq, timestampMs) {
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
(0, node_test_1.default)('normalizeSeedHex accepts byte arrays', () => {
    strict_1.default.equal((0, query_events_1.normalizeSeedHex)([0, 1, 255]), '0001ff');
});
(0, node_test_1.default)('normalizeSeedHex accepts hex strings', () => {
    strict_1.default.equal((0, query_events_1.normalizeSeedHex)('0x0A0b'), '0a0b');
});
(0, node_test_1.default)('IotaEventIngestor bootstraps from recent request events only', async () => {
    const now = Date.now();
    const calls = [];
    const ingestor = new query_events_1.IotaEventIngestor({
        async queryEvents(input) {
            calls.push(input);
            return {
                data: [buildRawEvent('10', now), buildRawEvent('9', now - 60000)],
                nextCursor: { txDigest: '0xfeed', eventSeq: '9' },
                hasNextPage: true,
            };
        },
    }, '0x42', 30, 50, noopLogger);
    const page = await ingestor.fetchPage(null);
    strict_1.default.equal(calls.length, 1);
    strict_1.default.deepEqual(calls[0], {
        query: {
            MoveEventType: '0x42::request::RandomnessRequested',
        },
        cursor: undefined,
        limit: 50,
        descendingOrder: true,
    });
    strict_1.default.equal(page.events.length, 1);
    strict_1.default.equal(page.events[0]?.requestId, '10');
    strict_1.default.deepEqual(page.nextCursor, { txDigest: '0xfeed', eventSeq: '10' });
    strict_1.default.equal(page.hasNextPage, false);
});
(0, node_test_1.default)('IotaEventIngestor saves the latest cursor even when bootstrap finds no recent requests', async () => {
    const now = Date.now();
    const ingestor = new query_events_1.IotaEventIngestor({
        async queryEvents() {
            return {
                data: [buildRawEvent('11', now - 60000)],
                nextCursor: { txDigest: '0xfeed', eventSeq: '11' },
                hasNextPage: false,
            };
        },
    }, '0x42', 30, 50, noopLogger);
    const page = await ingestor.fetchPage(null);
    strict_1.default.deepEqual(page.events, []);
    strict_1.default.deepEqual(page.nextCursor, { txDigest: '0xfeed', eventSeq: '11' });
    strict_1.default.equal(page.hasNextPage, false);
});
(0, node_test_1.default)('IotaEventIngestor uses ascending queries after a cursor is established', async () => {
    const calls = [];
    const ingestor = new query_events_1.IotaEventIngestor({
        async queryEvents(input) {
            calls.push(input);
            return {
                data: [buildRawEvent('12', Date.now())],
                nextCursor: { txDigest: '0xfeed', eventSeq: '12' },
                hasNextPage: false,
            };
        },
    }, '0x42', 30, 25, noopLogger);
    const page = await ingestor.fetchPage({ txDigest: '0xfeed', eventSeq: '11' });
    strict_1.default.deepEqual(calls[0], {
        query: {
            MoveEventType: '0x42::request::RandomnessRequested',
        },
        cursor: { txDigest: '0xfeed', eventSeq: '11' },
        limit: 25,
        descendingOrder: false,
    });
    strict_1.default.equal(page.events[0]?.requestId, '12');
    strict_1.default.deepEqual(page.nextCursor, { txDigest: '0xfeed', eventSeq: '12' });
});
