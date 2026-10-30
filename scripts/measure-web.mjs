import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getProvenanceMetadata } from './provenance.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const distAssetsDir = path.join(rootDir, 'apps', 'web', 'dist', 'assets');
const metricsDir = path.join(rootDir, 'metrics');

if (!fs.existsSync(metricsDir)) {
  fs.mkdirSync(metricsDir, { recursive: true });
}

if (!fs.existsSync(distAssetsDir)) {
  console.error(
    `Dist assets directory not found at ${distAssetsDir}. Run npm run build -w apps/web first.`,
  );
  process.exit(1);
}

const files = fs.readdirSync(distAssetsDir);

let totalJsBytes = 0;
let totalJsGzipBytes = 0;
let totalCssBytes = 0;
let totalCssGzipBytes = 0;

const chunks = {};

for (const file of files) {
  const filePath = path.join(distAssetsDir, file);
  const content = fs.readFileSync(filePath);
  const gzipped = zlib.gzipSync(content);

  const size = content.length;
  const gzipSize = gzipped.length;

  if (file.endsWith('.js')) {
    totalJsBytes += size;
    totalJsGzipBytes += gzipSize;

    if (file.startsWith('vendor-react')) {
      chunks.vendorReact = { size, gzipSize };
    } else if (file.startsWith('vendor-query')) {
      chunks.vendorQuery = { size, gzipSize };
    } else if (file.startsWith('vendor-socket')) {
      chunks.vendorSocket = { size, gzipSize };
    } else if (file.startsWith('index-')) {
      chunks.mainIndex = { size, gzipSize };
    }
  } else if (file.endsWith('.css')) {
    totalCssBytes += size;
    totalCssGzipBytes += gzipSize;
    chunks.css = { size, gzipSize };
  }
}

async function auditLighthouse(port = 4173) {
  if (process.env['SKIP_LIGHTHOUSE'] === 'true') {
    console.log('SKIP_LIGHTHOUSE is set; skipping Lighthouse audit.');
    return null;
  }

  const distDir = path.join(rootDir, 'apps', 'web', 'dist');
  const lhOutputPath = path.join(metricsDir, 'lighthouse.json');

  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = req.url.split('?')[0];
      let filePath = path.join(distDir, urlPath === '/' ? 'index.html' : urlPath);
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(distDir, 'index.html');
      }
      const ext = path.extname(filePath);
      const mimeTypes = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
      };
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    });

    server.listen(port, () => {
      console.log(`Preview server listening on port ${port} for Lighthouse audit...`);
      const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
      const args = [
        '--yes',
        'lighthouse',
        `http://localhost:${port}`,
        '--chrome-flags="--headless --no-sandbox --disable-dev-shm-usage"',
        '--output=json',
        '--output-path=metrics/lighthouse.json',
        '--only-categories=performance,accessibility,best-practices,seo',
      ];

      const child = spawn(npxCmd, args, { stdio: 'inherit', shell: true });

      child.on('close', (code) => {
        let scores = null;
        if (code === 0 && fs.existsSync(lhOutputPath)) {
          try {
            const raw = JSON.parse(fs.readFileSync(lhOutputPath, 'utf-8'));
            scores = {
              performance: Math.round((raw.categories?.performance?.score ?? 0) * 100),
              accessibility: Math.round((raw.categories?.accessibility?.score ?? 0) * 100),
              bestPractices: Math.round((raw.categories?.['best-practices']?.score ?? 0) * 100),
              seo: Math.round((raw.categories?.seo?.score ?? 0) * 100),
            };
            console.log('Lighthouse audit completed successfully:', scores);
          } catch (e) {
            console.warn('Could not parse Lighthouse JSON report:', e.message);
          }
        } else {
          console.warn(`Lighthouse exited with code ${code}`);
        }
        server.close(() => resolve(scores));
      });

      child.on('error', (err) => {
        console.warn('Failed to start Lighthouse process:', err.message);
        server.close(() => resolve(null));
      });
    });

    server.on('error', (err) => {
      console.warn(`Preview server error on port ${port}:`, err.message);
      resolve(null);
    });
  });
}

const provenance = getProvenanceMetadata();
const lighthouseScores = await auditLighthouse(4173);

const report = {
  ...provenance,
  bundle: {
    totalJsBytes,
    totalJsGzipBytes,
    totalJsKb: Number((totalJsBytes / 1024).toFixed(2)),
    totalJsGzipKb: Number((totalJsGzipBytes / 1024).toFixed(2)),
    totalCssBytes,
    totalCssGzipBytes,
    totalCssKb: Number((totalCssBytes / 1024).toFixed(2)),
    totalCssGzipKb: Number((totalCssGzipBytes / 1024).toFixed(2)),
    chunks: Object.fromEntries(
      Object.entries(chunks).map(([key, val]) => [
        key,
        {
          rawKb: Number((val.size / 1024).toFixed(2)),
          gzipKb: Number((val.gzipSize / 1024).toFixed(2)),
        },
      ]),
    ),
  },
  ...(lighthouseScores ? { lighthouse: lighthouseScores } : {}),
};

const outputPath = path.join(metricsDir, 'web.json');
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf-8');
console.log(`Bundle metrics successfully generated and saved to ${outputPath}`);
console.log(JSON.stringify(report, null, 2));
