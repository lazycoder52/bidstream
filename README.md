# BidStream

BidStream is a real-time auction engine built to guarantee transactional correctness and eliminate lost updates during high-concurrency bidding wars. It proves price consistency, monotonic increments, and multi-node broadcast synchronization through automated database invariant tests and clustered k6 load runs.

## What It Demonstrates

- **Pessimistic row-level locking**: Serializes concurrent bids per auction in [`apps/api/src/bids/bids.service.ts`](apps/api/src/bids/bids.service.ts) using PostgreSQL `SELECT ... FOR UPDATE`, verified by 200 concurrent requests in [`apps/api/test/bidding.concurrency.spec.ts`](apps/api/test/bidding.concurrency.spec.ts).
- **Idempotency key protocol**: Atomically records keys and caches responses inside the transaction in [`apps/api/src/bids/bids.service.ts`](apps/api/src/bids/bids.service.ts), verified in [`apps/api/test/idempotency.spec.ts`](apps/api/test/idempotency.spec.ts).
- **Anti-sniping extensions**: Extends auction deadlines when bids arrive in closing minutes in [`apps/api/src/bids/bids.service.ts`](apps/api/src/bids/bids.service.ts) and [`apps/api/src/lifecycle/lifecycle.service.ts`](apps/api/src/lifecycle/lifecycle.service.ts).
- **Double-layer closing architecture**: Pairs BullMQ delayed close jobs with a periodic `SKIP LOCKED` PostgreSQL sweeper in [`apps/api/src/lifecycle/sweeper.service.ts`](apps/api/src/lifecycle/sweeper.service.ts), verified in [`apps/api/test/lifecycle.resilience.spec.ts`](apps/api/test/lifecycle.resilience.spec.ts).
- **Redis adapter real-time sync**: Broadcasts auction events horizontally across API nodes via `@socket.io/redis-adapter` in [`apps/api/src/realtime/redis-io.adapter.ts`](apps/api/src/realtime/redis-io.adapter.ts), verified in [`apps/api/test/realtime.multi-instance.spec.ts`](apps/api/test/realtime.multi-instance.spec.ts).
- **Shared runtime contracts**: Single source of truth for DTO schemas, WebSocket events, and TypeScript interfaces across frontend and backend in [`packages/contracts/src/index.ts`](packages/contracts/src/index.ts).

## Tech Stack

| Layer               | Technology                                                                     |
| ------------------- | ------------------------------------------------------------------------------ |
| Frontend            | React 19, Vite, Tailwind CSS v4, Zustand, TanStack Query                       |
| Backend             | NestJS, Express, Socket.IO, BullMQ, Prisma ORM                                 |
| Persistence & Cache | PostgreSQL 16 (`SELECT ... FOR UPDATE`), Redis 7 (Pub/Sub adapter & throttler) |
| Tooling & Contracts | Zod, TypeScript, Docker Compose, Vitest, Jest, Playwright, k6                  |

## Quick Start

Prerequisites: Node.js 22 LTS, Docker & Docker Compose.

**Bash:**

```bash
cp .env.example .env && docker compose up -d postgres redis
npm install && npm run build
export DATABASE_URL="postgresql://bidstream:bidstream_pass@localhost:5432/bidstream_db?schema=public"
npm run prisma:generate && npm run prisma:migrate:deploy && npm test
```

**PowerShell:**

```powershell
Copy-Item .env.example .env; docker compose up -d postgres redis
npm install; npm run build
$env:DATABASE_URL="postgresql://bidstream:bidstream_pass@localhost:5432/bidstream_db?schema=public"
npm run prisma:generate; npm run prisma:migrate:deploy; npm test
```

