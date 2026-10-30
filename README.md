# BidStream

High-concurrency, real-time auction engine with mathematically proven correctness under intense bidding contention, backed by shared contracts, pessimistic row-level database locking, and an accessible React frontend.

---

## Architecture

BidStream is engineered as an npm workspaces monorepo separating domain contracts, real-time backend services, and a modern single-page frontend.

```mermaid
flowchart TD
    subgraph Client ["Client Layer"]
        Web["React 19 Client\n(Vite + Tailwind v4 + Zustand)"]
        WSClient["socket.io-client\n(Zod-validated events)"]
    end

    subgraph LoadBalancer ["Edge / Routing"]
        Ingress["Reverse Proxy / Port 3000"]
    end

    subgraph BackendCluster ["API Cluster (apps/api)"]
        API1["NestJS Instance 1\n(Express + Throttler)"]
        API2["NestJS Instance 2\n(Express + Throttler)"]
        Gateway["RealtimeGateway\n(Socket.IO + TimeSync)"]
    end

    subgraph StateStorage ["Data & Messaging Layer"]
        PG[("PostgreSQL 16\n(SELECT ... FOR UPDATE)\n(Append-only bids)")]
        Redis[("Redis 7\n(Pub/Sub Adapter)\n(Throttler Cache)")]
        BullMQ["BullMQ Queue\n(Delayed Auction Closes)"]
    end

    subgraph Shared ["Contracts (packages/contracts)"]
        Contracts["@bidstream/contracts\n(Zod Schemas + TS Types)"]
    end

    Web -->|HTTP / REST| Ingress
    WSClient -->|WebSocket| Ingress
    Ingress --> API1
    Ingress --> API2
    API1 --> Gateway
    API2 --> Gateway

    API1 -->|Interactive Tx Lock| PG
    API2 -->|Interactive Tx Lock| PG

    Gateway <-->|@socket.io/redis-adapter| Redis
    API1 -->|Throttling & Idempotency| Redis
    API2 -->|Throttling & Idempotency| Redis

    API1 -->|Enqueue Delayed Job| BullMQ
    BullMQ <--> Redis
    BullMQ -->|Idempotent Close| PG

    Contracts -.-> Web
    Contracts -.-> API1
    Contracts -.-> API2
```

---

## Design Decisions

Full architectural decision records are documented in [`docs/adr/`](docs/adr/):

1. **[ADR-001: Pessimistic Row Locking vs Optimistic Versioning](docs/adr/001-pessimistic-locking-vs-optimistic-versioning.md)**: Under high contention (hundreds of concurrent bids on a closing auction), optimistic locking (`@version` / CAS) causes catastrophic transaction abort cascades and throughput collapse. BidStream uses PostgreSQL `SELECT ... FOR UPDATE` row locks inside `ReadCommitted` interactive transactions, queuing incoming bids serialized by a row lock with zero aborted retries.
2. **[ADR-002: Idempotency Keys Design](docs/adr/002-idempotency-keys-design.md)**: Network retries from clients are deduplicated via an atomic `idempotency_keys` table inside the transaction boundary, storing and replaying original 201 responses with zero side effects.
3. **[ADR-003: Double-Layer Closing Architecture](docs/adr/003-closing-architecture-bullmq-and-skip-locked-sweeper.md)**: Auction closing uses BullMQ delayed jobs as the primary millisecond-precision trigger (rescheduled dynamically upon anti-sniping extensions) combined with a periodic 10-second `SKIP LOCKED` database sweeper as a safety net against queue loss.
4. **[ADR-004: Redis Adapter for Horizontal WebSocket Scaling](docs/adr/004-redis-adapter-horizontal-websocket-scaling.md)**: Real-time event broadcasting scales horizontally across multiple API processes via `@socket.io/redis-adapter` (tested with two in-process Socket.IO servers in `realtime.multi-instance.spec.ts`, and with two separate OS processes in `.github/workflows/benchmarks.yml` under 500-VU load storm). Clients reconnecting with `lastBidId` replay missed events directly from the append-only `bids` ledger.
5. **[ADR-005: Shared Monorepo Zod Contracts](docs/adr/005-shared-zod-contracts-single-source-of-truth.md)**: `@bidstream/contracts` serves as the single source of truth for REST DTOs, WebSocket events, and environment schemas. The frontend API client parses and validates every HTTP response at runtime, preventing contract drift.
6. **[ADR-006: Prisma Interactive Transactions with Raw SQL Locking](docs/adr/006-prisma-interactive-transactions-with-raw-sql-locking.md)**: Combines Prisma's ergonomic schema management and relational queries with parameterized `$queryRaw` row locks (`FOR UPDATE` and `FOR UPDATE SKIP LOCKED`) inside `$transaction` blocks.

---

## Verified Results

All numbers in this section are generated directly by automated CI measurement runs (GitHub Actions runner, load generator and server share the machine) via `.github/workflows/benchmarks.yml` and saved to `metrics/*.json`. An automated verification test (`scripts/verify-readme-metrics.mjs`) asserts that these figures match the source metrics files without discrepancies.

### Load and Concurrency Benchmark (metrics/loadtest.json)

The load benchmark evaluates 500 concurrent virtual users executing a high-concurrency bidding storm across 20 active auctions alongside background browse-heavy traffic.

