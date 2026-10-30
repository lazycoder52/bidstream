import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { checkInvariants } from './check-invariants.mjs';
import { measureSocketLatency } from './measure-socket-latency.mjs';
import { seedBenchmarkData } from './seed-benchmark.mjs';
import { getProvenanceMetadata } from './provenance.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const metricsDir = path.join(rootDir, 'metrics');

function isCommandAvailable(cmd) {
  try {
    const isWindows = process.platform === 'win32';
    const checkCmd = isWindows ? `where ${cmd}` : `which ${cmd}`;
    execSync(checkCmd, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function runBenchmarkSuite() {
  console.log('====================================================');
  console.log('BidStream Provenance & CI Benchmarks Runner');
  console.log('====================================================');

  const provenance = getProvenanceMetadata();
  console.log('Environment:', provenance.environment);
  console.log('Commit SHA:', provenance.commitSha);
  console.log('Runner CPU:', provenance.runnerSpecs.cpuCores, 'cores');
  console.log('Runner RAM:', provenance.runnerSpecs.ramMb, 'MB');

  const prisma = new PrismaClient();
  await prisma.$connect();
  console.log('Connected to PostgreSQL.');

  // 1. Seed 20 benchmark auctions and test users
  const { token, tokens, auctionIds } = await seedBenchmarkData(prisma);

  // 2. Measure real-time Socket.IO latency across two API instances via Redis
  console.log('\nMeasuring cross-instance WebSocket broadcast delay...');
  let socketMetrics;
  try {
    socketMetrics = await measureSocketLatency({
      serverUrl: process.env['SUBSCRIBER_URL'] || 'http://localhost:3001',
      bidServerUrl: process.env['PUBLISHER_URL'] || 'http://localhost:3002',
      token,
      auctionId: auctionIds[0],
      clientCount: 50,
      sampleCount: 10,
    });
    console.log(`Measured p95 broadcast delay: ${socketMetrics.broadcastDelayP95Ms} ms`);
  } catch (err) {
    console.error(`FATAL: Socket latency measurement failed: ${err.message}`);
    process.exit(1);
  }

  // 3. Run k6 Bidding Storm against clustered API instances
  if (!isCommandAvailable('k6')) {
    console.error('FATAL: k6 binary is required on PATH to execute the benchmark suite.');
    process.exit(1);
  }

  const summaryExportPath = path.join(metricsDir, 'k6-summary.json');
  console.log('\nRunning k6 high-concurrency bidding storm against API cluster...');
  const k6ScriptPath = path.join(rootDir, 'scripts', 'k6-bidding-storm.js');
  const apiUrls = process.env['API_URLS'] || 'http://localhost:3001,http://localhost:3002';
  const benchmarkTokensArg = tokens?.length ? `-e BENCHMARK_TOKENS="${tokens.join(',')}"` : '';

  try {
    execSync(
      `k6 run --summary-export="${summaryExportPath}" -e API_URLS="${apiUrls}" ${benchmarkTokensArg} -e BENCHMARK_TOKEN="${token}" "${k6ScriptPath}"`,
      { stdio: 'inherit', cwd: rootDir },
    );
  } catch (k6Err) {
    console.error('FATAL: k6 execution failed:', k6Err.message);
    process.exit(1);
  }

  if (!fs.existsSync(summaryExportPath)) {
    console.error(`FATAL: k6 summary export file not found at ${summaryExportPath}`);
    process.exit(1);
  }

  const k6Summary = JSON.parse(fs.readFileSync(summaryExportPath, 'utf-8'));
  const m = k6Summary.metrics;

  const totalReqs = m['http_reqs']?.values?.count ?? m['http_reqs']?.count ?? 0;
  const reqRate = m['http_reqs']?.values?.rate ?? m['http_reqs']?.rate ?? 0;
  const conflicts = m['bids_conflict_409']?.values?.count ?? m['bids_conflict_409']?.count ?? 0;
  const accepted = m['bids_accepted']?.values?.count ?? m['bids_accepted']?.count ?? 0;
  const rejected = m['bids_rejected']?.values?.count ?? m['bids_rejected']?.count ?? conflicts;
  const bidDur = m['bid_latency_ms']?.values ?? m['bid_latency_ms'];
  const browseDur = m['browse_latency_ms']?.values ?? m['browse_latency_ms'];

  // Real error rate computed directly from k6 http_req_failed metric
  const reqFailedRate = m['http_req_failed']?.values?.rate ?? m['http_req_failed']?.rate ?? 0;
  const errorRatePercent = Number((reqFailedRate * 100).toFixed(2));

  if (!totalReqs || !bidDur) {
    console.error('FATAL: Incomplete k6 metrics gathered from load storm.');
    process.exit(1);
  }

  const throughputMetrics = {
    requestsPerSecond: Number(reqRate.toFixed(1)),
    totalRequests: totalReqs,
    successfulRequests: accepted + conflicts,
    acceptedBids: accepted,
    rejectedBids: rejected,
    conflictResponses409: conflicts,
    errorRatePercent,
  };

  const latencyMetrics = {
    httpBidP50Ms: Number((bidDur['p(50)'] ?? bidDur['med'] ?? 0).toFixed(1)),
    httpBidP90Ms: Number((bidDur['p(90)'] ?? 0).toFixed(1)),
    httpBidP95Ms: Number((bidDur['p(95)'] ?? 0).toFixed(1)),
    httpBrowseP50Ms: browseDur ? Number((browseDur['p(50)'] ?? browseDur['med'] ?? 0).toFixed(1)) : 0,
    httpBrowseP95Ms: browseDur ? Number((browseDur['p(95)'] ?? 0).toFixed(1)) : 0,
  };

  // 4. Invariant audit
  console.log('\nRunning database invariant verification...');
  const invariantResult = await checkInvariants(prisma);
  await prisma.$disconnect();

  if (!invariantResult.passed) {
    console.error('FATAL: Invariant verification failed!', invariantResult.violations);
    process.exit(1);
  }
  console.log(
    `SUCCESS: 0 invariant violations across ${invariantResult.totalAuctionsChecked} auctions (${invariantResult.totalBidsChecked} bids).`,
  );

  // 5. Build and save loadtest.json
  const report = {
    ...provenance,
    configuration: {
      virtualUsers: 500,
      targetAuctions: 20,
      durationSeconds: 70,
      concurrencyEngine: 'Pessimistic Row Lock (SELECT ... FOR UPDATE)',
    },
    throughput: throughputMetrics,
    latencies: latencyMetrics,
    realtime: {
      connectedSocketClients: socketMetrics.connectedSocketClients,
      broadcastDelayMinMs: socketMetrics.broadcastDelayMinMs,
      broadcastDelayP50Ms: socketMetrics.broadcastDelayP50Ms,
      broadcastDelayP90Ms: socketMetrics.broadcastDelayP90Ms,
      broadcastDelayP95Ms: socketMetrics.broadcastDelayP95Ms,
      broadcastDelayMaxMs: socketMetrics.broadcastDelayMaxMs,
    },
    invariants: {
      auctionsAudited: invariantResult.totalAuctionsChecked,
      bidsAudited: invariantResult.totalBidsChecked,
      priceMismatchViolations: 0,
      bidCountMismatchViolations: 0,
      nonMonotonicViolations: 0,
      duplicatePriceViolations: 0,
      orphanBidViolations: 0,
      statusViolations: 0,
      totalViolations: invariantResult.violationsCount,
      passed: invariantResult.passed,
    },
  };

  if (!fs.existsSync(metricsDir)) {
    fs.mkdirSync(metricsDir, { recursive: true });
  }

  const outputPath = path.join(metricsDir, 'loadtest.json');
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf-8');

  console.log(`\nMetrics successfully saved to: ${outputPath}`);
  console.log('----------------------------------------------------');
  console.log(` Throughput:      ${report.throughput.requestsPerSecond} req/s`);
  console.log(` Accepted Bids:   ${report.throughput.acceptedBids}`);
  console.log(` Rejected Bids:   ${report.throughput.rejectedBids}`);
  console.log(` Error Rate:      ${report.throughput.errorRatePercent} %`);
  console.log(` Bid Latency p50: ${report.latencies.httpBidP50Ms} ms`);
  console.log(` Bid Latency p95: ${report.latencies.httpBidP95Ms} ms`);
  console.log(` Socket Delay p95:${report.realtime.broadcastDelayP95Ms} ms`);
  console.log(` Invariants:      ${report.invariants.totalViolations} violations`);
  console.log('====================================================\n');
}

runBenchmarkSuite().catch((err) => {
  console.error('Fatal error running benchmark suite:', err);
  process.exit(1);
});
