import { io } from 'socket.io-client';

export async function measureSocketLatency({
  serverUrl = 'http://localhost:3001',
  subscriberUrl = null,
  bidServerUrl = 'http://localhost:3002',
  token = null,
  clientCount = 50,
  auctionId = '10000000-0000-0000-0000-000000000001',
  sampleCount = 10,
  postBidFn = null,
} = {}) {
  const targetSubscriberUrl = subscriberUrl || serverUrl;
  const sockets = [];
  const connectionPromises = [];

  console.log(
    `Connecting ${clientCount} socket clients to ${targetSubscriberUrl} (room: auction:${auctionId})...`,
  );

  // 1. Connect clients to subscriber instance
  for (let i = 0; i < clientCount; i++) {
    const p = new Promise((resolve, reject) => {
      const socket = io(targetSubscriberUrl, {
        transports: ['websocket'],
        reconnection: false,
        timeout: 5000,
      });

      socket.on('connect', () => {
        socket.emit('auction:join', { auctionId });
      });

      socket.on('auction:joined', () => {
        resolve(socket);
      });

      socket.on('connect_error', (err) => {
        reject(err);
      });

      sockets.push(socket);
    });

    connectionPromises.push(p);
  }

  try {
    await Promise.all(connectionPromises);
    console.log(`All ${clientCount} socket clients connected and joined.`);
  } catch (err) {
    for (const s of sockets) s.disconnect();
    throw new Error(`Failed to connect socket clients: ${err.message}`);
  }

  // 2. Measure cross-instance broadcast latency over multiple samples
  const latencies = [];

  const defaultPostBid = async (targetAuctionId, sampleIndex) => {
    const url = `${bidServerUrl}/auctions/${targetAuctionId}/bids`;
    const idempotencyKey = `socket-latency-test-${sampleIndex}-${Date.now()}`;
    const headers = {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await globalThis.fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ amount: 1000 + sampleIndex * 10 }),
    });

    if (!res.ok && res.status !== 409) {
      console.warn(`Post bid returned status ${res.status}`);
    }
  };

  const executePostBid = postBidFn || defaultPostBid;

  for (let sample = 0; sample < sampleCount; sample++) {
    const broadcastReceipts = [];
    const sampleSentTime = Date.now();

    const samplePromise = new Promise((resolve) => {
      let receivedCount = 0;
      const expectedReceipts = clientCount;

      const onBidPlaced = (_event) => {
        const receivedTime = Date.now();
        const latencyMs = Math.max(1, receivedTime - sampleSentTime);
        broadcastReceipts.push(latencyMs);
        receivedCount++;

        if (receivedCount >= expectedReceipts) {
          resolve();
        }
      };

      for (const s of sockets) {
        s.once('bid:placed', onBidPlaced);
      }

      // Timeout fallback
      setTimeout(() => resolve(), 3000);
    });

    try {
      await executePostBid(auctionId, sample);
    } catch (e) {
      console.warn(`Sample ${sample} post bid error:`, e.message);
    }

    await samplePromise;

    if (broadcastReceipts.length > 0) {
      latencies.push(...broadcastReceipts);
    }
  }

  // Clean up sockets
  for (const s of sockets) {
    s.disconnect();
  }

  if (latencies.length === 0) {
    return {
      connectedSocketClients: clientCount,
      samples: 0,
      broadcastDelayMinMs: 0,
      broadcastDelayP50Ms: 0,
      broadcastDelayP90Ms: 0,
      broadcastDelayP95Ms: 0,
      broadcastDelayMaxMs: 0,
    };
  }

  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p90 = latencies[Math.floor(latencies.length * 0.9)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const min = latencies[0];
  const max = latencies[latencies.length - 1];

  return {
    connectedSocketClients: clientCount,
    samples: latencies.length,
    broadcastDelayMinMs: min,
    broadcastDelayP50Ms: p50,
    broadcastDelayP90Ms: p90,
    broadcastDelayP95Ms: p95,
    broadcastDelayMaxMs: max,
  };
}

if (process.argv[1]?.endsWith('measure-socket-latency.mjs')) {
  console.log('Running standalone socket latency measurement...');
  measureSocketLatency()
    .then((result) => console.log('Socket Latency Result:', JSON.stringify(result, null, 2)))
    .catch((err) =>
      console.warn('Could not run standalone measurement (server not listening):', err.message),
    );
}
