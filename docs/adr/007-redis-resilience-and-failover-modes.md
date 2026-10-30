# ADR-007: Redis Resilience, Fail-Fast Startup, and Explicit Failover Modes

## Context

In high-concurrency real-time systems like BidStream, Redis serves multiple mission-critical roles:

1. **Multi-Instance WebSocket Fanout**: Broadcasting bids across clustered API nodes via `@socket.io/redis-adapter`.
2. **Distributed Rate Limiting**: Shared token-bucket counters via `@nestjs/throttler` storage to prevent distributed abuse.
3. **Session Refresh Token Tracking**: Whitelisting and rotating active refresh tokens with TTL expiry.
4. **Lifecycle Job Scheduling**: Delayed auction-close queues powered by BullMQ.

Previously, if Redis failed to connect, parts of the system attempted silent in-memory fallbacks or caught connection errors without bubbling up. In a multi-node production deployment, silent fallbacks cause disastrous silent split-brain conditions:

- Node A broadcasts a bid in memory only; clients connected to Node B never see the bid.
- Throttlers fall back to per-process counters, allowing an attacker to multiply their traffic by the number of running instances.
- Closing workers stop coordinating across nodes.

## Considered Options

1. **Silent Fallback to In-Memory Everything**:
   - Catch connection failures and substitute local in-process data structures.
   - _Drawback_: Dangerous silent partial outages, split-brain broadcasts, and uncoordinated state in production.

2. **Unconditional Crash on Any Transient Disconnect**:
   - Immediately crash the process on any Redis command error.
   - _Drawback_: Brittle; causes crash-loops under temporary network blips that could be survived via reconnection or retry strategies.

3. **Explicit Dual-Mode Architecture: Fail-Fast in Production, Explicit Dev Flag, and Configurable Throttler Failover**:
   - **Startup**: If `NODE_ENV=production` and Redis is unreachable, fail fast immediately (throw on boot).
   - **Prohibited Flags in Prod**: Env validation rejects `REDIS_IN_MEMORY=true` when `NODE_ENV=production`.
   - **Local Dev / Single Node**: In-memory mode is available **strictly** behind the explicit dev flag `REDIS_IN_MEMORY=true`.
   - **Runtime Health**: `/health` queries Redis ping with a 2-second timeout; returns HTTP 503 (`status: degraded`, `services.redis: down`) if Redis is unresponsive.
   - **Rate Limiter Failover Policy**: Configurable via `THROTTLE_FAIL_OPEN` (`false` by default = fail-closed with 503 `RATE_LIMITER_UNAVAILABLE`; `true` = fail-open allowing requests).

## Decision

We adopted **Option 3: Fail-Fast Startup in Production, Explicit Dev Flag, and Configurable Throttler Policies**.

### 1. Fail-Fast Startup

- In `RedisService.onModuleInit()`, `this.client.connect()` is awaited with a 3000ms timeout.
- In `RedisIoAdapter.connectToRedis()`, the pub/sub connection is awaited with a 3000ms timeout.
- In production, or whenever `REDIS_IN_MEMORY` is false, any connection failure throws immediately and halts application boot.

### 2. Guarded Dev-Only In-Memory Flag

- In-memory mode (`REDIS_IN_MEMORY=true`) initializes `InMemoryRedisClient`, a Map-backed mock implementing `get`, `set`, `del`, `keys`, `incr`, `pttl`, `pexpire`, and `multi()`.
- Zod schema validation in contracts explicitly blocks `REDIS_IN_MEMORY=true` when `NODE_ENV=production`.

### 3. Observability & Health Reporting

- `GET /health` tests Redis via `redisService.ping()` with timeout protection.
- If Redis is down, `/health` responds with HTTP 503 and `{ "status": "degraded", "services": { "redis": "down" } }`.

### 4. Explicit Rate Limiter Failover Choice

- `THROTTLE_FAIL_OPEN=false` (Default, Security-First): If Redis is down, `RedisThrottlerStorage` fails closed, throwing an HTTP 503 `RATE_LIMITER_UNAVAILABLE` exception to prevent unthrottled flooding.
- `THROTTLE_FAIL_OPEN=true` (Availability-First): If Redis is down, `RedisThrottlerStorage` logs a warning and permits the request (`isBlocked: false`).

## Consequences

- **Positive**: Eliminates silent split-brain in production; guarantees immediate deployment failure if Redis is misconfigured or unreachable; enables clean zero-dependency developer onboarding when `REDIS_IN_MEMORY=true` is explicitly requested.
- **Negative**: Requires Redis to be up for production deployments to pass initial health checks; requiring explicit configuration choices for operational trade-offs.
