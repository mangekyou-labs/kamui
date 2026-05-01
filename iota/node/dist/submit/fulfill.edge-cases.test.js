"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const fulfill_1 = require("./fulfill");
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
    return { toIotaAddress: () => '0x1111111111111111111111111111111111111111111111111111111111111111' };
}
const noopLogger = {
    info() { },
    warn() { },
    error() { },
};
// ─── classifyFulfillmentError ────────────────────────────────────────────────
(0, node_test_1.default)('classifyFulfillmentError marks invalid proof abort as terminal', () => {
    const error = (0, fulfill_1.classifyFulfillmentError)(new Error('MoveAbort: abort code 8'));
    strict_1.default.equal(error.retryable, false);
    strict_1.default.equal(error.code, 'terminal_abort');
});
(0, node_test_1.default)('classifyFulfillmentError matches standard abort code 7 format', () => {
    // Standard IOTA format: 'MoveAbort: abort code 7'
    const error = (0, fulfill_1.classifyFulfillmentError)(new Error('MoveAbort: abort code 7'));
    strict_1.default.equal(error.retryable, false);
    strict_1.default.equal(error.code, 'terminal_abort');
});
(0, node_test_1.default)('classifyFulfillmentError preserves SubmissionError instances', () => {
    const original = new fulfill_1.SubmissionError('missing_digest', 'no digest', true);
    strict_1.default.equal((0, fulfill_1.classifyFulfillmentError)(original), original);
});
(0, node_test_1.default)('classifyFulfillmentError default case is retryable', () => {
    const error = (0, fulfill_1.classifyFulfillmentError)(new Error('some unexpected RPC error'));
    strict_1.default.equal(error.retryable, true);
    strict_1.default.equal(error.code, 'transient_failure');
});
// ─── IotaFulfillmentSubmitter edge cases ─────────────────────────────────────
(0, node_test_1.default)('IotaFulfillmentSubmitter rejects when checkpoint is absent and waitForTransaction is missing', async () => {
    const client = {
        async signAndExecuteTransaction() {
            return { digest: '0xdeadbeef', checkpoint: null };
        },
    };
    const submitter = new fulfill_1.IotaFulfillmentSubmitter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client, createSigner(), '0xpackage', '0xcoordinator', noopLogger);
    await strict_1.default.rejects(() => submitter.submitFulfillment(request, 'ab'.repeat(80), 'cd'.repeat(64)), (error) => error instanceof fulfill_1.SubmissionError &&
        error.code === 'unconfirmed_execution' &&
        error.retryable === true);
});
(0, node_test_1.default)('IotaFulfillmentSubmitter rejects when signAndExecuteTransaction returns no digest', async () => {
    const client = { async signAndExecuteTransaction() { return {}; } };
    const submitter = new fulfill_1.IotaFulfillmentSubmitter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client, createSigner(), '0xpackage', '0xcoordinator', noopLogger);
    await strict_1.default.rejects(() => submitter.submitFulfillment(request, 'ab'.repeat(80), 'cd'.repeat(64)), (error) => error instanceof fulfill_1.SubmissionError &&
        error.code === 'missing_digest' &&
        error.retryable === true);
});
(0, node_test_1.default)('IotaFulfillmentSubmitter throws unconfirmed_execution when effects are absent in waitForTransaction', async () => {
    // When waitForTransaction is present but returns no checkpoint, hasCheckpoint returns false.
    // This triggers 'unconfirmed_execution', not 'missing_effects'.
    const client = {
        async signAndExecuteTransaction() { return { digest: '0xdeadbeef' }; },
        async waitForTransaction() { return {}; }, // no checkpoint
    };
    const submitter = new fulfill_1.IotaFulfillmentSubmitter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client, createSigner(), '0xpackage', '0xcoordinator', noopLogger);
    await strict_1.default.rejects(() => submitter.submitFulfillment(request, 'ab'.repeat(80), 'cd'.repeat(64)), (error) => error instanceof fulfill_1.SubmissionError &&
        error.code === 'unconfirmed_execution' &&
        error.retryable === true);
});
(0, node_test_1.default)('IotaFulfillmentSubmitter derives operator address from public key when toIotaAddress is absent', () => {
    const signer = {
        getPublicKey() {
            return {
                toIotaAddress() {
                    return '0x2222222222222222222222222222222222222222222222222222222222222222';
                },
            };
        },
    };
    const submitter = new fulfill_1.IotaFulfillmentSubmitter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    {}, signer, '0xpackage', '0xcoordinator', noopLogger);
    strict_1.default.equal(submitter.getOperatorAddress(), '0x2222222222222222222222222222222222222222222222222222222222222222');
});
(0, node_test_1.default)('IotaFulfillmentSubmitter throws when operator address cannot be derived', () => {
    const signer = {};
    strict_1.default.throws(() => new fulfill_1.IotaFulfillmentSubmitter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    {}, signer, '0xpackage', '0xcoordinator', noopLogger), /Unable to derive operator address/);
});
(0, node_test_1.default)('IotaFulfillmentSubmitter classifies unknown abort codes as retryable', async () => {
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
    const submitter = new fulfill_1.IotaFulfillmentSubmitter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client, createSigner(), '0xpackage', '0xcoordinator', noopLogger);
    await strict_1.default.rejects(() => submitter.submitFulfillment(request, 'ab'.repeat(80), 'cd'.repeat(64)), (error) => error instanceof fulfill_1.SubmissionError &&
        error.code === 'transient_failure' &&
        error.retryable === true);
});
(0, node_test_1.default)('IotaFulfillmentSubmitter rethrows network errors as retryable', async () => {
    const client = {
        async signAndExecuteTransaction() { throw new Error('ECONNREFUSED'); },
    };
    const submitter = new fulfill_1.IotaFulfillmentSubmitter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client, createSigner(), '0xpackage', '0xcoordinator', noopLogger);
    await strict_1.default.rejects(() => submitter.submitFulfillment(request, 'ab'.repeat(80), 'cd'.repeat(64)), (error) => error instanceof fulfill_1.SubmissionError && error.retryable === true);
});
// hexToBytes is called synchronously inside the async submitFulfillment method.
// The error is thrown after the Transaction API is called (inside moveCall),
// which means it surfaces as a rejected promise.
(0, node_test_1.default)('IotaFulfillmentSubmitter hexToBytes rejects odd-length proof hex via promise rejection', async () => {
    const client = {
        async signAndExecuteTransaction() { return { digest: '0xdeadbeef' }; },
        async waitForTransaction() {
            return { digest: '0xdeadbeef', checkpoint: '42', effects: { status: { status: 'success' } } };
        },
    };
    const submitter = new fulfill_1.IotaFulfillmentSubmitter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client, createSigner(), '0xpackage', '0xcoordinator', noopLogger);
    await strict_1.default.rejects(() => submitter.submitFulfillment(request, 'z', 'cafe'), // odd-length proof hex
    (error) => error instanceof fulfill_1.SubmissionError && error.code === 'bad_hex');
});
(0, node_test_1.default)('IotaFulfillmentSubmitter hexToBytes rejects non-hex characters in output via promise rejection', async () => {
    const client = {
        async signAndExecuteTransaction() { return { digest: '0xdeadbeef' }; },
        async waitForTransaction() {
            return { digest: '0xdeadbeef', checkpoint: '42', effects: { status: { status: 'success' } } };
        },
    };
    const submitter = new fulfill_1.IotaFulfillmentSubmitter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client, createSigner(), '0xpackage', '0xcoordinator', noopLogger);
    await strict_1.default.rejects(
    // Valid-length proof (160 hex chars), but output contains non-hex chars (GGGG)
    () => submitter.submitFulfillment(request, 'ab'.repeat(80), 'GGGG'), (error) => error instanceof fulfill_1.SubmissionError && error.code === 'bad_hex');
});
