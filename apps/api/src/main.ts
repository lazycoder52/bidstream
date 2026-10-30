import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { ZodValidationPipe } from 'nestjs-zod';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';
import { RedisIoAdapter } from './realtime/redis-io.adapter.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const logger = app.get(Logger);
  app.useLogger(logger);

  app.use(helmet());
  app.use(cookieParser());

  const configService = app.get(ConfigService);
  const rawCorsOrigin = configService.get<string>('CORS_ORIGIN', 'http://localhost:5173');
  const allowedOrigins = rawCorsOrigin
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // Allow requests with no origin (e.g. mobile apps, curl, or server-to-server)
      if (!origin) {
        return callback(null, true);
      }
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS origin '${origin}' not allowed by BidStream policy`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'x-request-id'],
  });

  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new HttpExceptionFilter());

  // WebSocket Redis Adapter for multi-instance scaling
  const isInMemory = configService.get<boolean>('REDIS_IN_MEMORY', false);
  const nodeEnv = configService.get<string>('NODE_ENV', 'development');

  if (isInMemory && nodeEnv !== 'production') {
    logger.warn(
      'REDIS_IN_MEMORY dev flag active: using standalone in-memory Socket.IO adapter (single node only).',
    );
  } else {
    const redisIoAdapter = new RedisIoAdapter(app);
    const redisHost = configService.get<string>('REDIS_HOST', 'localhost');
    const redisPort = configService.get<number>('REDIS_PORT', 6379);
    await redisIoAdapter.connectToRedis(redisHost, redisPort, false);
    app.useWebSocketAdapter(redisIoAdapter);
  }

  // Swagger OpenAPI Documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle('BidStream API')
    .setDescription('Real-time auction platform with high-concurrency correctness')
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        description: 'Enter JWT access token',
        in: 'header',
      },
      'bearer',
    )
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const port = process.env['PORT'] ? Number(process.env['PORT']) : 3001;
  await app.listen(port);
  logger.log(`BidStream API server running on port ${port} (Swagger docs at /docs)`);
}

bootstrap();
