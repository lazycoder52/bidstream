import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

export function verifyReadmeMetrics() {
  const readmePath = path.join(rootDir, 'README.md');
  const loadtestPath = path.join(rootDir, 'metrics', 'loadtest.json');
  const webPath = path.join(rootDir, 'metrics', 'web.json');

  if (!fs.existsSync(readmePath)) {
    throw new Error(`README.md not found at ${readmePath}`);
  }
  if (!fs.existsSync(loadtestPath)) {
    throw new Error(`metrics/loadtest.json not found at ${loadtestPath}`);
  }
  if (!fs.existsSync(webPath)) {
    throw new Error(`metrics/web.json not found at ${webPath}`);
  }

  const readme = fs.readFileSync(readmePath, 'utf-8');
  const loadtest = JSON.parse(fs.readFileSync(loadtestPath, 'utf-8'));
  const web = JSON.parse(fs.readFileSync(webPath, 'utf-8'));

  const errors = [];

  // Check provenance label
  if (
    !readme.includes(
      'GitHub Actions runner, load generator and server share the machine',
    )
  ) {
    errors.push(
      'README missing required provenance label: "GitHub Actions runner, load generator and server share the machine"',
    );
  }

  // Check throughput
  const throughputStr = `${loadtest.throughput.requestsPerSecond}`;
  if (!readme.includes(throughputStr)) {
    errors.push(`README missing expected throughput figure: ${throughputStr} req/s`);
  }

  // Check bid latency p50
  const bidP50Str = `${loadtest.latencies.httpBidP50Ms}`;
  if (!readme.includes(bidP50Str)) {
    errors.push(`README missing expected bid p50 latency: ${bidP50Str} ms`);
  }

  // Check bid latency p95
  const bidP95Str = `${loadtest.latencies.httpBidP95Ms}`;
  if (!readme.includes(bidP95Str)) {
    errors.push(`README missing expected bid p95 latency: ${bidP95Str} ms`);
  }

  // Check socket broadcast delay p95
  const broadcastP95Str = `${loadtest.realtime.broadcastDelayP95Ms}`;
  if (!readme.includes(broadcastP95Str)) {
    errors.push(`README missing expected broadcast delay p95: ${broadcastP95Str} ms`);
  }

  // Check invariant violations (0)
  const violationsStr = `${loadtest.invariants.totalViolations}`;
  if (!readme.includes(`${violationsStr} violations`) && !readme.includes(`violations: ${violationsStr}`) && !readme.includes(`| ${violationsStr} |`)) {
    errors.push(`README missing expected zero invariant violations confirmation`);
  }

  // Check Lighthouse scores
  const lhPerfStr = `${web.lighthouse.performance}`;
  const lhA11yStr = `${web.lighthouse.accessibility}`;
  if (!readme.includes(lhPerfStr) || !readme.includes(lhA11yStr)) {
    errors.push(`README missing Lighthouse scores (Perf: ${lhPerfStr}, A11y: ${lhA11yStr})`);
  }

  // Check bundle sizes
  const totalJsKbStr = `${web.bundle.totalJsKb}`;
  const totalJsGzipKbStr = `${web.bundle.totalJsGzipKb}`;
  if (!readme.includes(totalJsKbStr) || !readme.includes(totalJsGzipKbStr)) {
    errors.push(`README missing bundle size figures (${totalJsKbStr} KB raw, ${totalJsGzipKbStr} KB gzip)`);
  }

  if (errors.length > 0) {
    console.error('README metrics verification failed with discrepancies:');
    for (const e of errors) {
      console.error(` - ${e}`);
    }
    process.exit(1);
  }

  console.log('SUCCESS: All figures in README.md strictly match metrics/*.json without discrepancies.');
  return true;
}

if (process.argv[1]?.endsWith('verify-readme-metrics.mjs')) {
  verifyReadmeMetrics();
}
