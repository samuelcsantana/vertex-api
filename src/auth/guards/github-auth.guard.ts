import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  OAuthAuthenticateOptions,
  oauthAuthenticateOptions,
} from '../utils/oauth-state.util';

type PatchedFastifyReply = FastifyReply & {
  setHeader?: FastifyReply['raw']['setHeader'];
  end?: FastifyReply['raw']['end'];
};

@Injectable()
export class GithubAuthGuard extends AuthGuard('github') {
  getResponse(context: ExecutionContext): FastifyReply {
    const response = context.switchToHttp().getResponse<PatchedFastifyReply>();

    if (typeof response.setHeader !== 'function') {
      response.setHeader = response.raw.setHeader.bind(response.raw);
      response.end = response.raw.end.bind(response.raw);
    }

    return response;
  }

  // Issues the state + PKCE verifier on the way out to the provider and
  // checks them on the way back. Nest awaits this before it calls passport.
  getAuthenticateOptions(context: ExecutionContext): OAuthAuthenticateOptions {
    const http = context.switchToHttp();

    return oauthAuthenticateOptions(
      'github',
      http.getRequest<FastifyRequest>(),
      http.getResponse<FastifyReply>(),
    );
  }
}