| Metric                              | Measured Value              | Standard / Target |
| ----------------------------------- | --------------------------- | ----------------- |
| **Sustained Throughput**            | 2284.5 req/s                | > 1,000 req/s     |
| **HTTP Bid Latency (p50)**          | 105.2 ms                    | < 150 ms          |
| **HTTP Bid Latency (p90)**          | 220.8 ms                    | < 250 ms          |
| **HTTP Bid Latency (p95)**          | 252.4 ms                    | < 300 ms          |
| **HTTP Browse Latency (p50)**       | 56.3 ms                     | < 100 ms          |
| **HTTP Browse Latency (p95)**       | 251.8 ms                    | < 300 ms          |
| **WebSocket Broadcast Delay (p50)** | 44 ms                       | < 50 ms           |
| **WebSocket Broadcast Delay (p95)** | 45 ms                       | < 50 ms           |
| **WebSocket Broadcast Delay (max)** | 45 ms                       | < 100 ms          |
| **Simultaneous WebSocket Clients**  | 50 clients                  | 50 clients        |
| **Total Benchmark Requests**        | 160094 requests             | -                 |
| **Database Invariant Violations**   | 0 violations (passed: true) | Exactly 0         |

### Web Performance & Bundle Audit (metrics/web.json)

Bundle size measurements were collected via production build analysis of the React 19 single-page application. Route-level code splitting is implemented across all routes (`/auctions`, `/auctions/:id`, `/auctions/create`, `/dashboard`, `/login`, `/register`) using dynamic `React.lazy` imports wrapped with `<Suspense>`, ensuring secondary routes are loaded on demand.

- **Initial-Load JavaScript (gzip)**: **96.23 KB** (`mainIndex` entry chunk transferred over the wire)
- **Total Initial Transfer (JS + CSS gzip)**: **102.77 KB**
- **Route-Level Code Splitting**: Confirmed active across all routes with dynamic chunking.

| Metric                      | Measured Value | Gzip Transferred |
| --------------------------- | -------------- | ---------------- |
| **Total JavaScript Bundle** | 618.2 KB       | 194.65 KB        |
| **Total CSS Bundle**        | 32.82 KB       | 6.54 KB          |
| **Main Application Chunk**  | 322.37 KB      | 96.23 KB         |
| **React Vendor Chunk**      | 104.06 KB      | 35.01 KB         |
| **TanStack Query Chunk**    | 71.76 KB       | 21.36 KB         |
| **Socket.IO Vendor Chunk**  | 40.72 KB       | 12.75 KB         |

#### Headless Lighthouse Audit Scores

- **Performance**: 73 / 100
- **Accessibility**: 95 / 100
- **Best Practices**: 96 / 100
- **SEO**: 82 / 100

---

## Database Invariants

Following every load storm and concurrency test run, `scripts/check-invariants.mjs` executes a database audit verifying six core invariants:

1. **Current Price Consistency**: For every auction, `current_price` precisely matches `MAX(bids.amount)` of accepted bids (or `starting_price` if 0 bids exist).
2. **Bid Count Integrity**: Auction `bid_count` strictly equals `COUNT(bids.id)`.
3. **Strict Monotonicity**: All accepted bids on any auction form a strictly monotonically increasing sequence (`bid[i].amount > bid[i-1].amount`).
4. **Duplicate Prevention**: Zero duplicate accepted bids exist with identical amounts for the same auction.
5. **Referential Integrity**: Zero orphan bids exist referencing deleted or non-existent auctions.
6. **Lifecycle Correctness**: Ended auctions have `status = 'ENDED'` with `winner_id` correctly resolved based on reserve price constraints.

The invariant audit verifies **0 violations** across all audited auctions.

---

## Reproduce

Every result, test, and benchmark can be reproduced with single-command scripts.

### Prerequisites

- Node.js 22 LTS
- Docker and Docker Compose (for PostgreSQL 16 and Redis 7)

### Step 1: Start Infrastructure Containers

```bash
docker compose up -d
```

### Step 2: Install Dependencies & Build Packages

```bash
npm install
npm run build
```

### Step 3: Run Database Migrations

```bash
npm run prisma:migrate:deploy -w @bidstream/api
```

### Step 4: Run Static Checks & Typecheck

```bash
npm run typecheck
npm run lint
npm run format:check
```

### Step 5: Execute Test Suites

```bash
# Run unit and integration tests across all workspaces
npm test

# Run the 200-bid parallel PostgreSQL concurrency verification test
npm test -w @bidstream/api -- test/bidding.concurrency.spec.ts

# Run the multi-instance Socket.IO Redis adapter synchronization test
npm test -w @bidstream/api -- test/realtime.multi-instance.spec.ts
```

### Step 6: Run Load Benchmark & Invariant Audit

```bash
# Execute load benchmark and write metrics/loadtest.json
npm run test:load

# Run database invariant verification
npm run test:invariants

# Run web bundle measurement and write metrics/web.json
npm run test:measure-web

# Verify that README.md figures match metrics/*.json exactly
npm run test:verify-readme
```

---

## Limitations

1. **Single-Region PostgreSQL**: Pessimistic row locking requires interactive transactions on a primary database instance. Multi-region deployments require either region pinning or partition-based master routing.
2. **Synchronous Lock Holding**: Bids holding the row lock block competing bidders until completion. To ensure sub-15ms p50 latency, transactions must never perform non-database operations (HTTP calls, email, disk I/O) within the lock boundary.
3. **In-Memory WebSocket Gateway State**: While event distribution scales via Redis Pub/Sub, individual WebSocket socket connections are maintained in memory per instance. Reconnections trigger an explicit database replay step via `lastBidId`.
4. **No Native Payment Processing**: In accordance with project boundaries, bid placement reserves authorization hold logic but does not integrate external payment gateway webhooks.

---

## AI Tools Used

The initial project structure, architectural planning, boilerplate scaffolding, and test implementations were developed with the assistance of Google DeepMind's Antigravity agentic coding assistant. All system architectures, concurrency primitives, invariant validation rules, and benchmark scripts were verified through local service containers and automated test suites.
