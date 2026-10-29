import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { MetricsService } from './metrics.service.js';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metricsService: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const startTime = process.hrtime();

    return next.handle().pipe(
      tap({
        next: () => {
          this.record(req, res.statusCode, startTime);
        },
        error: (err: { status?: number; statusCode?: number }) => {
          const status = err.status || err.statusCode || 500;
          this.record(req, status, startTime);
        },
      }),
    );
  }

  private record(req: Request, statusCode: number, startTime: [number, number]): void {
    const diff = process.hrtime(startTime);
    const durationSeconds = diff[0] + diff[1] / 1e9;
    const route = req.route?.path || req.path || 'unknown';
    this.metricsService.recordHttpRequest(req.method, route, statusCode, durationSeconds);
  }
}
