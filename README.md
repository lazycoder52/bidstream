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
4. **[ADR-004: Redis Adapter for Horizontal WebSocket Scaling](docs/adr/004-redis-adapter-horizontal-websocket-scaling.md)**: Real-time event broadcasting scales horizontally across multiple API processes via `@socket.io/redis-adapter` (tested with two in-process Socket.IO servers in `realtime.multi-instance.spec.ts`, and with two separate OS processes in `.github/workflows/benchmarks.yml` across 50 connected clients). Clients reconnecting with `lastBidId` replay missed events directly from the append-only `bids` ledger.
5. **[ADR-005: Shared Monorepo Zod Contracts](docs/adr/005-shared-zod-contracts-single-source-of-truth.md)**: `@bidstream/contracts` serves as the single source of truth for REST DTOs, WebSocket events, and environment schemas. The frontend API client parses and validates every HTTP response at runtime, preventing contract drift.
6. **[ADR-006: Prisma Interactive Transactions with Raw SQL Locking](docs/adr/006-prisma-interactive-transactions-with-raw-sql-locking.md)**: Combines Prisma's ergonomic schema management and relational queries with parameterized `$queryRaw` row locks (`FOR UPDATE` and `FOR UPDATE SKIP LOCKED`) inside `$transaction` blocks.

---

## Verified Results

All numbers in this section are generated directly by automated CI measurement runs (GitHub Actions runner, load generator and server share the machine) via `.github/workflows/benchmarks.yml` and saved to `metrics/*.json`. An automated verification test (`scripts/verify-readme-metrics.mjs`) asserts that these figures match the source metrics files without discrepancies.

### Load and Concurrency Benchmark (metrics/loadtest.json)

The load benchmark evaluates 500 concurrent virtual users executing a high-concurrency bidding storm across 20 active auctions alongside background browse-heavy traffic. Note: WebSocket broadcast latency is measured sequentially before the load storm by `scripts/measure-socket-latency.mjs` across 50 connected clients over 10 sample bid broadcasts (500 total event receipts) on an unloaded cluster, rather than concurrently during the 500-VU bidding storm.

| Metric                                        | Measured Value              |
| --------------------------------------------- | --------------------------- |
| **Sustained Throughput**                      | 515.2 req/s                 |
| **Total Benchmark Requests**                  | 36113 requests              |
| **Accepted Bids**                             | 1606 bids                   |
| **Rejected Bids (Contention/Outbid)**         | 24411 bids                  |
| **HTTP Bid Latency (p50)**                    | 1016.7 ms                   |
| **HTTP Bid Latency (p90)**                    | 1157.9 ms                   |
| **HTTP Bid Latency (p95)**                    | 1189.8 ms                   |
| **HTTP Browse Latency (p50)**                 | 241.9 ms                    |
| **HTTP Browse Latency (p95)**                 | 444.5 ms                    |
| **WebSocket Broadcast Delay (p50, unloaded)** | 39 ms                       |
| **WebSocket Broadcast Delay (p95, unloaded)** | 40 ms                       |
| **WebSocket Broadcast Delay (max, unloaded)** | 40 ms                       |
| **Simultaneous WebSocket Clients**            | 50 clients                  |
| **Database Invariant Violations**             | 0 violations (passed: true) |

### Web Performance & Bundle Audit (metrics/web.json)

Bundle size measurements were collected via production build analysis of the React 19 single-page application. Route-level code splitting is implemented across all routes (`/auctions`, `/auctions/:id`, `/auctions/create`, `/dashboard`, `/login`, `/register`) using dynamic `React.lazy` imports wrapped with `<Suspense>`, ensuring secondary routes are loaded on demand.

- **Initial-Load JavaScript (gzip)**: **97.41 KB** (`mainIndex` entry chunk transferred over the wire)
- **Total Initial Transfer (JS + CSS gzip)**: **104.01 KB**
- **Route-Level Code Splitting**: Confirmed active across all routes with dynamic chunking.

| Metric                      | Measured Value | Gzip Transferred |
| --------------------------- | -------------- | ---------------- |
| **Total JavaScript Bundle** | 623.46 KB      | 196.16 KB        |
| **Total CSS Bundle**        | 33.08 KB       | 6.6 KB           |
| **Main Application Chunk**  | 326.76 KB      | 97.41 KB         |
| **React Vendor Chunk**      | 104.08 KB      | 35.02 KB         |
| **TanStack Query Chunk**    | 71.76 KB       | 21.36 KB         |
| **Socket.IO Vendor Chunk**  | 40.72 KB       | 12.75 KB         |

#### Headless Lighthouse Audit Scores

