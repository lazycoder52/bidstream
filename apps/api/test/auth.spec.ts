import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

interface MockUserRecord {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  role: 'BUYER' | 'SELLER' | 'ADMIN';
  createdAt: Date;
  updatedAt: Date;
}

describe('Auth Module (Integration)', () => {
  let app: INestApplication;
  const mockUsers = new Map<string, MockUserRecord>();
  const mockRedisStorage = new Map<string, string>();

  const mockPrismaService = {
    user: {
      findUnique: jest
        .fn()
        .mockImplementation(({ where }: { where: { email?: string; id?: string } }) => {
          if (where.email) {
            const user = Array.from(mockUsers.values()).find((u) => u.email === where.email);
            return Promise.resolve(user || null);
          }
          if (where.id) {
            return Promise.resolve(mockUsers.get(where.id) || null);
          }
          return Promise.resolve(null);
        }),
      create: jest.fn().mockImplementation(
        ({
          data,
        }: {
          data: {
            email: string;
            passwordHash: string;
            name: string;
            role?: 'BUYER' | 'SELLER' | 'ADMIN';
          };
        }) => {
          const id = '11111111-2222-3333-4444-555555555555';
          const user: MockUserRecord = {
            id,
            email: data.email,
            passwordHash: data.passwordHash,
            name: data.name,
            role: data.role || 'BUYER',
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          mockUsers.set(id, user);
          return Promise.resolve({
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            createdAt: user.createdAt,
          });
        },
      ),
    },
    $connect: jest.fn(),
    $disconnect: jest.fn(),
  };

  const mockRedisClient = {
    get: jest
      .fn()
      .mockImplementation((key: string) => Promise.resolve(mockRedisStorage.get(key) || null)),
    set: jest.fn().mockImplementation((key: string, val: string) => {
      mockRedisStorage.set(key, val);
      return Promise.resolve('OK');
    }),
    del: jest.fn().mockImplementation((...keys: string[]) => {
      keys.forEach((k) => mockRedisStorage.delete(k));
      return Promise.resolve(keys.length);
    }),
    keys: jest.fn().mockImplementation((pattern: string) => {
      const prefix = pattern.replace('*', '');
      const matched = Array.from(mockRedisStorage.keys()).filter((k) => k.startsWith(prefix));
      return Promise.resolve(matched);
    }),
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

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrismaService)
      .overrideProvider(RedisService)
      .useValue(mockRedisService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ZodValidationPipe());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('POST /auth/register - registers a new user', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'bidder@example.com',
        password: 'Password123',
        name: 'John Bidder',
        role: 'BUYER',
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.user.email).toBe('bidder@example.com');
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('POST /auth/register - rejects duplicate email with 409', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'bidder@example.com',
        password: 'Password123',
        name: 'Another Bidder',
        role: 'BUYER',
      })
      .expect(409);

    expect(res.body.success).toBe(false);
    expect(res.body.statusCode).toBe(409);
    expect(res.body.message).toContain('already exists');
  });

  it('POST /auth/login - logs in successfully and returns tokens', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'bidder@example.com',
        password: 'Password123',
      })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBeDefined();
  });

  it('POST /auth/login - rejects invalid password with 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'bidder@example.com',
        password: 'WrongPassword123',
      })
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.statusCode).toBe(401);
  });
});
