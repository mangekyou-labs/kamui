import { Transaction } from '@iota/iota-sdk/transactions';

import type { Logger, FulfillmentSubmitter, PendingRequest } from '../types';

interface ExecutionStatusView {
  error?: unknown;
  status?: unknown;
}

interface TransactionEffectsView {
  status?: ExecutionStatusView | null;
}

interface TransactionResponseView {
  checkpoint?: unknown;
  digest?: unknown;
  effects?: TransactionEffectsView | null;
}

export class SubmissionError extends Error {
  readonly retryable: boolean;
  readonly code: string;

  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = 'SubmissionError';
    this.code = code;
    this.retryable = retryable;
  }
}

function hexToBytes(hex: string): number[] {
  const normalized = hex.trim().replace(/^0x/i, '').toLowerCase();
  if (!/^[0-9a-f]+$/.test(normalized) || normalized.length % 2 !== 0) {
    throw new SubmissionError('bad_hex', 'Expected an even-length hex string.', false);
  }

  const bytes: number[] = [];
  for (let index = 0; index < normalized.length; index += 2) {
    bytes.push(Number.parseInt(normalized.slice(index, index + 2), 16));
  }
  return bytes;
}

function pureU64(tx: any, value: string): unknown {
  if (tx.pure?.u64) {
    return tx.pure.u64(value);
  }
  return tx.pure(value);
}

function pureVectorU8(tx: any, bytes: number[]): unknown {
  if (tx.pure?.vector) {
    return tx.pure.vector('u8', bytes);
  }
  return tx.pure(bytes);
}

function pureAddress(tx: any, address: string): unknown {
  if (tx.pure?.address) {
    return tx.pure.address(address);
  }
  return tx.pure(address);
}

function deriveOperatorAddress(signer: any): string {
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

export function classifyFulfillmentError(error: unknown): SubmissionError {
  if (error instanceof SubmissionError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  const isTerminalAbort =
    normalized.includes('e_request_not_pending') ||
    normalized.includes('e_invalid_proof') ||
    /\babort code\b[^0-9]*(7|8)\b/.test(normalized) ||
    /\bmoveabort\b[^0-9]*(7|8)\b/.test(normalized);

  if (isTerminalAbort) {
    return new SubmissionError('terminal_abort', message, false);
  }

  return new SubmissionError('transient_failure', message, true);
}

function getExecutionStatus(result: unknown): { error: string | null; status: 'failure' | 'success' } | null {
  if (!result || typeof result !== 'object') {
    return null;
  }

  const effects = (result as TransactionResponseView).effects;
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
    error:
      statusView.error === undefined || statusView.error === null
        ? null
        : String(statusView.error),
  };
}

function hasCheckpoint(result: unknown): boolean {
  if (!result || typeof result !== 'object') {
    return false;
  }

  const checkpoint = (result as TransactionResponseView).checkpoint;
  return checkpoint !== undefined && checkpoint !== null && String(checkpoint) !== '';
}

export class IotaFulfillmentSubmitter implements FulfillmentSubmitter {
  private readonly operatorAddress: string;

  constructor(
    private readonly client: any,
    private readonly signer: any,
    private readonly coordinatorPackageId: string,
    private readonly coordinatorObjectId: string,
    private readonly logger: Logger,
  ) {
    this.operatorAddress = deriveOperatorAddress(signer);
  }

  getOperatorAddress(): string {
    return this.operatorAddress;
  }

  async submitFulfillment(
    request: PendingRequest,
    proofHex: string,
    outputHex: string,
  ): Promise<{ txDigest: string }> {
    try {
      const tx = new Transaction();
      const txAny = tx as any;
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

      const result =
        typeof this.client.signAndExecuteTransaction === 'function'
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

      const txDigest = String((result as { digest?: unknown }).digest ?? '');
      if (!txDigest) {
        throw new SubmissionError(
          'missing_digest',
          'Transaction completed without a digest.',
          true,
        );
      }

      const finalizedResult =
        typeof this.client.waitForTransaction === 'function'
          ? await this.client.waitForTransaction({
              digest: txDigest,
              options: { showEffects: true },
              waitMode: 'checkpoint',
            })
          : result;

      if (!hasCheckpoint(finalizedResult)) {
        throw new SubmissionError(
          'unconfirmed_execution',
          `Transaction ${txDigest} was not checkpointed.`,
          true,
        );
      }

      const executionStatus = getExecutionStatus(finalizedResult);
      if (!executionStatus) {
        throw new SubmissionError(
          'missing_effects',
          `Transaction ${txDigest} did not return execution effects.`,
          true,
        );
      }

      if (executionStatus.status !== 'success') {
        throw classifyFulfillmentError(
          new Error(
            executionStatus.error ?? `Transaction ${txDigest} executed with failure status.`,
          ),
        );
      }

      return { txDigest };
    } catch (error) {
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
