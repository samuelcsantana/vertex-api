import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ErrorCode } from '../../common/constants/error-codes';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const user = request.user;

    if (!user || user.role !== 'admin') {
      throw new ForbiddenException({
        message: 'Access restricted to administrators',
        code: ErrorCode.AdminOnly,
      });
    }

    return true;
  }
}