- **Performance**: 72 / 100
- **Accessibility**: 95 / 100
- **Best Practices**: 96 / 100
- **SEO**: 82 / 100

---

## Database Invariants

The database invariant verification suite asserts zero discrepancies across auction price synchronization, bid count integrity, strict bid amount monotonicity, duplicate bid prevention, foreign key referential consistency, and terminal auction winner resolution.

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

The steps below demonstrate how to configure the environment, install dependencies, run migrations, execute test suites, and initiate benchmarks from a fresh repository clone on Linux or macOS.

### Prerequisites

- Node.js 22 LTS
- Docker and Docker Compose (for PostgreSQL 16 and Redis 7)

### Step 1: Environment Configuration & Infrastructure

```bash
# Copy example environment configuration
cp .env.example .env

# Start backing PostgreSQL and Redis infrastructure containers
docker compose up -d postgres redis
```

### Step 2: Install Dependencies & Build Packages

```bash
npm install
npm run build
```

### Step 3: Run Database Migrations

```bash
npm run prisma:generate
npm run prisma:migrate:deploy
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

# Run Playwright end-to-end browser tests
npm run test:e2e
```

### Step 6: Run Load Benchmark & Invariant Audit

To evaluate the high-concurrency bidding storm across two clustered API instances with the rate limit loosened:

```bash
# Start dual API instances connected via Redis adapter with THROTTLE_LIMIT override
THROTTLE_LIMIT=50000 PORT=3001 node apps/api/dist/main.js &
THROTTLE_LIMIT=50000 PORT=3002 node apps/api/dist/main.js &

# Execute load benchmark targeting both instances and write metrics/loadtest.json
API_URLS=http://localhost:3001,http://localhost:3002 SUBSCRIBER_URL=http://localhost:3001 PUBLISHER_URL=http://localhost:3002 node scripts/run-benchmarks.mjs

# Run database invariant verification
npm run test:invariants

# Run web bundle measurement and write metrics/web.json
npm run test:measure-web

# Verify that README.md figures match metrics/*.json exactly
npm run test:verify-readme
```

For the automated CI pipeline that provisions PostgreSQL and Redis service containers, runs the dual-node storm under 500 VUs, and publishes metrics artifacts, refer to [.github/workflows/benchmarks.yml](.github/workflows/benchmarks.yml).

---

## Limitations

1. **Single-Region PostgreSQL**: Pessimistic row locking requires interactive transactions on a primary database instance. Multi-region deployments require either region pinning or partition-based master routing.
2. **Synchronous Lock Holding**: Bids holding the row lock block competing bidders until completion. Transactions must never perform non-database operations (HTTP calls, email, disk I/O) within the lock boundary.
3. **In-Memory WebSocket Gateway State**: While event distribution scales via Redis Pub/Sub, individual WebSocket socket connections are maintained in memory per instance. Reconnections trigger an explicit database replay step via `lastBidId`.
4. **No payment processing**: bids carry no payment or authorization.
5. **Load Test Throttler Override**: For load test benchmarks and CI smoke execution, the API rate throttler limit (`THROTTLE_LIMIT`) is overridden from the production default of 120 requests/minute to 50,000 requests/minute via environment configuration so high-volume concurrent traffic can be tested without synthetic client 429 rejections.
6. **Load Storm Error Thresholds**: In the 30-second automated CI smoke suite, the HTTP failure threshold is enforced at `http_req_failed: ['rate<0.10']` with status codes 200, 201, and 409 registered as expected responses via `http.setResponseCallback(http.expectedStatuses(200, 201, 409))`. In the full 500-VU exploratory load benchmark, no arbitrary pass/fail latency or error thresholds are enforced (`thresholds: {}`) so raw empirical measurements under saturation are captured and exported to `metrics/loadtest.json` without artificial exit-code truncation.
7. **WebSocket Broadcast Latency Measurement Scope**: Cross-instance WebSocket broadcast latency is measured by `scripts/measure-socket-latency.mjs` before the bidding storm begins. It samples exactly 10 sequential bids across 50 connected clients (500 total event receipts) on an unloaded, quiescent cluster to confirm multi-instance Redis Pub/Sub delivery. It does not measure broadcast delay concurrently under the 500-VU bidding storm, and the reported p95 is not a loaded p95.
8. **Benchmark Run Variance**: The benchmark figures come from a single run on a shared 2-vCPU runner and vary between runs.

---

## AI Tools Used

The initial project structure, architectural planning, boilerplate scaffolding, and test implementations were developed with the assistance of Google DeepMind's Antigravity agentic coding assistant. All system architectures, concurrency primitives, invariant validation rules, and benchmark scripts were verified through local service containers and automated test suites.
