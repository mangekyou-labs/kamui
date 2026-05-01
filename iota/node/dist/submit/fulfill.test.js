"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const fulfill_1 = require("./fulfill");
const noopLogger = {
    info() { },
    warn() { },
    error() { },
};
const request = {
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
    return {
        toIotaAddress() {
            return '0x1111111111111111111111111111111111111111111111111111111111111111';
        },
    };
}
(0, node_test_1.default)('classifyFulfillmentError marks request-not-pending aborts terminal', () => {
    const error = (0, fulfill_1.classifyFulfillmentError)(new Error('MoveAbort: abort code 7'));
    strict_1.default.equal(error.retryable, false);
    strict_1.default.equal(error.code, 'terminal_abort');
});
(0, node_test_1.default)('classifyFulfillmentError keeps RPC failures retryable', () => {
    const error = (0, fulfill_1.classifyFulfillmentError)(new Error('RPC timeout'));
    strict_1.default.equal(error.retryable, true);
});
(0, node_test_1.default)('classifyFulfillmentError preserves SubmissionError instances', () => {
    const original = new fulfill_1.SubmissionError('bad_hex', 'bad hex', false);
    strict_1.default.equal((0, fulfill_1.classifyFulfillmentError)(original), original);
});
(0, node_test_1.default)('IotaFulfillmentSubmitter waits for checkpointed success before returning', async () => {
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
    const submitter = new fulfill_1.IotaFulfillmentSubmitter(client, createSigner(), '0xpackage', '0xcoordinator', noopLogger);
    const result = await submitter.submitFulfillment(request, 'ab'.repeat(80), 'cd'.repeat(64));
    strict_1.default.equal(result.txDigest, '0xdeadbeef');
});
(0, node_test_1.default)('IotaFulfillmentSubmitter rejects checkpointed failed transactions even when they have a digest', async () => {
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
    const submitter = new fulfill_1.IotaFulfillmentSubmitter(client, createSigner(), '0xpackage', '0xcoordinator', noopLogger);
    await strict_1.default.rejects(() => submitter.submitFulfillment(request, 'ab'.repeat(80), 'cd'.repeat(64)), (error) => error instanceof fulfill_1.SubmissionError &&
        error.code === 'terminal_abort' &&
        error.retryable === false);
});
