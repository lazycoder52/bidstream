# ADR-002: Idempotency Keys Design and Storage

## Context

In real-time financial and auction platforms, network instability frequently leads to duplicate HTTP requests (e.g. client retries on TCP timeout, mobile network switching, double-click submissions). If a user bids \$150 and their client retries upon a dropped connection, the backend must never apply the bid twice or reject the retry with a misleading error if the original bid succeeded.

## Considered Options

1. **Redis Cache with Key TTL**:
   - Cache `Idempotency-Key` -> serialized response in Redis with a 24-hour expiration.
   - _Drawback_: If the database transaction rolls back, or if Redis restarts or drops data, the system loses the guarantee of exact-once execution and atomicity with the database record.
2. **Database Table with Interactive Transaction Coupling**:
   - Dedicated `idempotency_keys` table in PostgreSQL storing `key` (unique index), `target` route, `response_status`, `response_body` (JSONB), `created_at`, and `expires_at`.
   - Read key before transaction to return fast cached responses on completed operations.
   - Verify and insert key inside the exact same atomic transaction that inserts the bid.

## Decision

We implemented **Database-Backed Idempotency Keys coupled to PostgreSQL Interactive Transactions**.

### Execution Lifecycle:

1. **Pre-flight Check**: Check `idempotency_keys` before acquiring row locks. If an unexpired record exists, return the stored JSON response immediately without locking the auction row.
2. **Transactional Lock & Persistence**: Inside the `SELECT ... FOR UPDATE` transaction, verify the key again and insert the new record alongside the `bid` and `auction` update. If a concurrent retry races into the transaction, the unique constraint on `key` aborts the duplicate.
3. **Response Replay**: Retried requests receive the original HTTP status code (201 Created) and the exact original response payload, eliminating client-side confusion.

## Consequences

- **Positive**: Exact-once bid placement semantics guaranteed even under hostile network partition and aggressive automated retry behavior.
- **Negative**: Adds a storage footprint for completed keys; mitigated by indexed `expires_at` timestamp allowing periodic background cleanup of records older than 24 hours.
