import os from 'node:os';
import { execSync } from 'node:child_process';

export function getProvenanceMetadata() {
  let commitSha = process.env['GITHUB_SHA'];
  if (!commitSha) {
    try {
      commitSha = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
    } catch {
      commitSha = 'local-development';
    }
  }

  const cpus = os.cpus();
  const runnerSpecs = {
    cpuModel: cpus[0]?.model || 'Generic CPU',
    cpuCores: cpus.length,
    ramMb: Math.round(os.totalmem() / (1024 * 1024)),
    os: `${os.type()} ${os.release()} (${os.arch()})`,
  };

  return {
    commitSha,
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    runnerSpecs,
    serviceVersions: {
      postgres: '16-alpine',
      redis: '7-alpine',
    },
    environment: 'GitHub Actions runner, load generator and server share the machine',
  };
}
