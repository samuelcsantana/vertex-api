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
    // client IP — behind Render's own reverse proxy, that's Render's proxy
    // IP for every single request, not the real visitor's. Per-IP rate
    // limiting would then bucket all traffic together instead of actually
    // distinguishing abusive clients.
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
