"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FastcryptoCliProver = exports.ProverError = void 0;
exports.parseFastcryptoProveOutput = parseFastcryptoProveOutput;
const child_process_1 = require("child_process");
class ProverError extends Error {
    constructor(code, message, retryable) {
        super(message);
        this.name = 'ProverError';
        this.code = code;
        this.retryable = retryable;
    }
}
exports.ProverError = ProverError;
class FastcryptoCliExitError extends Error {
    constructor(exitCode, signal, stdout, stderr) {
        super(`fastcrypto CLI exited with code ${exitCode ?? 'unknown'}`);
        this.exitCode = exitCode;
        this.signal = signal;
        this.stdout = stdout;
        this.stderr = stderr;
        this.name = 'FastcryptoCliExitError';
    }
}
function assertHexLength(value, expectedLength, name) {
    const normalized = value.trim().toLowerCase();
    if (!/^[0-9a-f]+$/.test(normalized)) {
        throw new ProverError('malformed_stdout', `${name} must be hex encoded.`, false);
    }
    if (normalized.length !== expectedLength) {
        throw new ProverError('malformed_stdout', `${name} must be ${expectedLength} hex characters.`, false);
    }
    return normalized;
}
function parseFastcryptoProveOutput(stdout) {
    const lines = stdout.trim().split('\n');
    const proofLine = lines.find((line) => line.startsWith('Proof:'));
    const outputLine = lines.find((line) => line.startsWith('Output:'));
    if (!proofLine || !outputLine) {
        throw new ProverError('malformed_stdout', 'fastcrypto CLI did not return both Proof and Output lines.', false);
    }
    const proofHex = assertHexLength(proofLine.split(':')[1]?.trim() ?? '', 160, 'Proof');
    const outputHex = assertHexLength(outputLine.split(':')[1]?.trim() ?? '', 128, 'Output');
    return { proofHex, outputHex };
}
function sanitizeCliText(value, secretKey) {
    const redactedSecret = value.split(secretKey).join('[redacted-secret]');
    return redactedSecret
        .replace(/\b[0-9a-f]{64,}\b/gi, '[redacted-hex]')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .join(' | ');
}
function formatCliFailure(error, secretKey) {
    if (error instanceof FastcryptoCliExitError) {
        const status = [];
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
function spawnFastcryptoCli(cliPath, args, stdinData) {
    return new Promise((resolve, reject) => {
        const child = (0, child_process_1.spawn)(cliPath, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout?.setEncoding('utf8');
        child.stdout?.on('data', (chunk) => {
            stdout += chunk;
        });
        child.stderr?.setEncoding('utf8');
        child.stderr?.on('data', (chunk) => {
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
        }
        else {
            child.stdin?.end();
        }
    });
}
function isStdinUnsupportedError(error) {
    if (!(error instanceof FastcryptoCliExitError)) {
        return false;
    }
    const combined = `${error.stderr} ${error.stdout}`;
    return (combined.includes("unexpected argument '--secret-key-stdin'") ||
        combined.includes("unrecognized option '--secret-key-stdin'"));
}
async function executeFastcryptoCli(cliPath, seedHex, secretKey) {
    try {
        return await spawnFastcryptoCli(cliPath, ['prove', '--input', seedHex, '--secret-key-stdin'], secretKey);
    }
    catch (stdinError) {
        if (!isStdinUnsupportedError(stdinError)) {
            throw stdinError;
        }
        // Fallback: older ecvrf-cli versions only support --secret-key on argv.
        return spawnFastcryptoCli(cliPath, ['prove', '--input', seedHex, '--secret-key', secretKey], null);
    }
}
class FastcryptoCliProver {
    constructor(cliPath, secretKey, logger, publicKey = null) {
        this.cliPath = cliPath;
        this.secretKey = secretKey;
        this.logger = logger;
        this.publicKey = publicKey;
    }
    getPublicKey() {
        return this.publicKey;
    }
    async generateProof(seedHex) {
        try {
            const stdout = await executeFastcryptoCli(this.cliPath, seedHex, this.secretKey);
            return parseFastcryptoProveOutput(stdout);
        }
        catch (error) {
            if (error?.code === 'ENOENT') {
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
exports.FastcryptoCliProver = FastcryptoCliProver;
