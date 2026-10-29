import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { LifecycleService } from '../src/lifecycle/lifecycle.service';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { JwtService } from '@nestjs/jwt';

interface MockAuctionRecord {
  id: string;
  title: string;
  description: string;
  startingPrice: number;
  currentPrice: number;
  reservePrice: number | null;
  minIncrement: number;
  status: 'DRAFT' | 'ACTIVE' | 'ENDED' | 'CANCELLED';
  sellerId: string;
  winnerId: string | null;
  bidCount: number;
  startTime: Date;
  endTime: Date;
  createdAt: Date;
  updatedAt: Date;
  seller: { name: string };
  winner: { name: string } | null;
}

describe('Auctions Module (Integration)', () => {
  let app: INestApplication;
  let jwtService: JwtService;

  const mockAuctions = new Map<string, MockAuctionRecord>();
  const sellerId = '22222222-3333-4444-5555-666666666666';
  const buyerId = '33333333-4444-5555-6666-777777777777';

  let sellerToken: string;
  let buyerToken: string;

  const mockPrismaService = {
    user: {
      findById: jest.fn().mockImplementation((id: string) => {
        if (id === sellerId) {
          return Promise.resolve({
            id: sellerId,
            email: 'seller@example.com',
            name: 'Seller User',
            role: 'SELLER',
            createdAt: new Date(),
          });
        }
        if (id === buyerId) {
          return Promise.resolve({
            id: buyerId,
            email: 'buyer@example.com',
            name: 'Buyer User',
            role: 'BUYER',
            createdAt: new Date(),
          });
        }
        return Promise.resolve(null);
      }),
      findUnique: jest.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        if (where.id === sellerId) {
          return Promise.resolve({
            id: sellerId,
            email: 'seller@example.com',
            name: 'Seller User',
            role: 'SELLER',
            createdAt: new Date(),
          });
        }
        if (where.id === buyerId) {
          return Promise.resolve({
            id: buyerId,
            email: 'buyer@example.com',
            name: 'Buyer User',
            role: 'BUYER',
            createdAt: new Date(),
          });
        }
        return Promise.resolve(null);
      }),
    },
    auction: {
      create: jest.fn().mockImplementation(
        ({
          data,
        }: {
          data: {
            title: string;
            description: string;
            startingPrice: number;
            currentPrice: number;
            reservePrice?: number | null;
            minIncrement: number;
            status: 'DRAFT' | 'ACTIVE';
            sellerId: string;
            startTime: Date;
            endTime: Date;
          };
        }) => {
          const id = '44444444-5555-6666-7777-888888888888';
          const record: MockAuctionRecord = {
            id,
            title: data.title,
            description: data.description,
            startingPrice: data.startingPrice,
            currentPrice: data.currentPrice,
            reservePrice: data.reservePrice ?? null,
            minIncrement: data.minIncrement,
            status: data.status,
            sellerId: data.sellerId,
            winnerId: null,
            bidCount: 0,
            startTime: data.startTime,
            endTime: data.endTime,
            createdAt: new Date(),
            updatedAt: new Date(),
            seller: { name: 'Seller User' },
            winner: null,
          };
          mockAuctions.set(id, record);
          return Promise.resolve(record);
        },
      ),
      count: jest.fn().mockImplementation(() => Promise.resolve(mockAuctions.size)),
      findMany: jest
        .fn()
        .mockImplementation(() => Promise.resolve(Array.from(mockAuctions.values()))),
      findUnique: jest.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        return Promise.resolve(mockAuctions.get(where.id) || null);
      }),
    },
    $connect: jest.fn(),
    $disconnect: jest.fn(),
  };

  const mockRedisClient = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    multi: jest.fn().mockReturnValue({
      incr: jest.fn().mockReturnThis(),
      pttl: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        [null, 1],
        [null, 60000],
      ]),
    }),
    pexpire: jest.fn().mockResolvedValue(1),
  };

  const mockRedisService = {
    getClient: jest.fn().mockReturnValue(mockRedisClient),
    onModuleInit: jest.fn(),
    onModuleDestroy: jest.fn(),
  };

  const mockLifecycleService = {
    scheduleAuctionClose: jest.fn().mockResolvedValue(undefined),
    rescheduleAuctionClose: jest.fn().mockResolvedValue(undefined),
    closeAuction: jest.fn().mockResolvedValue({ closed: true, winnerId: null }),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrismaService)
      .overrideProvider(RedisService)
      .useValue(mockRedisService)
      .overrideProvider(LifecycleService)
      .useValue(mockLifecycleService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ZodValidationPipe());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    jwtService = moduleFixture.get<JwtService>(JwtService);

    const secret = process.env['JWT_ACCESS_SECRET'] as string;

    sellerToken = jwtService.sign(
      { sub: sellerId, email: 'seller@example.com', role: 'SELLER' },
      { secret },
    );

    buyerToken = jwtService.sign(
      { sub: buyerId, email: 'buyer@example.com', role: 'BUYER' },
      { secret },
    );
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('POST /auctions - forbids BUYER role from creating auction (403)', async () => {
    const res = await request(app.getHttpServer())
      .post('/auctions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        title: 'Vintage Watch',
        description: 'Rare mechanical wristwatch in mint condition.',
        startingPrice: 100,
        startTime: new Date().toISOString(),
        endTime: new Date(Date.now() + 86400000).toISOString(),
      })
      .expect(403);

    expect(res.body.success).toBe(false);
  });

  it('POST /auctions - allows SELLER role to create auction', async () => {
    const startTime = new Date().toISOString();
    const endTime = new Date(Date.now() + 86400000).toISOString();

    const res = await request(app.getHttpServer())
      .post('/auctions')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        title: 'Vintage Watch',
        description: 'Rare mechanical wristwatch in mint condition.',
        startingPrice: 150,
        startTime,
        endTime,
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.title).toBe('Vintage Watch');
    expect(res.body.data.currentPrice).toBe(150);
  });

  it('GET /auctions - lists auctions with pagination envelope', async () => {
    const res = await request(app.getHttpServer()).get('/auctions?page=1&limit=10').expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.page).toBe(1);
  });

  it('GET /auctions/:id - returns single auction', async () => {
    const res = await request(app.getHttpServer())
      .get('/auctions/44444444-5555-6666-7777-888888888888')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.title).toBe('Vintage Watch');
  });

  it('GET /auctions/:id - returns 404 for non-existent auction', async () => {
    const res = await request(app.getHttpServer())
      .get('/auctions/99999999-9999-9999-9999-999999999999')
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.statusCode).toBe(404);
  });
});
