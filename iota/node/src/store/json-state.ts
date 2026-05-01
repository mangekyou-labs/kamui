import * as fs from 'fs/promises';
import * as path from 'path';

import type { EventCursor, PendingRequest, RequestAttemptRecord } from '../types';

interface CursorFileShape {
  cursor: EventCursor | null;
}

interface RequestsFileShape {
  requests: Record<string, RequestAttemptRecord>;
}

function cloneCursor(cursor: EventCursor | null): EventCursor | null {
  return cursor ? { ...cursor } : null;
}

function cloneRequest(request: PendingRequest): PendingRequest {
  return {
    ...request,
    cursor: { ...request.cursor },
  };
}

function cloneRecord(record: RequestAttemptRecord): RequestAttemptRecord {
  return {
    ...record,
    request: cloneRequest(record.request),
  };
}

export class JsonStateStore {
  private cursor: EventCursor | null = null;
  private requests: Record<string, RequestAttemptRecord> = {};

  constructor(private readonly stateDir: string) {}

  async initialize(): Promise<void> {
    await fs.mkdir(this.stateDir, { recursive: true });
    this.cursor = await this.readCursorFile();
    this.requests = await this.readRequestsFile();
  }

  getCursor(): EventCursor | null {
    return cloneCursor(this.cursor);
  }

  getRequest(requestId: string): RequestAttemptRecord | undefined {
    const record = this.requests[requestId];
    return record ? cloneRecord(record) : undefined;
  }

  listDueRetries(now: Date = new Date()): RequestAttemptRecord[] {
    const threshold = now.getTime();
    return Object.values(this.requests)
      .filter(
        (record) =>
          record.status === 'retry' &&
          record.nextRetryAt !== null &&
          Date.parse(record.nextRetryAt) <= threshold,
      )
      .map(cloneRecord)
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
  }

  async saveCursor(cursor: EventCursor | null): Promise<void> {
    this.cursor = cloneCursor(cursor);
    await this.atomicWrite(this.cursorFilePath, JSON.stringify({ cursor: this.cursor }, null, 2));
  }

  async markRetry(
    request: PendingRequest,
    previousAttempts: number,
    error: string,
    nextRetryAt: string,
  ): Promise<void> {
    this.requests[request.requestId] = {
      request: cloneRequest(request),
      status: 'retry',
      attempts: previousAttempts + 1,
      updatedAt: new Date().toISOString(),
      nextRetryAt,
      lastError: error,
      txDigest: null,
    };
    await this.persistRequests();
  }

  async markFulfilled(
    request: PendingRequest,
    attempts: number,
    txDigest: string | null,
  ): Promise<void> {
    this.requests[request.requestId] = {
      request: cloneRequest(request),
      status: 'fulfilled',
      attempts,
      updatedAt: new Date().toISOString(),
      nextRetryAt: null,
      lastError: null,
      txDigest,
    };
    await this.persistRequests();
  }

  async markTerminal(
    request: PendingRequest,
    attempts: number,
    error: string,
  ): Promise<void> {
    this.requests[request.requestId] = {
      request: cloneRequest(request),
      status: 'terminal',
      attempts,
      updatedAt: new Date().toISOString(),
      nextRetryAt: null,
      lastError: error,
      txDigest: null,
    };
    await this.persistRequests();
  }

  private get cursorFilePath(): string {
    return path.join(this.stateDir, 'cursor.json');
  }

  private get requestsFilePath(): string {
    return path.join(this.stateDir, 'requests.json');
  }

  private async readCursorFile(): Promise<EventCursor | null> {
    try {
      const payload = JSON.parse(await fs.readFile(this.cursorFilePath, 'utf8')) as CursorFileShape;
      return payload.cursor ? { ...payload.cursor } : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  private async readRequestsFile(): Promise<Record<string, RequestAttemptRecord>> {
    try {
      const payload = JSON.parse(await fs.readFile(this.requestsFilePath, 'utf8')) as RequestsFileShape;
      return Object.fromEntries(
        Object.entries(payload.requests ?? {}).map(([requestId, record]) => [requestId, cloneRecord(record)]),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {};
      }
      throw error;
    }
  }

  private async persistRequests(): Promise<void> {
    await this.atomicWrite(
      this.requestsFilePath,
      JSON.stringify({ requests: this.requests }, null, 2),
    );
  }

  private async atomicWrite(filePath: string, contents: string): Promise<void> {
    const tempPath = `${filePath}.${process.pid}.tmp`;
    const handle = await fs.open(tempPath, 'w');

    try {
      await handle.writeFile(contents, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }

    await fs.rename(tempPath, filePath);
    await this.syncParentDirectory(filePath);
  }

  private async syncParentDirectory(filePath: string): Promise<void> {
    const directoryHandle = await fs.open(path.dirname(filePath), 'r');

    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  }
}
