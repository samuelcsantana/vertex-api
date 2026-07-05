import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

declare module 'fastify' {
  interface FastifyRequest {
    user?: JwtPayload;
  }
}
