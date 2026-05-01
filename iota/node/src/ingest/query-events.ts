import type { EventCursor, EventIngestor, EventPage, Logger, PendingRequest } from '../types';

const REQUEST_EVENT_SUFFIX = '::request::RandomnessRequested';

interface QueryEventsClient {
  queryEvents(input: unknown): Promise<{
    data?: unknown[];
    nextCursor?: unknown;
    hasNextPage?: boolean;
  }>;
}

interface QueryEventsResponse {
  data?: unknown[];
  nextCursor?: unknown;
  hasNextPage?: boolean;
}

function toCursor(rawCursor: unknown): EventCursor | null {
  if (
    !rawCursor ||
    typeof rawCursor !== 'object' ||
    !('txDigest' in rawCursor) ||
    !('eventSeq' in rawCursor)
  ) {
    return null;
  }

  return {
    txDigest: String((rawCursor as { txDigest: unknown }).txDigest),
    eventSeq: String((rawCursor as { eventSeq: unknown }).eventSeq),
  };
}

function normalizeRequestId(value: unknown, name: string): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  throw new Error(`${name} is missing or invalid.`);
}

function normalizeNumWords(value: unknown): number {
  let parsed: number;
  if (typeof value === 'number') {
    parsed = value;
  } else if (typeof value === 'string' && value.trim() !== '') {
    parsed = Number.parseInt(value, 10);
  } else {
    throw new Error('num_words is missing or invalid.');
  }

  if (!Number.isFinite(parsed)) {
    throw new Error('num_words is missing or invalid.');
  }

  return parsed;
}

function cursorFromRawEvent(rawEvent: unknown): EventCursor | null {
  if (!rawEvent || typeof rawEvent !== 'object' || !('id' in rawEvent)) {
    return null;
  }
  return toCursor((rawEvent as { id?: unknown }).id);
}

export function normalizeSeedHex(seed: unknown): string {
  if (typeof seed === 'string') {
    const normalized = seed.trim().replace(/^0x/i, '').toLowerCase();
    if (!/^[0-9a-f]+$/.test(normalized)) {
      throw new Error('seed must be hex encoded.');
    }
    return normalized;
  }

  if (Array.isArray(seed) && seed.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) {
    return seed
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
  }

  throw new Error('seed must be an array of bytes or hex string.');
}

function parseEvent(event: unknown): PendingRequest | null {
  if (!event || typeof event !== 'object') {
    return null;
  }

  const rawEvent = event as {
    id?: unknown;
    sender?: unknown;
    type?: unknown;
    parsedJson?: Record<string, unknown>;
    timestampMs?: unknown;
  };

  const type = String(rawEvent.type ?? '');
  if (!type.endsWith(REQUEST_EVENT_SUFFIX)) {
    return null;
  }

  const cursor = toCursor(rawEvent.id);
  if (!cursor) {
    throw new Error('event cursor is missing.');
  }

  const parsed = rawEvent.parsedJson ?? {};
  const timestampMs = Number.parseInt(String(rawEvent.timestampMs ?? 0), 10);
  if (!Number.isFinite(timestampMs)) {
    throw new Error('timestampMs is invalid.');
  }

  return {
    requestId: normalizeRequestId(parsed.request_id ?? parsed.requestId, 'request_id'),
    subscriptionId: normalizeRequestId(
      parsed.subscription_id ?? parsed.subscriptionId,
      'subscription_id',
    ),
    requester: String(parsed.requester ?? rawEvent.sender ?? ''),
    seedHex: normalizeSeedHex(parsed.seed),
    numWords: normalizeNumWords(parsed.num_words ?? parsed.numWords),
    timestampMs,
    eventId: `${cursor.txDigest}:${cursor.eventSeq}`,
    cursor,
    type,
  };
}

export class IotaEventIngestor implements EventIngestor {
  private bootstrapped = false;

  constructor(
    private readonly client: QueryEventsClient,
    private readonly packageId: string,
    private readonly backfillWindowSec: number,
    private readonly pageSize: number,
    private readonly logger: Logger,
  ) {}

  private async queryRequestEvents(
    cursor: EventCursor | null,
    descendingOrder: boolean,
  ): Promise<QueryEventsResponse> {
    return this.client.queryEvents({
      query: {
        MoveEventType: `${this.packageId}${REQUEST_EVENT_SUFFIX}`,
      },
      cursor: cursor ?? undefined,
      limit: this.pageSize,
      descendingOrder,
    } as unknown);
  }

  private parseEvents(rawEvents: unknown[]): PendingRequest[] {
    const events: PendingRequest[] = [];

    for (const rawEvent of rawEvents) {
      try {
        const event = parseEvent(rawEvent);
        if (!event) {
          continue;
        }
        events.push(event);
      } catch (error) {
        this.logger.warn('Skipping malformed event', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return events;
  }

  private async fetchForwardPage(cursor: EventCursor | null): Promise<EventPage> {
    const result = await this.queryRequestEvents(cursor, false);
    const events = this.parseEvents(result.data ?? []);

    return {
      events,
      nextCursor:
        toCursor(result.nextCursor) ??
        (events.length > 0 ? events[events.length - 1].cursor : cursor),
      hasNextPage: Boolean(result.hasNextPage),
    };
  }

  private async fetchBootstrapPage(): Promise<EventPage> {
    const minTimestamp = Date.now() - this.backfillWindowSec * 1_000;
    const recentEvents: PendingRequest[] = [];
    let latestSeenCursor: EventCursor | null = null;
    let cursor: EventCursor | null = null;

    while (true) {
      const result = await this.queryRequestEvents(cursor, true);
      const rawEvents = result.data ?? [];

      if (latestSeenCursor === null) {
        for (const rawEvent of rawEvents) {
          const rawCursor = cursorFromRawEvent(rawEvent);
          if (rawCursor) {
            latestSeenCursor = rawCursor;
            break;
          }
        }
      }

      let reachedBackfillBoundary = false;
      for (const rawEvent of rawEvents) {
        try {
          const event = parseEvent(rawEvent);
          if (!event) {
            continue;
          }
          if (event.timestampMs < minTimestamp) {
            reachedBackfillBoundary = true;
            break;
          }
          recentEvents.push(event);
        } catch (error) {
          this.logger.warn('Skipping malformed event', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (reachedBackfillBoundary || !result.hasNextPage) {
        break;
      }

      const nextCursor = toCursor(result.nextCursor);
      if (!nextCursor) {
        break;
      }
      cursor = nextCursor;
    }

    recentEvents.reverse();

    return {
      events: recentEvents,
      nextCursor:
        recentEvents.length > 0 ? recentEvents[recentEvents.length - 1].cursor : latestSeenCursor,
      hasNextPage: false,
    };
  }

  async fetchPage(cursor: EventCursor | null): Promise<EventPage> {
    if (cursor === null && !this.bootstrapped) {
      const page = await this.fetchBootstrapPage();
      this.bootstrapped = true;
      return page;
    }

    return this.fetchForwardPage(cursor);
  }
}
