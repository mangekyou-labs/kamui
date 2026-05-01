# IOTA Network Endpoints & Event Ingestion

## RPC Endpoints

### Mainnet
- **JSON-RPC**: `https://api.mainnet.iota.cafe`
- **WebSocket**: `wss://api.mainnet.iota.cafe`
- **Status**: Production-ready

### Testnet
- **JSON-RPC**: `https://api.testnet.iota.cafe` (assumed pattern)
- **WebSocket**: `wss://api.testnet.iota.cafe` (assumed pattern)
- **Status**: Development/testing

### Third-Party Providers
- Ankr, Monochain offer optimized endpoints with archival node support

## Event Ingestion Strategy

### Recommended Approach: `queryEvents` (Polling)
- **Method**: `iotax_queryEvents` via JSON-RPC
- **Rationale**: Recommended by IOTA; replaces deprecated `subscribeEvent`
- **Features**:
  - Cursor-based pagination for large result sets
  - Event filtering by package, module, type, sender
  - Timestamp support for temporal queries
  - Durable cursor persistence for safe restarts

### Event Structure
```typescript
{
  id: {
    txDigest: string,
    eventSeq: number
  },
  packageId: string,
  transactionModule: string,
  sender: string,
  type: string,
  parsedJson: object,
  bcs: string,
  timestampMs: number
}
```

### Polling Configuration
- **POLL_INTERVAL_MS**: `500` (default, configurable via env)
- **BACKFILL_WINDOW_SEC**: `30` (default, configurable via env)
- **Cursor persistence**: Store last processed event ID to resume after restarts
- **Idempotency**: Track processed request IDs to prevent duplicate fulfillments

## Implementation Notes

### Event Filtering
Filter for `RandomnessRequested` events:
- Package: published `kamui_iota_vrf` package ID
- Module: `request`
- Event type: `kamui_iota_vrf::request::RandomnessRequested`
- Request IDs are emitted as `u64` on-chain and normalized to strings in the TypeScript node

### Cursor Management
- Store cursor (last event ID) in local state (`state/cursor.json` for the current node)
- On restart with a saved cursor: resume forward queries from that cursor
- On first start without a cursor: query `MoveEventType = <package>::request::RandomnessRequested` in descending order and stop once events fall outside `BACKFILL_WINDOW_SEC`
- Handle pagination: continue fetching until no more events

### Error Handling
- RPC failures: exponential backoff with circuit breaker
- Missing events: backfill from last known checkpoint
- Duplicate events: idempotency via request_id tracking
