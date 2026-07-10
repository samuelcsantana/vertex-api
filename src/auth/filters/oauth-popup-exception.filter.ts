import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import {
  GithubAlreadyLinkedException,
  GithubEmailConflictException,
} from '../exceptions/github-link.exceptions';
import { GoogleAlreadyLinkedException } from '../exceptions/google-link.exceptions';

@Catch(
  GithubAlreadyLinkedException,
  GithubEmailConflictException,
  GoogleAlreadyLinkedException,
)
export class OAuthPopupExceptionFilter implements ExceptionFilter {
  catch(
    exception:
      | GithubAlreadyLinkedException
      | GithubEmailConflictException
      | GoogleAlreadyLinkedException,
    host: ArgumentsHost,
  ) {
    const res = host.switchToHttp().getResponse<FastifyReply>();

    res.clearCookie('link_user_id', { path: '/' });

    // Redirect the popup to the frontend's own callback page with the
    // machine-readable code instead of alert()-ing this API's English
    // message from an API-origin page. The callback page broadcasts the
    // code to its opener over the origin-scoped BroadcastChannel (same
    // mechanism as the success path) and the opener renders the error
    // translated into the visitor's locale — something this popup response
    // can't do itself, since it has no access to the frontend's locale or
    // messages.
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';

    return res.redirect(
      `${frontendUrl}/auth/callback?oauth_error=${encodeURIComponent(exception.code)}`,
      HttpStatus.FOUND,
    );
  }
}
