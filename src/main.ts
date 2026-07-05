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
    new FastifyAdapter(),
  );

  app.enableCors({
    origin: true,
    credentials: true,
  });

  await app.register(helmet);
  await app.register(cookie);

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Vertex API')
    .setDescription('API documentation for the Vertex backend platform')
    .setVersion('1.0')
    .addCookieAuth('access_token')
    .build();

  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, swaggerDocument);

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
void bootstrap();
