"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IotaFulfillmentSubmitter = exports.SubmissionError = void 0;
exports.classifyFulfillmentError = classifyFulfillmentError;
const transactions_1 = require("@iota/iota-sdk/transactions");
class SubmissionError extends Error {
    constructor(code, message, retryable) {
        super(message);
        this.name = 'SubmissionError';
        this.code = code;
        this.retryable = retryable;
    }
}
exports.SubmissionError = SubmissionError;
function hexToBytes(hex) {
    const normalized = hex.trim().replace(/^0x/i, '').toLowerCase();
    if (!/^[0-9a-f]+$/.test(normalized) || normalized.length % 2 !== 0) {
        throw new SubmissionError('bad_hex', 'Expected an even-length hex string.', false);
    }
    const bytes = [];
    for (let index = 0; index < normalized.length; index += 2) {
        bytes.push(Number.parseInt(normalized.slice(index, index + 2), 16));
    }
    return bytes;
}
function pureU64(tx, value) {
    if (tx.pure?.u64) {
        return tx.pure.u64(value);
    }
    return tx.pure(value);
}
function pureVectorU8(tx, bytes) {
    if (tx.pure?.vector) {
        return tx.pure.vector('u8', bytes);
    }
    return tx.pure(bytes);
}
function pureAddress(tx, address) {
    if (tx.pure?.address) {
        return tx.pure.address(address);
    }
    return tx.pure(address);
}
function deriveOperatorAddress(signer) {
    if (typeof signer?.toIotaAddress === 'function') {
        return signer.toIotaAddress();
    }
    if (typeof signer?.getPublicKey === 'function') {
        const publicKey = signer.getPublicKey();
        if (typeof publicKey?.toIotaAddress === 'function') {
            return publicKey.toIotaAddress();
        }
    }
    throw new Error('Unable to derive operator address from signer.');
}
function classifyFulfillmentError(error) {
    if (error instanceof SubmissionError) {
        return error;
    }
    const message = error instanceof Error ? error.message : String(error);
    const normalized = message.toLowerCase();
    const isTerminalAbort = normalized.includes('e_request_not_pending') ||
        normalized.includes('e_invalid_proof') ||
        /\babort code\b[^0-9]*(7|8)\b/.test(normalized) ||
        /\bmoveabort\b[^0-9]*(7|8)\b/.test(normalized);
    if (isTerminalAbort) {
        return new SubmissionError('terminal_abort', message, false);
    }
    return new SubmissionError('transient_failure', message, true);
}
function getExecutionStatus(result) {
    if (!result || typeof result !== 'object') {
        return null;
    }
    const effects = result.effects;
    if (!effects || typeof effects !== 'object') {
        return null;
    }
    const statusView = effects.status;
    if (!statusView || typeof statusView !== 'object') {
        return null;
    }
    const status = statusView.status;
    if (status !== 'success' && status !== 'failure') {
        return null;
    }
    return {
        status,
        error: statusView.error === undefined || statusView.error === null
            ? null
            : String(statusView.error),
    };
}
function hasCheckpoint(result) {
    if (!result || typeof result !== 'object') {
        return false;
    }
    const checkpoint = result.checkpoint;
    return checkpoint !== undefined && checkpoint !== null && String(checkpoint) !== '';
}
class IotaFulfillmentSubmitter {
    constructor(client, signer, coordinatorPackageId, coordinatorObjectId, logger) {
        this.client = client;
        this.signer = signer;
        this.coordinatorPackageId = coordinatorPackageId;
        this.coordinatorObjectId = coordinatorObjectId;
        this.logger = logger;
        this.operatorAddress = deriveOperatorAddress(signer);
    }
    getOperatorAddress() {
        return this.operatorAddress;
    }
    async submitFulfillment(request, proofHex, outputHex) {
        try {
            const tx = new transactions_1.Transaction();
            const txAny = tx;
            const rewardCoin = txAny.moveCall({
                target: `${this.coordinatorPackageId}::coordinator::fulfill_randomness`,
                arguments: [
                    txAny.object(this.coordinatorObjectId),
                    pureU64(txAny, request.requestId),
                    pureVectorU8(txAny, hexToBytes(proofHex)),
                    pureVectorU8(txAny, hexToBytes(outputHex)),
                ],
            });
            txAny.transferObjects([rewardCoin], pureAddress(txAny, this.operatorAddress));
            const result = typeof this.client.signAndExecuteTransaction === 'function'
                ? await this.client.signAndExecuteTransaction({
                    signer: this.signer,
                    transaction: tx,
                    options: { showEffects: true },
                })
                : await this.client.signAndExecuteTransactionBlock({
                    signer: this.signer,
                    transactionBlock: tx,
                    options: { showEffects: true },
                });
            const txDigest = String(result.digest ?? '');
            if (!txDigest) {
                throw new SubmissionError('missing_digest', 'Transaction completed without a digest.', true);
            }
            const finalizedResult = typeof this.client.waitForTransaction === 'function'
                ? await this.client.waitForTransaction({
                    digest: txDigest,
                    options: { showEffects: true },
                    waitMode: 'checkpoint',
                })
                : result;
            if (!hasCheckpoint(finalizedResult)) {
                throw new SubmissionError('unconfirmed_execution', `Transaction ${txDigest} was not checkpointed.`, true);
            }
            const executionStatus = getExecutionStatus(finalizedResult);
            if (!executionStatus) {
                throw new SubmissionError('missing_effects', `Transaction ${txDigest} did not return execution effects.`, true);
            }
            if (executionStatus.status !== 'success') {
                throw classifyFulfillmentError(new Error(executionStatus.error ?? `Transaction ${txDigest} executed with failure status.`));
            }
            return { txDigest };
        }
        catch (error) {
            const classified = classifyFulfillmentError(error);
            this.logger.warn('fulfill transaction failed', {
                request_id: request.requestId,
                error: classified.message,
                retryable: classified.retryable,
            });
            throw classified;
        }
    }
}
exports.IotaFulfillmentSubmitter = IotaFulfillmentSubmitter;
