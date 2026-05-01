"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const coordinator_1 = require("./coordinator");
(0, node_test_1.default)('IotaCoordinatorReader normalizes vrf_public_key from byte arrays', async () => {
    const reader = new coordinator_1.IotaCoordinatorReader({
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
    }, '0x42', '0xabc');
    strict_1.default.equal(await reader.getActiveVrfPublicKey(), '0001ff');
});
(0, node_test_1.default)('IotaCoordinatorReader maps missing requests to the missing state', async () => {
    const reader = new coordinator_1.IotaCoordinatorReader({
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
        async view(_input) {
            return {
                executionError: 'MoveAbort: abort code 7',
            };
        },
    }, '0x42', '0xabc');
    strict_1.default.equal(await reader.getRequestStatus('1'), 'missing');
});
(0, node_test_1.default)('IotaCoordinatorReader does not collapse coordinator lookup failures into missing requests', async () => {
    const reader = new coordinator_1.IotaCoordinatorReader({
        async getObject() {
            throw new Error('Object not found');
        },
        async getDynamicFieldObject() {
            throw new Error('dynamic field not found');
        },
    }, '0x42', '0xabc');
    await strict_1.default.rejects(() => reader.getRequestStatus('1'), (error) => error instanceof Error &&
        'code' in error &&
        error.code === 'view_failed' &&
        'retryable' in error &&
        error.retryable === true);
});
(0, node_test_1.default)('IotaCoordinatorReader reads request status from dynamic fields', async () => {
    const reader = new coordinator_1.IotaCoordinatorReader({
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
    }, '0x42', '0xabc');
    strict_1.default.equal(await reader.getRequestStatus('7'), 'fulfilled');
});
(0, node_test_1.default)('classifyCoordinatorReadError preserves retryable rpc failures', () => {
    const error = (0, coordinator_1.classifyCoordinatorReadError)(new Error('RPC timeout'));
    strict_1.default.equal(error.retryable, true);
    strict_1.default.equal(error.code, 'view_unavailable');
});
(0, node_test_1.default)('classifyCoordinatorReadError marks mainnet view unsupported as terminal', () => {
    const error = (0, coordinator_1.classifyCoordinatorReadError)(new Error('Unsupported Feature: View function calls not supported yet on mainnet'));
    strict_1.default.equal(error.retryable, false);
    strict_1.default.equal(error.code, 'view_unsupported');
});
(0, node_test_1.default)('classifyCoordinatorReadError keeps generic object-not-found failures retryable', () => {
    const error = (0, coordinator_1.classifyCoordinatorReadError)(new Error('Object not found'));
    strict_1.default.equal(error.retryable, true);
    strict_1.default.equal(error.code, 'view_failed');
});
