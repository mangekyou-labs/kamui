"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const promises_1 = require("node:fs/promises");
const fastcrypto_1 = require("./fastcrypto");
async function writeExecutableScript(scriptPath, contents) {
    await (0, promises_1.writeFile)(scriptPath, contents);
    await (0, promises_1.chmod)(scriptPath, 0o755);
}
function createTestLogger(warnings) {
    return {
        info() { },
        warn(message, fields) {
            warnings.push({ message, fields });
        },
        error() { },
    };
}
(0, node_test_1.default)('parseFastcryptoProveOutput validates expected lengths', () => {
    const parsed = (0, fastcrypto_1.parseFastcryptoProveOutput)(`Proof: ${'ab'.repeat(80)}\nOutput: ${'cd'.repeat(64)}\n`);
    strict_1.default.equal(parsed.proofHex, 'ab'.repeat(80));
    strict_1.default.equal(parsed.outputHex, 'cd'.repeat(64));
});
(0, node_test_1.default)('parseFastcryptoProveOutput rejects malformed output', () => {
    strict_1.default.throws(() => (0, fastcrypto_1.parseFastcryptoProveOutput)('Proof: deadbeef\nOutput: cafe\n'), fastcrypto_1.ProverError);
});
(0, node_test_1.default)('FastcryptoCliProver sends the VRF secret over stdin instead of argv', async (t) => {
    const root = await (0, promises_1.mkdtemp)(node_path_1.default.join(node_os_1.default.tmpdir(), 'kamui-fastcrypto-'));
    t.after(async () => {
        await (0, promises_1.rm)(root, { recursive: true, force: true });
    });
    const cliPath = node_path_1.default.join(root, 'fake-ecvrf-cli.sh');
    const observedArgsPath = node_path_1.default.join(root, 'observed-args.txt');
    const proofHex = 'ab'.repeat(80);
    const outputHex = 'cd'.repeat(64);
    const secretKey = '11'.repeat(32);
    const seedHex = '22'.repeat(32);
    await writeExecutableScript(cliPath, `#!/bin/sh
set -eu
printf '%s' "$*" > ${JSON.stringify(observedArgsPath)}
secret="$(cat)"
if [ "$secret" != "${secretKey}" ]; then
  echo "unexpected secret from stdin" >&2
  exit 65
fi
printf 'Proof: ${proofHex}\\nOutput: ${outputHex}\\n'
`);
    const warnings = [];
    const prover = new fastcrypto_1.FastcryptoCliProver(cliPath, secretKey, createTestLogger(warnings));
    const proof = await prover.generateProof(seedHex);
    strict_1.default.deepEqual(proof, { proofHex, outputHex });
    strict_1.default.equal(await (0, promises_1.readFile)(observedArgsPath, 'utf8'), `prove --input ${seedHex} --secret-key-stdin`);
    strict_1.default.equal(warnings.length, 0);
});
(0, node_test_1.default)('FastcryptoCliProver redacts secret-bearing CLI failures', async (t) => {
    const root = await (0, promises_1.mkdtemp)(node_path_1.default.join(node_os_1.default.tmpdir(), 'kamui-fastcrypto-'));
    t.after(async () => {
        await (0, promises_1.rm)(root, { recursive: true, force: true });
    });
    const cliPath = node_path_1.default.join(root, 'fake-ecvrf-cli.sh');
    const secretKey = '33'.repeat(32);
    const seedHex = '44'.repeat(32);
    await writeExecutableScript(cliPath, `#!/bin/sh
set -eu
secret="$(cat)"
echo "fatal prove failure for $secret" >&2
exit 12
`);
    const warnings = [];
    const prover = new fastcrypto_1.FastcryptoCliProver(cliPath, secretKey, createTestLogger(warnings));
    await strict_1.default.rejects(prover.generateProof(seedHex), (error) => {
        strict_1.default.ok(error instanceof fastcrypto_1.ProverError);
        strict_1.default.equal(error.code, 'cli_failed');
        strict_1.default.match(error.message, /exit code 12/);
        strict_1.default.doesNotMatch(error.message, new RegExp(secretKey));
        strict_1.default.match(error.message, /\[redacted-(secret|hex)\]/);
        return true;
    });
    strict_1.default.equal(warnings.length, 1);
    strict_1.default.equal(warnings[0]?.message, 'fastcrypto prove failed');
    strict_1.default.doesNotMatch(String(warnings[0]?.fields?.error ?? ''), new RegExp(secretKey));
});
