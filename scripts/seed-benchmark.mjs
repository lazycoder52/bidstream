import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

export const BENCHMARK_SELLER_ID = '00000000-0000-0000-0000-000000000001';
export const BENCHMARK_BIDDER_ID = '00000000-0000-0000-0000-000000000002';

export const BENCHMARK_AUCTION_IDS = Array.from({ length: 20 }, (_, i) => {
  const num = (i + 1).toString().padStart(12, '0');
  return `10000000-0000-0000-0000-${num}`;
});

export function generateJwt(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
}

export async function seedBenchmarkData(prismaClient = null) {
  const prisma = prismaClient || new PrismaClient();
  const shouldDisconnect = !prismaClient;

  try {
    console.log('Seeding benchmark users and auctions in PostgreSQL...');

    // 1. Seller user
    await prisma.user.upsert({
      where: { id: BENCHMARK_SELLER_ID },
      update: {},
      create: {
        id: BENCHMARK_SELLER_ID,
        email: 'benchmark-seller@example.com',
        name: 'Benchmark Seller',
        passwordHash: 'dummy_argon2_hash',
        role: 'SELLER',
      },
    });

    // 2. Bidder user
    await prisma.user.upsert({
      where: { id: BENCHMARK_BIDDER_ID },
      update: {},
      create: {
        id: BENCHMARK_BIDDER_ID,
        email: 'benchmark-bidder@example.com',
        name: 'Benchmark Bidder',
        passwordHash: 'dummy_argon2_hash',
        role: 'BUYER',
      },
    });

    // 3. 20 Active Auctions
    const now = new Date();
    const startTime = new Date(now.getTime() - 3600000); // 1 hr ago
    const endTime = new Date(now.getTime() + 7200000); // 2 hrs in future

    for (const auctionId of BENCHMARK_AUCTION_IDS) {
      await prisma.auction.upsert({
        where: { id: auctionId },
        update: {
          status: 'ACTIVE',
          startTime,
          endTime,
        },
        create: {
          id: auctionId,
          title: `Contention Benchmark Auction ${auctionId.slice(-4)}`,
          description: 'High-concurrency bidding contention test listing',
          startingPrice: 100,
          currentPrice: 100,
          reservePrice: null,
          minIncrement: 1.0,
          status: 'ACTIVE',
          sellerId: BENCHMARK_SELLER_ID,
          startTime,
          endTime,
        },
      });
    }

    const secret =
      process.env['JWT_ACCESS_SECRET'] ||
      'change_this_to_a_secure_random_string_at_least_32_characters_long';

    const tokenPayload = {
      sub: BENCHMARK_BIDDER_ID,
      email: 'benchmark-bidder@example.com',
      role: 'BUYER',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 86400, // 24 hours
    };

    const token = generateJwt(tokenPayload, secret);
    const tokenPath = path.join(rootDir, 'scripts', '.benchmark-token');
    fs.writeFileSync(tokenPath, token, 'utf-8');

    console.log(`Seeded 20 auctions and bidder token saved to ${tokenPath}`);
    return { token, auctionIds: BENCHMARK_AUCTION_IDS };
  } finally {
    if (shouldDisconnect) {
      await prisma.$disconnect();
    }
  }
}

if (process.argv[1]?.endsWith('seed-benchmark.mjs')) {
  seedBenchmarkData()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Seeding failed:', err);
      process.exit(1);
    });
}
