"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const coordinator_1 = require("./coordinator");
(0, node_test_1.default)('classifyCoordinatorReadError returns already-classified errors unchanged', () => {
    const original = new coordinator_1.CoordinatorReadError('request_missing', 'boom', false);
    strict_1.default.equal((0, coordinator_1.classifyCoordinatorReadError)(original), original);
});
(0, node_test_1.default)('classifyCoordinatorReadError normalizes error message case-insensitively', () => {
    const rpcError = (0, coordinator_1.classifyCoordinatorReadError)(new Error('NETWORK TIMEOUT'));
    strict_1.default.equal(rpcError.retryable, true);
    strict_1.default.equal(rpcError.code, 'view_unavailable');
    const abort7 = (0, coordinator_1.classifyCoordinatorReadError)(new Error('E_REQUEST_NOT_PENDING'));
    strict_1.default.equal(abort7.retryable, false);
    strict_1.default.equal(abort7.code, 'request_missing');
    const fieldNotFound = (0, coordinator_1.classifyCoordinatorReadError)(new Error('Dynamic field not found'));
    strict_1.default.equal(fieldNotFound.retryable, false);
    strict_1.default.equal(fieldNotFound.code, 'request_missing');
    const unsupported = (0, coordinator_1.classifyCoordinatorReadError)(new Error('UNSUPPORTED FEATURE'));
    strict_1.default.equal(unsupported.retryable, false);
    strict_1.default.equal(unsupported.code, 'view_unsupported');
});
(0, node_test_1.default)('classifyCoordinatorReadError handles abort code 7 in regex patterns', () => {
    // Standard format: 'MoveAbort: abort code 7'
    const error = (0, coordinator_1.classifyCoordinatorReadError)(new Error('MoveAbort: abort code 7'));
    strict_1.default.equal(error.retryable, false);
    strict_1.default.equal(error.code, 'request_missing');
    // Lowercase variant also works
    const raw7 = (0, coordinator_1.classifyCoordinatorReadError)(new Error('moveabort: abort code 7'));
    strict_1.default.equal(raw7.retryable, false);
    strict_1.default.equal(raw7.code, 'request_missing');
});
(0, node_test_1.default)('classifyCoordinatorReadError default case is retryable', () => {
    const error = (0, coordinator_1.classifyCoordinatorReadError)(new Error('something completely unrelated'));
    strict_1.default.equal(error.retryable, true);
    strict_1.default.equal(error.code, 'view_failed');
});
(0, node_test_1.default)('IotaCoordinatorReader returns invalid_view_response when functionReturnValues is empty', async () => {
    const reader = new coordinator_1.IotaCoordinatorReader({
        async view() {
            return {
                functionReturnValues: [],
            };
        },
    }, '0x42', '0xabc');
    await strict_1.default.rejects(() => reader.getRequestStatus('1'), (error) => error instanceof coordinator_1.CoordinatorReadError &&
        error.code === 'invalid_view_response' &&
        error.retryable === false);
});
(0, node_test_1.default)('IotaCoordinatorReader classifies unknown executionError strings as retryable view_failed', async () => {
    // An executionError string that doesn't match any known pattern falls through to view_failed
    const reader = new coordinator_1.IotaCoordinatorReader({
        async view() {
            return {
                executionError: 'something unknown',
            };
        },
    }, '0x42', '0xabc');
    await strict_1.default.rejects(() => reader.getRequestStatus('1'), (error) => error instanceof coordinator_1.CoordinatorReadError &&
        error.code === 'view_failed' &&
        error.retryable === true);
});
(0, node_test_1.default)('IotaCoordinatorReader propagates getObject failures as retryable view_failed', async () => {
    // getObject failures are retryable (network/disk errors) rather than view_unavailable
    const reader = new coordinator_1.IotaCoordinatorReader({
        async getObject() {
            throw new Error('Object not found');
        },
    }, '0x42', '0xabc');
    await strict_1.default.rejects(() => reader.getActiveVrfPublicKey(), (error) => error instanceof coordinator_1.CoordinatorReadError &&
        error.code === 'view_failed' &&
        error.retryable === true);
});
(0, node_test_1.default)('IotaCoordinatorReader maps unsupported status values to error', async () => {
    const reader = new coordinator_1.IotaCoordinatorReader({
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
    }, '0x42', '0xabc');
    await strict_1.default.rejects(() => reader.getRequestStatus('1'), (error) => error instanceof coordinator_1.CoordinatorReadError &&
        error.code === 'invalid_view_value' &&
        error.retryable === false);
});
