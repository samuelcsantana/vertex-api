import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { users } from '../database/schema';

declare module 'fastify' {
  interface FastifyRequest {
    // The token's claims. Cheap, but frozen at issue time.
    user?: JwtPayload;
    // The row JwtAuthGuard already had to read to check isBanned, kept so
    // handlers can use current data without asking for it a second time.
    // Undefined when no guard ran, or when the row is gone — a token can
    // outlive the account it names.
    currentUser?: typeof users.$inferSelect;
  }
}
