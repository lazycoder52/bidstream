# ADR-001: Pessimistic Row Locking (SELECT ... FOR UPDATE) vs Optimistic Versioning

## Context

High-concurrency real-time bidding presents an extreme contention profile: hundreds or thousands of concurrent bidders compete on the exact same auction row during the final seconds of a listing. Every bid placement transaction must:

1. Assert the auction is still open (`status = ACTIVE` and `now < end_time`).
2. Assert the bidder is not the seller and does not already hold the highest bid.
3. Assert the incoming amount satisfies `amount >= current_price + min_increment`.
4. Atomically insert into an append-only `bids` ledger table.
5. Update the auction row (`current_price`, `bid_count`, `winner_id`, `version`, `end_time`).

Under intense load (e.g., 500 concurrent virtual users bidding simultaneously), the choice of concurrency control model determines whether the system maintains absolute data integrity or collapses under transaction abort storms.

## Considered Options

1. **Optimistic Concurrency Control (OCC) with Version / CAS**:
   - Each transaction reads `version`, validates bid logic in memory, and commits with `UPDATE auctions SET current_price = $amount, version = version + 1 WHERE id = $id AND version = $old_version`.
   - _Advantage_: Non-blocking reads, zero lock contention in low-contention domains.
   - _Drawback_: Under intense contention (hundreds of concurrent bids on one auction), $N - 1$ out of $N$ concurrent transactions fail due to version mismatch. With retry storms, most concurrent writers fail and must retry, database CPU spikes due to wasted transaction attempts, and retry queues exhaust server memory.
2. **In-Memory Redis Lock (Redlock / Distributed Lock)**:
   - Acquire a distributed lock in Redis per auction before beginning a PostgreSQL transaction.
   - _Advantage_: Offloads locking coordination to Redis.
   - _Drawback_: Introduces dual-phase commit hazards. If Redis fails or clock skews occur, split-brain conditions allow concurrent Postgres transactions to overlap. Lock expiration timeouts (TTL) risk releasing locks while Postgres queries are still executing.
3. **Pessimistic Row-Level Locking (`SELECT ... FOR UPDATE`) in PostgreSQL**:
   - Begin an interactive transaction with `Read Committed` isolation level.
   - Execute `SELECT * FROM auctions WHERE id = $id FOR UPDATE`.
   - Subsequent transactions attempting to lock the same row block cleanly in the Postgres lock queue (serialized by a row lock ordered by arrival) until the owning transaction commits or aborts.
   - _Advantage_: Guarantees strictly serialized execution at the row level without retries or abort cascades. Clean lock lifecycle tied directly to the database transaction boundary.
   - _Drawback_: Locks are held for the duration of the transaction; requires transactions to be strictly minimal (pure DB operations, zero external HTTP calls).

## Decision

We adopted **Pessimistic Row-Level Locking (`SELECT ... FOR UPDATE`) inside PostgreSQL interactive transactions**.

All external network operations (e.g. BullMQ job rescheduling, Socket.IO broadcasts) are strictly decoupled and executed **after** the transaction commits. The transaction footprint is restricted to:

- Idempotency key verification.
- `SELECT ... FOR UPDATE` row lock.
- Memory validation against locked state.
- Append-only bid insertion.
- Auction update and idempotency key persistence.

## Consequences

- **Positive**: Zero lost updates under extreme concurrency. The row lock serializes bids per auction, which keeps accepted bids strictly increasing; load results are in README Results.
- **Negative**: Long-running or stalled transactions would block other bidders on that specific auction; mitigated by setting transaction statement timeouts (`SET LOCAL statement_timeout = 2000`) and ensuring zero non-database side-effects occur inside the transaction block.
