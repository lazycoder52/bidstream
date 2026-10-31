# ADR-003: Double-Layer Closing Architecture (BullMQ Delayed Jobs + SKIP LOCKED Sweeper)

## Context

Auctions must transition from `ACTIVE` to `ENDED` at the exact millisecond their `end_time` elapses. If an auction is extended due to anti-sniping rules, the scheduled closing trigger must be dynamically updated. Furthermore, the closing process must resolve the winner based on reserve price constraints, finalize the winning amount, and broadcast the outcome in real time.

A single point of failure in lifecycle management (e.g., Redis restart, worker process crash, delayed job eviction) must never leave an expired auction permanently stuck in the `ACTIVE` state.

## Considered Options

1. **Periodic Cron Polling Only**:
   - Run a periodic cron job every minute: `SELECT * FROM auctions WHERE status = 'ACTIVE' AND end_time <= NOW()`.
   - _Drawback_: Introduces up to 60 seconds of latency after an auction ends before closure occurs, violating the expectation of immediate hammer drop.
2. **BullMQ Delayed Jobs Only**:
   - Schedule a delayed job in BullMQ with `delay = end_time - now`. Reschedule job if anti-sniping triggers.
   - _Drawback_: If Redis undergoes an unexpected restart or queue eviction, delayed jobs could be dropped, leaving auctions permanently unclosed.
3. **Double-Layered Hybrid Architecture (BullMQ Primary + SKIP LOCKED Sweeper Fail-Safe)**:
   - Primary: BullMQ delayed job scheduled for exact auction `end_time`. Rescheduled idempotently using the deterministic job ID `close:auction:{id}`.
   - Secondary Fail-Safe: Periodic background sweeper running every 10 seconds querying overdue auctions using `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 50`.
   - Both layers execute the exact same idempotent database closing routine.

## Decision

We implemented the **Double-Layered Hybrid Lifecycle Engine**.

```
                +----------------------------+
                |  Auction Created/Extended  |
                +----------------------------+
                              |
                              v
             +----------------------------------+
             | Schedule BullMQ Delayed Job      |
             | JobId: `close:auction:${id}`     |
             +----------------------------------+
                              |
              +---------------+---------------+
              |                               |
       (Primary Trigger)              (Fail-Safe Trigger)
              |                               |
              v                               v
    +-------------------+           +-------------------+
    | BullMQ Worker     |           | Periodic Sweeper  |
    | (Exact end_time)  |           | (SKIP LOCKED)     |
    +-------------------+           +-------------------+
              |                               |
              +---------------+---------------+
                              |
                              v
             +----------------------------------+
             |   Idempotent Transaction Close   |
             |   (SELECT ... FOR UPDATE)        |
             |   - Check status == ACTIVE       |
             |   - Check now >= end_time        |
             |   - Check reserve price          |
             |   - Set status = ENDED           |
             |   - Assign winnerId              |
             +----------------------------------+
                              |
                              v
             +----------------------------------+
             | Broadcast `auction:closed` Event |
             +----------------------------------+
```

### Idempotency Enforcement:

Inside the transactional close:

1. Lock row with `SELECT id, status, current_price, reserve_price, end_time, winner_id FROM auctions WHERE id = $id FOR UPDATE`.
2. If `status !== 'ACTIVE'`, exit immediately (already closed).
3. If `now < end_time`, exit immediately (auction was extended by anti-sniping; new job will fire).
4. Identify highest bid: if `reserve_price` is met, set `winner_id = highest_bid.bidder_id`; otherwise `winner_id = null`.
5. Update `status = 'ENDED'`.
6. Emit `auction:closed` via Socket.IO gateway.

## Consequences

- **Positive**: Precise auction close timing on normal execution; zero risk of abandoned auctions if Redis crashes or restarts; multiple workers race safely without double closures or split-brain winners.
- **Negative**: Requires maintenance of two closing trigger mechanisms; fully mitigated by encapsulating closure logic in a single idempotent service method (`LifecycleService.closeAuction`).
