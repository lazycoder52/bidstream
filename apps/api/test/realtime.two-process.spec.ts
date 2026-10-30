import fs from 'node:fs';
import path from 'node:path';
import { spawn, ChildProcess, execSync } from 'node:child_process';
import crypto from 'node:crypto';
import Redis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { io as Client, Socket as ClientSocket } from 'socket.io-client';
import { BidPlacedEvent } from '@bidstream/contracts';

function generateJwt(payload: Record<string, unknown>, secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
}

async function waitForHttpOk(url: string, timeoutMs = 25000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        return true;
      }
    } catch {
      // Process not ready yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

describe('Real-Time Cross-Process Synchronization (Two OS Processes)', () => {
  const portA = 3081;
  const portB = 3082;
  const auctionId = '22222222-7777-8888-9999-000000000001';
  const sellerId = '22222222-1111-2222-3333-444444444444';
  const bidderId = '22222222-5555-6666-7777-888888888888';
  const jwtSecret =
    process.env['JWT_ACCESS_SECRET'] ||
    'change_this_to_a_secure_random_string_at_least_32_characters_long';

  let isServicesAvailable = false;
  let prisma: PrismaClient | null = null;
  let processA: ChildProcess | null = null;
  let processB: ChildProcess | null = null;
  let clientOnA: ClientSocket | null = null;
  let clientOnB: ClientSocket | null = null;
  let bidderToken = '';

  beforeAll(async () => {
    const isCI = process.env.CI === 'true' || process.env['CI'] === 'true';
    const redisHost = process.env['REDIS_HOST'] || 'localhost';
    const redisPort = Number(process.env['REDIS_PORT']) || 6379;

    // Check Redis
    const testRedis = new Redis({
      host: redisHost,
      port: redisPort,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 1500,
      enableOfflineQueue: false,
    });

    try {
      await testRedis.connect();
      await testRedis.ping();
      await testRedis.quit();
    } catch (err) {
      testRedis.disconnect();
      if (isCI) {
        throw new Error(
          `Redis is required in CI for two-process realtime test, but failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      console.warn('Redis is not reachable locally. Skipping two-process test.');
      return;
    }

    // Check Postgres
    prisma = new PrismaClient();
    try {
      await prisma.$connect();
      await prisma.$queryRaw`SELECT 1`;
    } catch (err) {
      await prisma.$disconnect().catch(() => {});
      if (isCI) {
        throw new Error(
          `PostgreSQL is required in CI for two-process realtime test, but failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      console.warn('PostgreSQL is not reachable locally. Skipping two-process test.');
      return;
    }

    isServicesAvailable = true;

    // Ensure API build exists
    const rootDir = path.resolve(__dirname, '../../..');
    const distPath = path.resolve(__dirname, '../dist/main.js');
    if (!fs.existsSync(distPath)) {
      execSync('npm run build -w apps/api', { cwd: rootDir, stdio: 'inherit' });
    }

    // Seed test users & active auction
    await prisma.user.upsert({
      where: { id: sellerId },
      update: {},
      create: {
        id: sellerId,
        email: 'twoprocess-seller@example.com',
        name: 'TwoProcess Seller',
        passwordHash: 'dummy_argon2_hash',
        role: 'SELLER',
      },
    });

    await prisma.user.upsert({
      where: { id: bidderId },
      update: {},
      create: {
        id: bidderId,
        email: 'twoprocess-bidder@example.com',
        name: 'TwoProcess Bidder',
        passwordHash: 'dummy_argon2_hash',
        role: 'BUYER',
      },
    });

    await prisma.auction.upsert({
      where: { id: auctionId },
      update: {
        currentPrice: 100,
        bidCount: 0,
        status: 'ACTIVE',
        endTime: new Date(Date.now() + 3600000),
      },
      create: {
        id: auctionId,
        title: 'Two-Process Cross-Node Realtime Test Auction',
        description: 'Verifies real-time event distribution across spawned OS processes',
        startingPrice: 100,
        currentPrice: 100,
        minIncrement: 5,
        status: 'ACTIVE',
        sellerId,
        startTime: new Date(),
        endTime: new Date(Date.now() + 3600000),
      },
    });

    bidderToken = generateJwt(
      {
        sub: bidderId,
        email: 'twoprocess-bidder@example.com',
        role: 'BUYER',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 7200,
      },
      jwtSecret,
    );

    // Spawn Process A on port 3081
    processA = spawn('node', [distPath], {
      env: {
        ...process.env,
        PORT: String(portA),
        NODE_ENV: 'test',
        REDIS_IN_MEMORY: 'false',
        THROTTLE_LIMIT: '50000',
      },
      stdio: 'pipe',
    });

    // Spawn Process B on port 3082
    processB = spawn('node', [distPath], {
      env: {
        ...process.env,
        PORT: String(portB),
        NODE_ENV: 'test',
        REDIS_IN_MEMORY: 'false',
        THROTTLE_LIMIT: '50000',
      },
      stdio: 'pipe',
    });

    // Wait for both processes to report healthy
    const [healthyA, healthyB] = await Promise.all([
      waitForHttpOk(`http://127.0.0.1:${portA}/health`, 25000),
      waitForHttpOk(`http://127.0.0.1:${portB}/health`, 25000),
    ]);

    if (!healthyA || !healthyB) {
      throw new Error(
        `Failed to bootstrap spawned API processes. Health A=${healthyA}, Health B=${healthyB}`,
      );
    }

    // Connect Socket.IO client 1 strictly to Process A
    clientOnA = Client(`http://127.0.0.1:${portA}`, {
      transports: ['websocket'],
      auth: { token: bidderToken },
    });

    // Connect Socket.IO client 2 strictly to Process B
    clientOnB = Client(`http://127.0.0.1:${portB}`, {
      transports: ['websocket'],
      auth: { token: bidderToken },
    });

    await Promise.all([
      new Promise<void>((resolve, reject) => {
        clientOnA!.on('connect', () => resolve());
        clientOnA!.on('connect_error', (err) => reject(err));
      }),
      new Promise<void>((resolve, reject) => {
        clientOnB!.on('connect', () => resolve());
        clientOnB!.on('connect_error', (err) => reject(err));
      }),
    ]);
  }, 45000);

  afterAll(async () => {
    clientOnA?.disconnect();
    clientOnB?.disconnect();

    if (processA) {
      processA.kill('SIGKILL');
    }
    if (processB) {
      processB.kill('SIGKILL');
    }

    if (prisma) {
      await prisma.bid.deleteMany({ where: { auctionId } }).catch(() => {});
      await prisma.auction.deleteMany({ where: { id: auctionId } }).catch(() => {});
      await prisma.$disconnect().catch(() => {});
    }
  });

  it('receives real-time bid updates on Process B when a bid is placed via Process A over HTTP', async () => {
    if (!isServicesAvailable || !clientOnA || !clientOnB) {
      const isCI = process.env.CI === 'true' || process.env['CI'] === 'true';
      if (isCI) {
        throw new Error('Services are required in CI for two-process realtime test');
      }
      expect(true).toBe(true);
      return;
    }

    // Both clients join auction room
    await new Promise<void>((resolve) => {
      clientOnA!.once('auction:joined', () => resolve());
      clientOnA!.emit('auction:join', { auctionId });
    });

    await new Promise<void>((resolve) => {
      clientOnB!.once('auction:joined', () => resolve());
      clientOnB!.emit('auction:join', { auctionId });
    });

    // Setup listener on Process B client for 'bid:placed'
    const eventPromise = new Promise<BidPlacedEvent>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Timeout waiting for bid:placed on Process B')),
        10000,
      );
      clientOnB!.once('bid:placed', (event: BidPlacedEvent) => {
        clearTimeout(timer);
        resolve(event);
      });
    });

    // Place bid via HTTP POST on Process A (port 3081)
    const bidResponse = await fetch(`http://127.0.0.1:${portA}/auctions/${auctionId}/bids`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bidderToken}`,
        'Idempotency-Key': `two-process-key-${Date.now()}`,
      },
      body: JSON.stringify({
        amount: 125,
      }),
    });

    expect(bidResponse.status).toBe(201);
    const bidJson = (await bidResponse.json()) as { currentPrice: number; bid: { amount: number } };
    expect(bidJson.currentPrice).toBe(125);

    // Assert that Client on Process B (port 3082) receives the broadcast from Redis adapter!
    const receivedEvent = await eventPromise;
    expect(receivedEvent.auctionId).toBe(auctionId);
    expect(receivedEvent.currentPrice).toBe(125);
    expect(receivedEvent.bid.amount).toBe(125);
  }, 30000);
});
