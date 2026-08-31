import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    // trustProxy: without it, Fastify reads the raw socket address as the
    // client IP, which behind any reverse proxy is the proxy's address on
    // every single request rather than the visitor's. Per-IP rate limiting
    // would then bucket all traffic into one.
    //
    // This is the entry point for a long-lived server — local development,
    // and any container host. The serverless entry point sets the same flag
    // for a different proxy and does not stop there; see lambda.ts.
    new FastifyAdapter({ trustProxy: true }),
  );

  await configureApp(app);

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Vertex API')
    .setDescription('API documentation for the Vertex backend platform')
    .setVersion('1.0')
    .addCookieAuth('access_token')
    .build();

  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, swaggerDocument);

  await app.listen(process.env.PORT ?? 3333, '0.0.0.0');
}
void bootstrap();
