import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { DatabaseService } from '../../database/database.service';
import { users } from '../../database/schema';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

// JwtAuthGuard's soft sibling for public routes that ENRICH their response
// for identified callers (e.g. the comments list including author emails
// for admins) instead of requiring auth. It never rejects: anonymous,
// invalid-token, and banned callers all proceed as anonymous —
// request.user is only populated for a valid, non-banned session.
@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly databaseService: DatabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const token = request.cookies?.access_token;

    if (!token) {
      return true;
    }

    let payload: JwtPayload;

    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      return true;
    }

    const user = await this.databaseService.db.query.users.findFirst({
      where: eq(users.id, payload.sub),
    });

    if (user?.isBanned) {
      return true;
    }

    request.user = payload;

    return true;
  }
}
