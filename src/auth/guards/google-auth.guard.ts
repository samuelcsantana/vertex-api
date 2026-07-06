import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { FastifyReply } from 'fastify';

type PatchedFastifyReply = FastifyReply & {
  setHeader?: FastifyReply['raw']['setHeader'];
  end?: FastifyReply['raw']['end'];
};

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  getResponse(context: ExecutionContext): FastifyReply {
    const response =
      context.switchToHttp().getResponse<PatchedFastifyReply>();

    if (typeof response.setHeader !== 'function') {
      response.setHeader = response.raw.setHeader.bind(response.raw);
      response.end = response.raw.end.bind(response.raw);
    }

    return response;
  }
}
