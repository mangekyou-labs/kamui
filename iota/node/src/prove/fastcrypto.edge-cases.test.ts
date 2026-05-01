import test from 'node:test';
import assert from 'node:assert/strict';

import type { Logger } from '../types';
import {
  FastcryptoCliProver,
  parseFastcryptoProveOutput,
  ProverError,
} from './fastcrypto';

const noopLogger: Logger = {
  info() {},
  warn() {},
  error() {},
};

test('parseFastcryptoProveOutput rejects stdout with only Proof line', () => {
  assert.throws(
    () => parseFastcryptoProveOutput('Proof: ab'),
    (error: unknown) =>
      error instanceof ProverError && error.code === 'malformed_stdout',
  );
});

test('parseFastcryptoProveOutput rejects stdout with only Output line', () => {
  assert.throws(
    () => parseFastcryptoProveOutput('Output: cd'),
    (error: unknown) =>
      error instanceof ProverError && error.code === 'malformed_stdout',
  );
});

test('parseFastcryptoProveOutput rejects Proof with wrong hex length (too short)', () => {
  assert.throws(
    () => parseFastcryptoProveOutput('Proof: abcd\nOutput: ' + 'cd'.repeat(64)),
    (error: unknown) =>
      error instanceof ProverError &&
      error.code === 'malformed_stdout' &&
      /Proof must be 160 hex characters/.test(error.message),
  );
});

test('parseFastcryptoProveOutput rejects Output with wrong hex length (too long)', () => {
  assert.throws(
    () => parseFastcryptoProveOutput('Proof: ' + 'ab'.repeat(80) + '\nOutput: ' + 'cd'.repeat(65)),
    (error: unknown) =>
      error instanceof ProverError &&
      error.code === 'malformed_stdout' &&
      /Output must be 128 hex characters/.test(error.message),
  );
});

test('parseFastcryptoProveOutput rejects non-hex characters in Proof', () => {
  assert.throws(
    () => parseFastcryptoProveOutput('Proof: ' + 'ab'.repeat(79) + 'GG\nOutput: ' + 'cd'.repeat(64)),
    (error: unknown) =>
      error instanceof ProverError &&
      error.code === 'malformed_stdout',
  );
});

test('parseFastcryptoProveOutput tolerates trailing whitespace around values', () => {
  const result = parseFastcryptoProveOutput(
    'Proof:   ' + 'ab'.repeat(80) + '  \n\nOutput: ' + 'cd'.repeat(64) + '  \n',
  );
  assert.equal(result.proofHex, 'ab'.repeat(80));
  assert.equal(result.outputHex, 'cd'.repeat(64));
});

test('parseFastcryptoProveOutput accepts uppercase hex', () => {
  const result = parseFastcryptoProveOutput(
    'Proof: ' + 'AB'.repeat(80) + '\nOutput: ' + 'CD'.repeat(64),
  );
  assert.equal(result.proofHex, 'ab'.repeat(80));
  assert.equal(result.outputHex, 'cd'.repeat(64));
});

test('parseFastcryptoProveOutput extracts lines from multi-line stdout with extra content', () => {
  const result = parseFastcryptoProveOutput(
    `some debug output
Proof: ${'11'.repeat(80)}
another log line
Output: ${'22'.repeat(64)}
final message`,
  );
  assert.equal(result.proofHex, '11'.repeat(80));
  assert.equal(result.outputHex, '22'.repeat(64));
});

test('FastcryptoCliProver falls back to --secret-key argv when --secret-key-stdin is unsupported', async (t) => {
  const { mkdtemp } = await import('node:fs/promises');
  const nodePath = await import('node:path');
  const nodeOs = await import('node:os');
  const { writeFile, chmod, rm, readFile } = await import('node:fs/promises');

  const root = await mkdtemp(nodePath.join(nodeOs.tmpdir(), 'kamui-fastcrypto-fallback-'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });

  const cliPath = nodePath.join(root, 'ecvrf-cli.sh');
  await writeFile(
    cliPath,
    `#!/bin/sh
printf '%s' "$*" > "${nodePath.join(root, 'observed-args.txt')}"
printf 'Proof: ${'ab'.repeat(80)}\\nOutput: ${'cd'.repeat(64)}\\n'
`,
  );
  await chmod(cliPath, 0o755);

  const warnings: Array<{ message: string }> = [];
  const logger: Logger = { ...noopLogger, warn(msg: string) { warnings.push({ message: msg }); } };
  const prover = new FastcryptoCliProver(cliPath, '11'.repeat(32), logger);

  const proof = await prover.generateProof('22'.repeat(32));

  assert.equal(proof.proofHex, 'ab'.repeat(80));
  assert.equal(proof.outputHex, 'cd'.repeat(64));

  const observedArgs = await readFile(nodePath.join(root, 'observed-args.txt'), 'utf8');
  // The first attempt uses --secret-key-stdin (stdin is not read), then it falls back.
  // The fallback will include --secret-key.
  assert.ok(observedArgs.includes('--secret-key'));
});

test('FastcryptoCliProver ENOENT is classified as retryable', async (t) => {
  const { mkdtemp } = await import('node:fs/promises');
  const nodePath = await import('node:path');
  const nodeOs = await import('node:os');
  const { rm } = await import('node:fs/promises');

  const root = await mkdtemp(nodePath.join(nodeOs.tmpdir(), 'kamui-fastcrypto-enoent-'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });

  const prover = new FastcryptoCliProver(
    nodePath.join(root, 'does-not-exist', 'ecvrf-cli'),
    '11'.repeat(32),
    noopLogger,
  );

  await assert.rejects(
    prover.generateProof('22'.repeat(32)),
    (error: unknown) => {
      assert.ok(error instanceof ProverError);
      assert.equal(error.code, 'cli_missing');
      assert.equal(error.retryable, true);
      assert.match(error.message, /fastcrypto CLI not found/);
      return true;
    },
  );
});
