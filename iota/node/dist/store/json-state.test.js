"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const promises_1 = require("fs/promises");
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const json_state_1 = require("./json-state");
(0, node_test_1.default)('JsonStateStore persists cursor and request records', async () => {
    const stateDir = await (0, promises_1.mkdtemp)(path.join(os.tmpdir(), 'iota-node-state-'));
    const store = new json_state_1.JsonStateStore(stateDir);
    await store.initialize();
    await store.saveCursor({ txDigest: '0xabc', eventSeq: '7' });
    await store.markRetry({
        requestId: '1',
        subscriptionId: '2',
        requester: '0x3',
        seedHex: 'abcd',
        numWords: 1,
        timestampMs: 123,
        eventId: '0xabc:7',
        cursor: { txDigest: '0xabc', eventSeq: '7' },
        type: '0x1::request::RandomnessRequested',
    }, 0, 'temporary failure', '2099-01-01T00:00:00.000Z');
    const reloaded = new json_state_1.JsonStateStore(stateDir);
    await reloaded.initialize();
    strict_1.default.deepEqual(reloaded.getCursor(), { txDigest: '0xabc', eventSeq: '7' });
    strict_1.default.equal(reloaded.getRequest('1')?.status, 'retry');
    strict_1.default.equal(reloaded.getRequest('1')?.attempts, 1);
});
(0, node_test_1.default)('JsonStateStore fsyncs the state directory after atomic replace', async (t) => {
    const stateDir = await (0, promises_1.mkdtemp)(path.join(os.tmpdir(), 'iota-node-state-'));
    const store = new json_state_1.JsonStateStore(stateDir);
    await store.initialize();
    let directorySyncs = 0;
    const fsModule = require('fs/promises');
    const originalOpen = fsModule.open;
    fsModule.open = async (...args) => {
        const handle = await originalOpen(...args);
        if (args[0] === stateDir) {
            const originalSync = handle.sync.bind(handle);
            handle.sync = async () => {
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
    await store.markTerminal({
        requestId: '2',
        subscriptionId: '3',
        requester: '0x4',
        seedHex: 'dcba',
        numWords: 1,
        timestampMs: 456,
        eventId: '0xdef:8',
        cursor: { txDigest: '0xdef', eventSeq: '8' },
        type: '0x1::request::RandomnessRequested',
    }, 1, 'permanent failure');
    strict_1.default.equal(directorySyncs, 2);
});
