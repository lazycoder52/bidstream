# ADR-006: Prisma Interactive Transactions with Raw SQL for Row-Level Locking

## Context

Prisma ORM offers an intuitive, type-safe API for CRUD operations and migrations. However, standard Prisma query methods (`prisma.auction.findUnique(...)` and `prisma.auction.update(...)`) lack native support for PostgreSQL pessimistic locking clauses (`SELECT ... FOR UPDATE` or `SELECT ... FOR UPDATE SKIP LOCKED`).

Without row-level locking, concurrent transactions executing `findUnique` simultaneously read stale values before issuing conflicting `update` commands, resulting in race conditions and lost updates.

## Considered Options

1. **Prisma Optimistic Concurrency via `@version`**:
   - Add a `@version` integer column and rely on Prisma's generated `UPDATE ... WHERE version = x` syntax.
   - _Drawback_: As evaluated in ADR-001, optimistic locking causes massive transaction abort cascades and severe throughput degradation under high bidding contention.
2. **Abandon Prisma for TypeORM or Raw pg / Kysely**:
   - Replace Prisma entirely with a lower-level query builder that supports `.forUpdate()`.
   - _Drawback_: Loses Prisma's schema migration tooling, intuitive relationship querying, and rapid productivity across the rest of the application.
3. **Prisma Interactive Transactions (`$transaction`) with `$queryRaw`**:
   - Retain Prisma for general querying, schema management, and migrations.
   - In critical concurrency sections (bid placement and auction closing), execute raw SQL locking inside interactive transactions:
     ```typescript
     await prisma.$transaction(async (tx) => {
       const rows = await tx.$queryRaw<LockedAuction[]>`
         SELECT id, status, current_price, min_increment, end_time, seller_id, winner_id, bid_count, version
         FROM auctions
         WHERE id = ${auctionId}::uuid
         FOR UPDATE;
       `;
       // Execute business validations against locked state
       // Perform typed Prisma operations within the same transaction:
       await tx.bid.create({ ... });
       await tx.auction.update({ ... });
     }, {
       isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted
     });
     ```

## Decision

We adopted **Prisma Interactive Transactions combined with `$queryRaw` for Row-Level Locking**.

This hybrid pattern preserves the strengths of both paradigms:

- Strict row-level pessimistic locking (`FOR UPDATE` and `FOR UPDATE SKIP LOCKED`) precisely where contention occurs.
- Type-safe, relational Prisma querying and automatic migrations for the rest of the domain model.

## Consequences

- **Positive**: Complete concurrency safety without abandoning Prisma; optimal database throughput; parameterized SQL prevents injection vulnerabilities.
- **Negative**: Requires manually declared TypeScript interfaces (`interface LockedAuctionRow`) for raw query results; mitigated by centralized definitions in the respective service files.
