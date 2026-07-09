import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { DatabaseService } from '../../database/database.service';
import { users } from '../../database/schema';
import { ErrorCode } from '../../common/constants/error-codes';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly databaseService: DatabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const token = request.cookies?.access_token;

    if (!token) {
      throw new UnauthorizedException('Authentication token not found');
    }

    let payload: JwtPayload;

    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const user = await this.databaseService.db.query.users.findFirst({
      where: eq(users.id, payload.sub),
    });

    if (user?.isBanned) {
      throw new UnauthorizedException({
        message: 'User banned by moderation.',
        code: ErrorCode.UserBanned,
      });
    }

    request.user = payload;

    return true;
  }
}
