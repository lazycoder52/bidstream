import { Injectable, OnModuleInit } from '@nestjs/common';
import * as client from 'prom-client';

@Injectable()
export class MetricsService implements OnModuleInit {
  private readonly registry: client.Registry;

  public readonly httpRequestsTotal: client.Counter<string>;
  public readonly httpRequestDurationSeconds: client.Histogram<string>;
  public readonly bidsTotal: client.Counter<string>;
  public readonly activeSocketConnections: client.Gauge<string>;
  public readonly auctionClosingDurationSeconds: client.Histogram<string>;

  constructor() {
    this.registry = new client.Registry();

    this.httpRequestsTotal = new client.Counter({
      name: 'bidstream_http_requests_total',
      help: 'Total HTTP requests processed by BidStream API',
      labelNames: ['method', 'route', 'status_code'],
      registers: [this.registry],
    });

    this.httpRequestDurationSeconds = new client.Histogram({
      name: 'bidstream_http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [this.registry],
    });

    this.bidsTotal = new client.Counter({
      name: 'bidstream_bids_total',
      help: 'Total bids placed, partitioned by acceptance status',
      labelNames: ['status'],
      registers: [this.registry],
    });

    this.activeSocketConnections = new client.Gauge({
      name: 'bidstream_active_socket_connections',
      help: 'Count of currently active WebSocket client connections',
      registers: [this.registry],
    });

    this.auctionClosingDurationSeconds = new client.Histogram({
      name: 'bidstream_auction_closing_duration_seconds',
      help: 'Latency required to transition auction to closed state',
      labelNames: ['source'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
      registers: [this.registry],
    });
  }

  onModuleInit(): void {
    client.collectDefaultMetrics({
      register: this.registry,
      prefix: 'bidstream_',
    });
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  getContentType(): string {
    return this.registry.contentType;
  }

  recordHttpRequest(
    method: string,
    route: string,
    statusCode: number,
    durationSeconds: number,
  ): void {
    const labels = { method, route, status_code: String(statusCode) };
    this.httpRequestsTotal.inc(labels);
    this.httpRequestDurationSeconds.observe(labels, durationSeconds);
  }

  incrementBids(status: 'accepted' | 'rejected'): void {
    this.bidsTotal.inc({ status });
  }

  setActiveSocketConnections(count: number): void {
    this.activeSocketConnections.set(count);
  }

  recordAuctionClosing(source: 'worker' | 'sweeper', durationSeconds: number): void {
    this.auctionClosingDurationSeconds.observe({ source }, durationSeconds);
  }
}