For the complete multi-instance setup, load tests, and invariant checks, see [Reproduce](#reproduce).

## Architecture

BidStream separates domain contracts, backend API instances, and the single-page client across an npm workspaces monorepo.

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

When a bid request arrives, the API starts a PostgreSQL interactive transaction with Read Committed isolation. Inside the transaction, it locks the auction row using `SELECT ... FOR UPDATE` to serialize concurrent bidders without deadlocks. The service evaluates the idempotency key, immediately returning the cached payload if the key was already committed. Under the lock, the service verifies bid increments, appends a record to the `bids` ledger, updates the auction price and end time, and commits. Once the transaction commits, the API emits the update through Socket.IO and the Redis adapter broadcasts it to connected clients across all nodes.

## Design Decisions

- **[ADR-001: Pessimistic Row Locking vs Optimistic Versioning](docs/adr/001-pessimistic-locking-vs-optimistic-versioning.md)**: PostgreSQL `SELECT ... FOR UPDATE` row locks eliminate abort cascades and retry storms under high contention.
- **[ADR-002: Idempotency Keys Design](docs/adr/002-idempotency-keys-design.md)**: Atomic idempotency key tracking inside the transaction guarantees duplicate network requests return cached responses without duplicate bids.
- **[ADR-003: Double-Layer Closing Architecture](docs/adr/003-closing-architecture-bullmq-and-skip-locked-sweeper.md)**: BullMQ delayed jobs deliver precise auction closing, paired with a periodic `SKIP LOCKED` sweeper to recover from job loss.
- **[ADR-004: Redis Adapter for Horizontal WebSocket Scaling](docs/adr/004-redis-adapter-horizontal-websocket-scaling.md)**: `@socket.io/redis-adapter` distributes room broadcasts across multiple API nodes, with reconnecting clients catching up via `lastBidId`.
- **[ADR-005: Shared Monorepo Zod Contracts](docs/adr/005-shared-zod-contracts-single-source-of-truth.md)**: `@bidstream/contracts` serves as the single source of truth for DTOs and WebSocket events, validated at runtime by both client and server.
- **[ADR-006: Prisma Interactive Transactions with Raw SQL Locking](docs/adr/006-prisma-interactive-transactions-with-raw-sql-locking.md)**: Combines Prisma type safety and migrations with raw SQL row locks inside interactive transactions.

## Testing

| Suite                      | What It Proves                                                                               | Command                                                              |
| -------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Concurrency                | Serializes 200 concurrent bids on one auction with zero lost updates                         | `npm test -w @bidstream/api -- test/bidding.concurrency.spec.ts`     |
| Idempotency                | Returns exact cached responses on duplicate idempotency keys without extra bids              | `npm test -w @bidstream/api -- test/idempotency.spec.ts`             |
| Multi-Instance Realtime    | Distributes WebSocket broadcasts across distinct API nodes via Redis adapter                 | `npm test -w @bidstream/api -- test/realtime.multi-instance.spec.ts` |
| Lifecycle Resilience       | Handles concurrent closing workers and recovers overdue auctions via sweeper                 | `npm test -w @bidstream/api -- test/lifecycle.resilience.spec.ts`    |
| Frontend Flows (MSW)       | Intercepts HTTP/WS, asserting optimistic bid rollbacks on 409 conflict and schema validation | `npm test -w @bidstream/web`                                         |
| E2E Workflows (Playwright) | Multi-browser buyer/seller bidding flows, live updates, and error rollbacks                  | `npm run test:e2e`                                                   |
| Load Smoke & Invariants    | Runs a 30s k6 bidding storm against the stack and verifies 6 database invariants             | `docker compose up -d && node scripts/check-invariants.mjs`          |

## Results

All figures are measured from automated CI runs (GitHub Actions runner, load generator and server share the machine) via `.github/workflows/benchmarks.yml` and stored in `metrics/*.json`. The benchmark results come from a single run on a shared 2-vCPU runner and vary between runs.

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

Bundle size measurements were collected via production build analysis of the React 19 single-page application. Route-level code splitting is implemented across all routes using dynamic `React.lazy` imports wrapped with `<Suspense>`, ensuring secondary routes are loaded on demand.

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

## Limitations

1. **Single-Region PostgreSQL**: Pessimistic row locking requires interactive transactions on a primary database instance. Multi-region deployments require either region pinning or partition-based master routing.
2. **Synchronous Lock Holding**: Bids holding the row lock block competing bidders until completion. Transactions must never perform non-database operations (HTTP calls, email, disk I/O) within the lock boundary.
3. **In-Memory WebSocket Gateway State**: While event distribution scales via Redis Pub/Sub, individual WebSocket connections are maintained in memory per instance. Reconnections trigger an explicit database replay step via `lastBidId`.
4. **No Payment Processing**: Bids carry no payment or authorization hold logic.
5. **Load Test Throttler Override**: For load test benchmarks and CI smoke execution, the API rate throttler limit (`THROTTLE_LIMIT`) is overridden from the production default of 120 requests/minute to 50,000 requests/minute so high-volume concurrent traffic can be tested without synthetic client 429 rejections.
6. **Load Storm Error Thresholds**: In the 30-second automated CI smoke suite, the HTTP failure threshold is enforced at `http_req_failed: ['rate<0.10']` with status codes 200, 201, and 409 registered as expected responses via `http.setResponseCallback(http.expectedStatuses(200, 201, 409))`. In the full 500-VU exploratory load benchmark, no pass/fail thresholds are enforced (`thresholds: {}`) so raw empirical measurements under saturation are captured and exported to `metrics/loadtest.json` without artificial truncation.
7. **WebSocket Broadcast Latency Measurement Scope**: Cross-instance WebSocket broadcast latency is measured by `scripts/measure-socket-latency.mjs` before the bidding storm begins. It samples 10 sequential bids across 50 connected clients (500 total receipts) on an unloaded cluster to confirm multi-instance Redis Pub/Sub delivery. It does not measure broadcast delay concurrently under the 500-VU bidding storm, and the reported p95 is not a loaded p95.
8. **Benchmark Run Variance**: The benchmark figures come from a single run on a shared 2-vCPU runner and vary between runs.
9. **Implementation History**: The original roadmap planned 10 milestone pull requests and 6 were merged, and commit 0984179 went directly to main.

## Reproduce

Prerequisites: Node.js 22 LTS, Docker & Docker Compose. Live database and Redis tests fail fast by default if infrastructure is unreachable; pass `ALLOW_SKIP_LIVE_TESTS=true` to skip them with a warning.

### Bash (Linux / macOS)

```bash
# 1. Environment & Infrastructure
cp .env.example .env && docker compose up -d postgres redis

# 2. Build & Migrations
npm install && npm run build
export DATABASE_URL="postgresql://bidstream:bidstream_pass@localhost:5432/bidstream_db?schema=public"
npm run prisma:generate && npm run prisma:migrate:deploy

# 3. Static Checks & Typecheck
npm run typecheck && npm run lint && npm run format:check

# 4. Test Suites
export REDIS_HOST="localhost"
export REDIS_PORT="6379"
npm test
npm test -w @bidstream/api -- test/bidding.concurrency.spec.ts
npm test -w @bidstream/api -- test/realtime.multi-instance.spec.ts
npm run test:e2e

# 5. Clustered Load Benchmark & Invariants
THROTTLE_LIMIT=50000 PORT=3001 node apps/api/dist/main.js &
THROTTLE_LIMIT=50000 PORT=3002 node apps/api/dist/main.js &
API_URLS=http://localhost:3001,http://localhost:3002 SUBSCRIBER_URL=http://localhost:3001 PUBLISHER_URL=http://localhost:3002 node scripts/run-benchmarks.mjs
npm run test:invariants && npm run test:measure-web && npm run test:verify-readme
```

### PowerShell (Windows)

```powershell
# 1. Environment & Infrastructure
Copy-Item .env.example .env; docker compose up -d postgres redis

# 2. Build & Migrations
npm install; npm run build
$env:DATABASE_URL="postgresql://bidstream:bidstream_pass@localhost:5432/bidstream_db?schema=public"
npm run prisma:generate; npm run prisma:migrate:deploy

# 3. Static Checks & Typecheck
npm run typecheck; npm run lint; npm run format:check

# 4. Test Suites
$env:REDIS_HOST="localhost"
$env:REDIS_PORT="6379"
npm test
npm test -w @bidstream/api -- test/bidding.concurrency.spec.ts
npm test -w @bidstream/api -- test/realtime.multi-instance.spec.ts
npm run test:e2e

# 5. Clustered Load Benchmark & Invariants
$env:THROTTLE_LIMIT="50000"; Start-Process node -ArgumentList "apps/api/dist/main.js" -Environment @{ PORT="3001"; THROTTLE_LIMIT="50000" }
Start-Process node -ArgumentList "apps/api/dist/main.js" -Environment @{ PORT="3002"; THROTTLE_LIMIT="50000" }
$env:API_URLS="http://localhost:3001,http://localhost:3002"; $env:SUBSCRIBER_URL="http://localhost:3001"; $env:PUBLISHER_URL="http://localhost:3002"; node scripts/run-benchmarks.mjs
npm run test:invariants; npm run test:measure-web; npm run test:verify-readme
```

## AI Tools Used

This codebase was developed with the assistance of an AI coding agent working under direct direction. The human engineer specified all requirements, architectures, concurrency patterns, and invariant validation rules, while reviewing every pull request and verifying results. All test outputs, bundle measurements, and performance figures are produced by automated execution scripts, not derived from agent assertions.
