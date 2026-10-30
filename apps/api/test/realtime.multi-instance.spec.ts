import { createServer, Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { io as Client, Socket as ClientSocket } from 'socket.io-client';
import { AddressInfo } from 'net';
import { BidPlacedEvent } from '@bidstream/contracts';

// Spawns two distinct in-process HTTP and Socket.IO servers bound to dynamic ports sharing
// @socket.io/redis-adapter to verify pub/sub broadcast distribution.
// (For separate OS process execution, see realtime.two-process.spec.ts and .github/workflows/benchmarks.yml).
describe('Real-Time Multi-Instance Synchronization (Two In-Process Servers on Redis Adapter)', () => {
  let isRedisAvailable = false;
  let redisPub1: Redis | null = null;
  let redisSub1: Redis | null = null;
  let redisPub2: Redis | null = null;
  let redisSub2: Redis | null = null;

  let httpServer1: HttpServer | null = null;
  let httpServer2: HttpServer | null = null;
  let ioServer1: SocketIOServer | null = null;
  let ioServer2: SocketIOServer | null = null;

  let clientOnServer1: ClientSocket | null = null;
  let clientOnServer2: ClientSocket | null = null;

  const testAuctionId = 'bbbbbbbb-4444-5555-6666-777777777777';

  beforeAll(async () => {
    const redisHost = process.env['REDIS_HOST'] || 'localhost';
    const redisPort = Number(process.env['REDIS_PORT']) || 6379;

    const testRedis = new Redis({
      host: redisHost,
      port: redisPort,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 1000,
      enableOfflineQueue: false,
    });

    try {
      await testRedis.connect();
      await testRedis.ping();
      await testRedis.quit();
      isRedisAvailable = true;
    } catch (err) {
      testRedis.disconnect();
      if (process.env.CI === 'true' || process.env['CI'] === 'true') {
        throw new Error(
          `Redis is required in CI for multi-instance realtime test, but connection failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      console.warn(
        'Redis is not reachable in this environment. Skipping live multi-instance Redis adapter test.',
      );
      isRedisAvailable = false;
      return;
    }

    // Initialize Redis adapter clients for Server 1 (API process 1)
    redisPub1 = new Redis({
      host: redisHost,
      port: redisPort,
      lazyConnect: true,
      enableOfflineQueue: false,
    });
    redisSub1 = redisPub1.duplicate();
    await Promise.all([redisPub1.connect(), redisSub1.connect()]);

    // Initialize Redis adapter clients for Server 2 (API process 2)
    redisPub2 = new Redis({
      host: redisHost,
      port: redisPort,
      lazyConnect: true,
      enableOfflineQueue: false,
    });
    redisSub2 = redisPub2.duplicate();
    await Promise.all([redisPub2.connect(), redisSub2.connect()]);

    // Start Server 1
    httpServer1 = createServer();
    ioServer1 = new SocketIOServer(httpServer1, {
      cors: { origin: '*' },
      adapter: createAdapter(redisPub1, redisSub1),
    });

    // Start Server 2
    httpServer2 = createServer();
    ioServer2 = new SocketIOServer(httpServer2, {
      cors: { origin: '*' },
      adapter: createAdapter(redisPub2, redisSub2),
    });

    // Setup room handlers on both servers
    const setupHandlers = (io: SocketIOServer) => {
      io.on('connection', (socket) => {
        socket.on('auction:join', ({ auctionId }: { auctionId: string }) => {
          socket.join(`auction:${auctionId}`);
          socket.emit('auction:joined', { auctionId });
        });
      });
    };

    setupHandlers(ioServer1);
    setupHandlers(ioServer2);

    await new Promise<void>((resolve) => httpServer1!.listen(0, () => resolve()));
    await new Promise<void>((resolve) => httpServer2!.listen(0, () => resolve()));

    const port1 = (httpServer1.address() as AddressInfo).port;
    const port2 = (httpServer2.address() as AddressInfo).port;

    // Connect Client 1 strictly to Server 1
    clientOnServer1 = Client(`http://127.0.0.1:${port1}`, {
      transports: ['websocket'],
    });

    // Connect Client 2 strictly to Server 2
    clientOnServer2 = Client(`http://127.0.0.1:${port2}`, {
      transports: ['websocket'],
    });

    await Promise.all([
      new Promise<void>((resolve) => clientOnServer1!.on('connect', () => resolve())),
      new Promise<void>((resolve) => clientOnServer2!.on('connect', () => resolve())),
    ]);
  }, 20000);

  afterAll(async () => {
    if (isRedisAvailable) {
      clientOnServer1?.disconnect();
      clientOnServer2?.disconnect();

      if (ioServer1) {
        await new Promise<void>((resolve) => ioServer1!.close(() => resolve()));
      }
      if (ioServer2) {
        await new Promise<void>((resolve) => ioServer2!.close(() => resolve()));
      }

      await Promise.all([
        redisPub1?.quit().catch(() => {}),
        redisSub1?.quit().catch(() => {}),
        redisPub2?.quit().catch(() => {}),
        redisSub2?.quit().catch(() => {}),
      ]);
    }
  });

  it('propagates room broadcasts across isolated API server nodes via Redis Pub/Sub', async () => {
    if (!isRedisAvailable || !clientOnServer1 || !clientOnServer2 || !ioServer2) {
      if (process.env.CI === 'true' || process.env['CI'] === 'true') {
        throw new Error('Redis is required in CI for multi-instance realtime test');
      }
      expect(true).toBe(true);
      return;
    }

    // Client 1 joins auction on Server 1
    await new Promise<void>((resolve) => {
      clientOnServer1!.once('auction:joined', () => resolve());
      clientOnServer1!.emit('auction:join', { auctionId: testAuctionId });
    });

    // Client 2 joins the same auction on Server 2
    await new Promise<void>((resolve) => {
      clientOnServer2!.once('auction:joined', () => resolve());
      clientOnServer2!.emit('auction:join', { auctionId: testAuctionId });
    });

    const crossNodeEvent: BidPlacedEvent = {
      auctionId: testAuctionId,
      bid: {
        id: '11111111-3333-4444-5555-666666666666',
        auctionId: testAuctionId,
        bidderId: '11111111-2222-3333-4444-555555555555',
        bidderName: 'Cluster Bidder',
        amount: 350,
        createdAt: new Date().toISOString(),
      },
      currentPrice: 350,
      bidCount: 8,
      endTime: new Date(Date.now() + 300000).toISOString(),
    };

    // Prepare promises to receive the event on both clients
    const client1Promise = new Promise<BidPlacedEvent>((resolve) => {
      clientOnServer1!.once('bid:placed', (event) => resolve(event));
    });

    const client2Promise = new Promise<BidPlacedEvent>((resolve) => {
      clientOnServer2!.once('bid:placed', (event) => resolve(event));
    });

    // Server 2 emits to the room!
    // Notice: Server 2 emits, but Client 1 is connected to Server 1!
    ioServer2.to(`auction:${testAuctionId}`).emit('bid:placed', crossNodeEvent);

    const [rec1, rec2] = await Promise.all([client1Promise, client2Promise]);

    expect(rec1.bid.id).toBe('11111111-3333-4444-5555-666666666666');
    expect(rec1.currentPrice).toBe(350);

    expect(rec2.bid.id).toBe('11111111-3333-4444-5555-666666666666');
    expect(rec2.currentPrice).toBe(350);
  });
});
