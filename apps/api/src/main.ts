import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  const port = process.env['PORT'] ? Number(process.env['PORT']) : 3001;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`BidStream API server running on port ${port}`);
}

bootstrap();
