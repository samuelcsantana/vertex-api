import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

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

  // Same env var (and fallback) the OAuth callback redirect uses, so there's
  // one source of truth for vertex-web's origin instead of two that could
  // drift apart if the frontend's deployed URL ever changes.
  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';

  app.enableCors({
    origin: [frontendUrl],
    credentials: true,
  });

  const cookieSecret = process.env.COOKIE_SECRET;

  if (!cookieSecret) {
    throw new Error('COOKIE_SECRET environment variable is not defined');
  }

  await app.register(helmet, {
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  });
  await app.register(cookie, { secret: cookieSecret });

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
