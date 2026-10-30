import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { ZodValidationPipe } from 'nestjs-zod';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

describe('Idempotency Key Protocol & Replay Engine', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authService: AuthService;
  let isPostgresAvailable = false;

  let sellerToken: string;
  let buyerToken: string;
  let buyerId: string;
  let auctionId: string;

  beforeAll(async () => {
    const testPrisma = new PrismaClient({
      datasources: {
        db: {
          url:
            process.env['DATABASE_URL'] ||
            'postgresql://bidstream:bidstream_pass@localhost:5432/bidstream_db?schema=public',
        },
      },
    });

    try {
      await testPrisma.$connect();
      await testPrisma.$queryRaw`SELECT 1`;
      isPostgresAvailable = true;
      await testPrisma.$disconnect();
    } catch {
      console.warn(
        'Real PostgreSQL is not reachable in this environment. Skipping live idempotency suite.',
      );
      isPostgresAvailable = false;
      await testPrisma.$disconnect().catch(() => {});
      return;
    }

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ZodValidationPipe());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    prisma = app.get(PrismaService);
    authService = app.get(AuthService);

    // Seed mock buyer & seller
    const testSuffix = Date.now().toString();
    const seller = await authService.register({
      email: `seller-idemp-${testSuffix}@example.com`,
      password: 'Password123!',
      name: 'Idempotency Seller',
      role: 'SELLER',
    });
    sellerToken = seller.accessToken;

    const buyer = await authService.register({
      email: `buyer-idemp-${testSuffix}@example.com`,
      password: 'Password123!',
      name: 'Idempotency Buyer',
      role: 'BUYER',
    });
    buyerToken = buyer.accessToken;
    buyerId = buyer.user.id;

    // Create active auction with start time in the past and end time in future
    const startTime = new Date(Date.now() - 60000).toISOString();
    const endTime = new Date(Date.now() + 600000).toISOString();

    const auctionRes = await request(app.getHttpServer())
      .post('/auctions')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        title: 'Idempotency Test Item',
        description: 'Verifies exact response replay',
        startingPrice: 100,
        minIncrement: 10,
        startTime,
        endTime,
      });

    auctionId = auctionRes.body?.data?.id;
  });

  afterAll(async () => {
    if (!isPostgresAvailable) return;
    if (auctionId) {
      await prisma.bid.deleteMany({ where: { auctionId } }).catch(() => {});
      await prisma.idempotencyKey
        .deleteMany({
          where: { target: `POST /auctions/${auctionId}/bids` },
        })
        .catch(() => {});
      await prisma.auction.delete({ where: { id: auctionId } }).catch(() => {});
    }
    await prisma.user.deleteMany({ where: { email: { contains: 'idemp' } } }).catch(() => {});
    if (app) {
      await app.close();
    }
  });

  it('replays exact identical response body and status code on duplicate submission', async () => {
    if (!isPostgresAvailable) return;
    const idempotencyKey = `key-replay-${Date.now()}`;

    // First bid
    const res1 = await request(app.getHttpServer())
      .post(`/auctions/${auctionId}/bids`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ amount: 150 });

    expect(res1.status).toBe(201);
    expect(res1.body.success).toBe(true);
    const firstBidId = res1.body.data.bid.id;
    const firstCreatedAt = res1.body.data.bid.createdAt;

    // Duplicate submission with same key
    const res2 = await request(app.getHttpServer())
      .post(`/auctions/${auctionId}/bids`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ amount: 150 });

    expect(res2.status).toBe(201);
    expect(res2.body.data.bid.id).toBe(firstBidId);
    expect(res2.body.data.bid.createdAt).toBe(firstCreatedAt);

    // Assert that the database contains strictly 1 bid
    const bidsInDb = await prisma.bid.findMany({
      where: { auctionId, amount: 150 },
    });
    expect(bidsInDb).toHaveLength(1);
  });

  it('does not replay when a different idempotency key is provided', async () => {
    if (!isPostgresAvailable) return;
    const buyer2 = await authService.register({
      email: `buyer2-idemp-${Date.now()}@example.com`,
      password: 'Password123!',
      name: 'Idempotency Buyer 2',
      role: 'BUYER',
    });

    const key1 = `diff-key-1-${Date.now()}`;
    const key2 = `diff-key-2-${Date.now()}`;

    const res1 = await request(app.getHttpServer())
      .post(`/auctions/${auctionId}/bids`)
      .set('Authorization', `Bearer ${buyer2.accessToken}`)
      .set('Idempotency-Key', key1)
      .send({ amount: 170 });

    expect(res1.status).toBe(201);

    // New key with same amount should be rejected as an under-increment or equal price
    const res2 = await request(app.getHttpServer())
      .post(`/auctions/${auctionId}/bids`)
      .set('Authorization', `Bearer ${buyer2.accessToken}`)
      .set('Idempotency-Key', key2)
      .send({ amount: 170 });

    expect(res2.status).toBe(400); // Bad Request (already holds highest bid)
  });
});
