import type { Logger, ProofResult, Prover } from '../types';

import { spawn } from 'child_process';

export class ProverError extends Error {
  readonly retryable: boolean;
  readonly code: string;

  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = 'ProverError';
    this.code = code;
    this.retryable = retryable;
  }
}

class FastcryptoCliExitError extends Error {
  constructor(
    readonly exitCode: number | null,
    readonly signal: NodeJS.Signals | null,
    readonly stdout: string,
    readonly stderr: string,
  ) {
    super(`fastcrypto CLI exited with code ${exitCode ?? 'unknown'}`);
    this.name = 'FastcryptoCliExitError';
  }
}

function assertHexLength(value: string, expectedLength: number, name: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(normalized)) {
    throw new ProverError('malformed_stdout', `${name} must be hex encoded.`, false);
  }
  if (normalized.length !== expectedLength) {
    throw new ProverError(
      'malformed_stdout',
      `${name} must be ${expectedLength} hex characters.`,
      false,
    );
  }
  return normalized;
}

export function parseFastcryptoProveOutput(stdout: string): ProofResult {
  const lines = stdout.trim().split('\n');
  const proofLine = lines.find((line) => line.startsWith('Proof:'));
  const outputLine = lines.find((line) => line.startsWith('Output:'));

  if (!proofLine || !outputLine) {
    throw new ProverError(
      'malformed_stdout',
      'fastcrypto CLI did not return both Proof and Output lines.',
      false,
    );
  }

  const proofHex = assertHexLength(proofLine.split(':')[1]?.trim() ?? '', 160, 'Proof');
  const outputHex = assertHexLength(outputLine.split(':')[1]?.trim() ?? '', 128, 'Output');

  return { proofHex, outputHex };
}

function sanitizeCliText(value: string, secretKey: string): string {
  const redactedSecret = value.split(secretKey).join('[redacted-secret]');
  return redactedSecret
    .replace(/\b[0-9a-f]{64,}\b/gi, '[redacted-hex]')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(' | ');
}

function formatCliFailure(error: unknown, secretKey: string): string {
  if (error instanceof FastcryptoCliExitError) {
    const status: string[] = [];
    if (error.exitCode !== null) {
      status.push(`exit code ${error.exitCode}`);
    }
    if (error.signal) {
      status.push(`signal ${error.signal}`);
    }

    const details = sanitizeCliText(error.stderr || error.stdout, secretKey);
    if (details) {
      return `fastcrypto CLI failed${status.length > 0 ? ` (${status.join(', ')})` : ''}: ${details}`;
    }

    return `fastcrypto CLI failed${status.length > 0 ? ` (${status.join(', ')})` : ''}.`;
  }

  const message = sanitizeCliText(error instanceof Error ? error.message : String(error), secretKey);
  return message ? `fastcrypto CLI failed: ${message}` : 'fastcrypto CLI failed.';
}

function spawnFastcryptoCli(
  cliPath: string,
  args: string[],
  stdinData: string | null,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cliPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(new FastcryptoCliExitError(code, signal, stdout, stderr));
    });

    child.stdin?.on('error', () => {
      // Ignore broken-pipe races when the CLI exits before consuming stdin.
    });
    if (stdinData !== null) {
      child.stdin?.end(`${stdinData}\n`);
    } else {
      child.stdin?.end();
    }
  });
}

function isStdinUnsupportedError(error: unknown): boolean {
  if (!(error instanceof FastcryptoCliExitError)) {
    return false;
  }
  const combined = `${error.stderr} ${error.stdout}`;
  return (
    combined.includes("unexpected argument '--secret-key-stdin'") ||
    combined.includes("unrecognized option '--secret-key-stdin'")
  );
}

async function executeFastcryptoCli(cliPath: string, seedHex: string, secretKey: string): Promise<string> {
  try {
    return await spawnFastcryptoCli(
      cliPath,
      ['prove', '--input', seedHex, '--secret-key-stdin'],
      secretKey,
    );
  } catch (stdinError) {
    if (!isStdinUnsupportedError(stdinError)) {
      throw stdinError;
    }
    // Fallback: older ecvrf-cli versions only support --secret-key on argv.
    return spawnFastcryptoCli(
      cliPath,
      ['prove', '--input', seedHex, '--secret-key', secretKey],
      null,
    );
  }
}

export class FastcryptoCliProver implements Prover {
  constructor(
    private readonly cliPath: string,
    private readonly secretKey: string,
    private readonly logger: Logger,
    private readonly publicKey: string | null = null,
  ) {}

  getPublicKey(): string | null {
    return this.publicKey;
  }

  async generateProof(seedHex: string): Promise<ProofResult> {
    try {
      const stdout = await executeFastcryptoCli(this.cliPath, seedHex, this.secretKey);
      return parseFastcryptoProveOutput(stdout);
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
        const message = error instanceof Error ? error.message : String(error);
        throw new ProverError('cli_missing', `fastcrypto CLI not found: ${message}`, true);
      }

      if (error instanceof ProverError) {
        throw error;
      }

      const message = formatCliFailure(error, this.secretKey);
      this.logger.warn('fastcrypto prove failed', { error: message });
      throw new ProverError('cli_failed', message, true);
    }
  }
}
