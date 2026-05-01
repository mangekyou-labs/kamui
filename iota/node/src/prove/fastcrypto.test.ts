import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

import type { Logger } from '../types';

import { FastcryptoCliProver, parseFastcryptoProveOutput, ProverError } from './fastcrypto';

async function writeExecutableScript(scriptPath: string, contents: string): Promise<void> {
  await writeFile(scriptPath, contents);
  await chmod(scriptPath, 0o755);
}

function createTestLogger(warnings: Array<{ message: string; fields?: Record<string, unknown> }>): Logger {
  return {
    info() {},
    warn(message, fields) {
      warnings.push({ message, fields });
    },
    error() {},
  };
}

test('parseFastcryptoProveOutput validates expected lengths', () => {
  const parsed = parseFastcryptoProveOutput(
    `Proof: ${'ab'.repeat(80)}\nOutput: ${'cd'.repeat(64)}\n`,
  );

  assert.equal(parsed.proofHex, 'ab'.repeat(80));
  assert.equal(parsed.outputHex, 'cd'.repeat(64));
});

test('parseFastcryptoProveOutput rejects malformed output', () => {
  assert.throws(
    () => parseFastcryptoProveOutput('Proof: deadbeef\nOutput: cafe\n'),
    ProverError,
  );
});

test('FastcryptoCliProver sends the VRF secret over stdin instead of argv', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kamui-fastcrypto-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const cliPath = path.join(root, 'fake-ecvrf-cli.sh');
  const observedArgsPath = path.join(root, 'observed-args.txt');
  const proofHex = 'ab'.repeat(80);
  const outputHex = 'cd'.repeat(64);
  const secretKey = '11'.repeat(32);
  const seedHex = '22'.repeat(32);

  await writeExecutableScript(
    cliPath,
    `#!/bin/sh
set -eu
printf '%s' "$*" > ${JSON.stringify(observedArgsPath)}
secret="$(cat)"
if [ "$secret" != "${secretKey}" ]; then
  echo "unexpected secret from stdin" >&2
  exit 65
fi
printf 'Proof: ${proofHex}\\nOutput: ${outputHex}\\n'
`,
  );

  const warnings: Array<{ message: string; fields?: Record<string, unknown> }> = [];
  const prover = new FastcryptoCliProver(cliPath, secretKey, createTestLogger(warnings));
  const proof = await prover.generateProof(seedHex);

  assert.deepEqual(proof, { proofHex, outputHex });
  assert.equal(
    await readFile(observedArgsPath, 'utf8'),
    `prove --input ${seedHex} --secret-key-stdin`,
  );
  assert.equal(warnings.length, 0);
});

test('FastcryptoCliProver redacts secret-bearing CLI failures', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kamui-fastcrypto-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const cliPath = path.join(root, 'fake-ecvrf-cli.sh');
  const secretKey = '33'.repeat(32);
  const seedHex = '44'.repeat(32);

  await writeExecutableScript(
    cliPath,
    `#!/bin/sh
set -eu
secret="$(cat)"
echo "fatal prove failure for $secret" >&2
exit 12
`,
  );

  const warnings: Array<{ message: string; fields?: Record<string, unknown> }> = [];
  const prover = new FastcryptoCliProver(cliPath, secretKey, createTestLogger(warnings));

  await assert.rejects(
    prover.generateProof(seedHex),
    (error: unknown) => {
      assert.ok(error instanceof ProverError);
      assert.equal(error.code, 'cli_failed');
      assert.match(error.message, /exit code 12/);
      assert.doesNotMatch(error.message, new RegExp(secretKey));
      assert.match(error.message, /\[redacted-(secret|hex)\]/);
      return true;
    },
  );

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.message, 'fastcrypto prove failed');
  assert.doesNotMatch(String(warnings[0]?.fields?.error ?? ''), new RegExp(secretKey));
});
