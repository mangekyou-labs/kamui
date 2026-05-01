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
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const fastcrypto_1 = require("./fastcrypto");
const noopLogger = {
    info() { },
    warn() { },
    error() { },
};
(0, node_test_1.default)('parseFastcryptoProveOutput rejects stdout with only Proof line', () => {
    strict_1.default.throws(() => (0, fastcrypto_1.parseFastcryptoProveOutput)('Proof: ab'), (error) => error instanceof fastcrypto_1.ProverError && error.code === 'malformed_stdout');
});
(0, node_test_1.default)('parseFastcryptoProveOutput rejects stdout with only Output line', () => {
    strict_1.default.throws(() => (0, fastcrypto_1.parseFastcryptoProveOutput)('Output: cd'), (error) => error instanceof fastcrypto_1.ProverError && error.code === 'malformed_stdout');
});
(0, node_test_1.default)('parseFastcryptoProveOutput rejects Proof with wrong hex length (too short)', () => {
    strict_1.default.throws(() => (0, fastcrypto_1.parseFastcryptoProveOutput)('Proof: abcd\nOutput: ' + 'cd'.repeat(64)), (error) => error instanceof fastcrypto_1.ProverError &&
        error.code === 'malformed_stdout' &&
        /Proof must be 160 hex characters/.test(error.message));
});
(0, node_test_1.default)('parseFastcryptoProveOutput rejects Output with wrong hex length (too long)', () => {
    strict_1.default.throws(() => (0, fastcrypto_1.parseFastcryptoProveOutput)('Proof: ' + 'ab'.repeat(80) + '\nOutput: ' + 'cd'.repeat(65)), (error) => error instanceof fastcrypto_1.ProverError &&
        error.code === 'malformed_stdout' &&
        /Output must be 128 hex characters/.test(error.message));
});
(0, node_test_1.default)('parseFastcryptoProveOutput rejects non-hex characters in Proof', () => {
    strict_1.default.throws(() => (0, fastcrypto_1.parseFastcryptoProveOutput)('Proof: ' + 'ab'.repeat(79) + 'GG\nOutput: ' + 'cd'.repeat(64)), (error) => error instanceof fastcrypto_1.ProverError &&
        error.code === 'malformed_stdout');
});
(0, node_test_1.default)('parseFastcryptoProveOutput tolerates trailing whitespace around values', () => {
    const result = (0, fastcrypto_1.parseFastcryptoProveOutput)('Proof:   ' + 'ab'.repeat(80) + '  \n\nOutput: ' + 'cd'.repeat(64) + '  \n');
    strict_1.default.equal(result.proofHex, 'ab'.repeat(80));
    strict_1.default.equal(result.outputHex, 'cd'.repeat(64));
});
(0, node_test_1.default)('parseFastcryptoProveOutput accepts uppercase hex', () => {
    const result = (0, fastcrypto_1.parseFastcryptoProveOutput)('Proof: ' + 'AB'.repeat(80) + '\nOutput: ' + 'CD'.repeat(64));
    strict_1.default.equal(result.proofHex, 'ab'.repeat(80));
    strict_1.default.equal(result.outputHex, 'cd'.repeat(64));
});
(0, node_test_1.default)('parseFastcryptoProveOutput extracts lines from multi-line stdout with extra content', () => {
    const result = (0, fastcrypto_1.parseFastcryptoProveOutput)(`some debug output
Proof: ${'11'.repeat(80)}
another log line
Output: ${'22'.repeat(64)}
final message`);
    strict_1.default.equal(result.proofHex, '11'.repeat(80));
    strict_1.default.equal(result.outputHex, '22'.repeat(64));
});
(0, node_test_1.default)('FastcryptoCliProver falls back to --secret-key argv when --secret-key-stdin is unsupported', async (t) => {
    const { mkdtemp } = await Promise.resolve().then(() => __importStar(require('node:fs/promises')));
    const nodePath = await Promise.resolve().then(() => __importStar(require('node:path')));
    const nodeOs = await Promise.resolve().then(() => __importStar(require('node:os')));
    const { writeFile, chmod, rm, readFile } = await Promise.resolve().then(() => __importStar(require('node:fs/promises')));
    const root = await mkdtemp(nodePath.join(nodeOs.tmpdir(), 'kamui-fastcrypto-fallback-'));
    t.after(async () => { await rm(root, { recursive: true, force: true }); });
    const cliPath = nodePath.join(root, 'ecvrf-cli.sh');
    await writeFile(cliPath, `#!/bin/sh
printf '%s' "$*" > "${nodePath.join(root, 'observed-args.txt')}"
printf 'Proof: ${'ab'.repeat(80)}\\nOutput: ${'cd'.repeat(64)}\\n'
`);
    await chmod(cliPath, 0o755);
    const warnings = [];
    const logger = { ...noopLogger, warn(msg) { warnings.push({ message: msg }); } };
    const prover = new fastcrypto_1.FastcryptoCliProver(cliPath, '11'.repeat(32), logger);
    const proof = await prover.generateProof('22'.repeat(32));
    strict_1.default.equal(proof.proofHex, 'ab'.repeat(80));
    strict_1.default.equal(proof.outputHex, 'cd'.repeat(64));
    const observedArgs = await readFile(nodePath.join(root, 'observed-args.txt'), 'utf8');
    // The first attempt uses --secret-key-stdin (stdin is not read), then it falls back.
    // The fallback will include --secret-key.
    strict_1.default.ok(observedArgs.includes('--secret-key'));
});
(0, node_test_1.default)('FastcryptoCliProver ENOENT is classified as retryable', async (t) => {
    const { mkdtemp } = await Promise.resolve().then(() => __importStar(require('node:fs/promises')));
    const nodePath = await Promise.resolve().then(() => __importStar(require('node:path')));
    const nodeOs = await Promise.resolve().then(() => __importStar(require('node:os')));
    const { rm } = await Promise.resolve().then(() => __importStar(require('node:fs/promises')));
    const root = await mkdtemp(nodePath.join(nodeOs.tmpdir(), 'kamui-fastcrypto-enoent-'));
    t.after(async () => { await rm(root, { recursive: true, force: true }); });
    const prover = new fastcrypto_1.FastcryptoCliProver(nodePath.join(root, 'does-not-exist', 'ecvrf-cli'), '11'.repeat(32), noopLogger);
    await strict_1.default.rejects(prover.generateProof('22'.repeat(32)), (error) => {
        strict_1.default.ok(error instanceof fastcrypto_1.ProverError);
        strict_1.default.equal(error.code, 'cli_missing');
        strict_1.default.equal(error.retryable, true);
        strict_1.default.match(error.message, /fastcrypto CLI not found/);
        return true;
    });
});
