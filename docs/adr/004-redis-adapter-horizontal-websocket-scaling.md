# ADR-004: Redis Adapter for Horizontal WebSocket Scaling

## Context

In a distributed real-time platform running multiple API server instances behind a load balancer, clients viewing the same auction are connected to different physical processes. When a user on Process A places a bid, all users subscribed to that auction room across Process B, Process C, etc. must receive the `bid:placed` event within milliseconds.

## Considered Options

1. **Single Node Gateway (No Cluster)**:
   - Run all WebSocket traffic through a single process.
   - _Drawback_: Single point of failure; hard limit on concurrent connections per process; no high-availability or rolling deployments without dropped sessions.
2. **Postgres LISTEN / NOTIFY**:
   - Use PostgreSQL pub/sub notifications to distribute events across nodes.
   - _Drawback_: Postgres pub/sub is not optimized for high-frequency broadcast fanout (payload size limitations; increased transaction log pressure; connection pool exhaustion).
3. **Socket.IO Redis Streams / PubSub Adapter (`@socket.io/redis-adapter`)**:
   - Attach `@socket.io/redis-adapter` to Socket.IO server using two dedicated ioredis connections (`pubClient` and `subClient`).
   - Every `server.to(room).emit(event, data)` is published to Redis channels and automatically forwarded to local sockets on all subscribing API instances.

## Decision

We adopted **`@socket.io/redis-adapter` with dedicated Redis Pub/Sub channels**.

- Rooms are partitioned per auction: `auction:${auctionId}`.
- Targeted user notifications (e.g. `bid:outbid`) are routed to `user:${userId}`.
- State catch-up on reconnection: clients passing `lastBidId` receive missed events directly queried from the PostgreSQL `bids` table, ensuring zero dropped messages during network reconnections.

## Consequences

- **Positive**: Seamless horizontal scaling across arbitrary API replicas; transparent failover.
- **Negative**: Adds Redis as a critical operational dependency for real-time pub/sub; handled gracefully by allowing clients to fall back to HTTP polling if WebSocket connectivity degrades.
