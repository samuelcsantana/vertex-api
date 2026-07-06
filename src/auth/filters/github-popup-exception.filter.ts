import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import {
  GithubAlreadyLinkedException,
  GithubEmailConflictException,
} from '../exceptions/github-link.exceptions';
import { sendPopupScript } from '../utils/popup-response.util';

@Catch(GithubAlreadyLinkedException, GithubEmailConflictException)
export class GithubPopupExceptionFilter implements ExceptionFilter {
  catch(
    exception: GithubAlreadyLinkedException | GithubEmailConflictException,
    host: ArgumentsHost,
  ) {
    const res = host.switchToHttp().getResponse<FastifyReply>();

    res.clearCookie('link_user_id', { path: '/' });

    return sendPopupScript(
      res,
      `alert(${JSON.stringify(exception.message)}); window.close();`,
    );
  }
}
