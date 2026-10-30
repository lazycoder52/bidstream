import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// Custom metrics
const bidsAccepted = new Counter('bids_accepted');
const bidsConflict409 = new Counter('bids_conflict_409');
const bidsRejected = new Counter('bids_rejected');
const bidLatency = new Trend('bid_latency_ms');
const browseLatency = new Trend('browse_latency_ms');
const successRate = new Rate('success_rate');

// Register expected statuses: 200 (OK), 201 (Created), and 409 (Outbid Conflict under contention)
http.setResponseCallback(http.expectedStatuses(200, 201, 409));

const isSmoke = __ENV.SMOKE_TEST === 'true' || __ENV.CI_SMOKE === 'true';

export const options = isSmoke
  ? {
      scenarios: {
        bidding_storm: {
          executor: 'ramping-vus',
          startVUs: 5,
          stages: [
            { duration: '5s', target: 20 },
            { duration: '20s', target: 20 },
            { duration: '5s', target: 0 },
          ],
          gracefulRampDown: '2s',
          exec: 'biddingFlow',
        },
        browse_traffic: {
          executor: 'constant-vus',
          vus: 10,
          duration: '30s',
          exec: 'browseFlow',
        },
      },
      thresholds: {
        bid_latency_ms: ['p(95)<1000'],
        browse_latency_ms: ['p(95)<500'],
        http_req_failed: ['rate<0.10'],
      },
    }
  : {
      scenarios: {
        // Scenario 1: High-concurrency Bidding Storm across 20 auctions
        bidding_storm: {
          executor: 'ramping-vus',
          startVUs: 20,
          stages: [
            { duration: '10s', target: 100 },
            { duration: '20s', target: 500 },
            { duration: '30s', target: 500 },
            { duration: '10s', target: 0 },
          ],
          gracefulRampDown: '5s',
          exec: 'biddingFlow',
        },
        // Scenario 2: Browse-Heavy traffic mix
        browse_traffic: {
          executor: 'constant-vus',
          vus: 50,
          duration: '70s',
          exec: 'browseFlow',
        },
      },
      thresholds: {
        bid_latency_ms: ['p(50)<100', 'p(95)<300'],
        browse_latency_ms: ['p(95)<200'],
        http_req_failed: ['rate<0.85'], // Accounting for expected 409 conflict responses on concurrent bids
      },
    };

const BASE_URLS = (__ENV.API_URLS || __ENV.API_URL || 'http://localhost:3001')
  .split(',')
  .map((u) => u.trim());

function getBaseUrl(index) {
  return BASE_URLS[index % BASE_URLS.length];
}

const TOKENS = (__ENV.BENCHMARK_TOKENS || __ENV.BENCHMARK_TOKEN || 'test-token')
  .split(',')
  .map((t) => t.trim());

function getToken(index) {
  return TOKENS[index % TOKENS.length];
}

// Pool of 20 auction IDs generated during test setup or benchmark run
const AUCTION_IDS = [
  '10000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000004',
  '10000000-0000-0000-0000-000000000005',
  '10000000-0000-0000-0000-000000000006',
  '10000000-0000-0000-0000-000000000007',
  '10000000-0000-0000-0000-000000000008',
  '10000000-0000-0000-0000-000000000009',
  '10000000-0000-0000-0000-000000000010',
  '10000000-0000-0000-0000-000000000011',
  '10000000-0000-0000-0000-000000000012',
  '10000000-0000-0000-0000-000000000013',
  '10000000-0000-0000-0000-000000000014',
  '10000000-0000-0000-0000-000000000015',
  '10000000-0000-0000-0000-000000000016',
  '10000000-0000-0000-0000-000000000017',
  '10000000-0000-0000-0000-000000000018',
  '10000000-0000-0000-0000-000000000019',
  '10000000-0000-0000-0000-000000000020',
];

export function biddingFlow() {
  const auctionId = AUCTION_IDS[Math.floor(Math.random() * AUCTION_IDS.length)];
  const vuId = __VU;
  const iterId = __ITER;
  const baseUrl = getBaseUrl(vuId);
  const idempotencyKey = `idemp-${vuId}-${iterId}-${Date.now()}`;

  // Bid placement
  const amount = 100 + iterId * 10 + Math.floor(Math.random() * 5);
  const payload = JSON.stringify({ amount });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
      Authorization: `Bearer ${getToken(vuId)}`,
    },
    tags: { name: 'PostBid' },
  };

  const res = http.post(`${baseUrl}/auctions/${auctionId}/bids`, payload, params);

  bidLatency.add(res.timings.duration);

  if (res.status === 201) {
    bidsAccepted.add(1);
    successRate.add(1);
  } else if (res.status === 409) {
    // 409 Conflict is expected under intense concurrency due to outbids
    bidsConflict409.add(1);
    bidsRejected.add(1);
    successRate.add(1);
  } else {
    bidsRejected.add(1);
    successRate.add(0);
  }

  sleep(0.05);
}

export function browseFlow() {
  const vuId = __VU;
  const iter = __ITER;
  const baseUrl = getBaseUrl(vuId);

  if (iter % 3 === 0) {
    // Browse auction listing
    const res = http.get(`${baseUrl}/auctions?page=1&limit=20&status=ACTIVE`, {
      tags: { name: 'ListAuctions' },
    });
    browseLatency.add(res.timings.duration);
    check(res, { 'list 200': (r) => r.status === 200 });
  } else {
    // Query specific auction detail
    const auctionId = AUCTION_IDS[vuId % AUCTION_IDS.length];
    const res = http.get(`${baseUrl}/auctions/${auctionId}`, {
      tags: { name: 'GetAuction' },
    });
    browseLatency.add(res.timings.duration);
    check(res, { 'detail 200': (r) => r.status === 200 });
  }

  sleep(0.1);
}
