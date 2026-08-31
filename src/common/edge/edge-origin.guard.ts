import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import type { FastifyRequest } from 'fastify';

/**
 * The header CloudFront is configured to add to every request it forwards to
 * the origin. Fastify lower-cases incoming header names, so this is compared
 * against the already-normalized form.
 */
export const EDGE_SECRET_HEADER = 'x-edge-secret';

export const EDGE_SHARED_SECRET = Symbol('EDGE_SHARED_SECRET');

/**
 * Rejects requests that did not come through the CDN in front of this API.
 *
 * The deployment this is built for puts CloudFront ahead of a Lambda function
 * URL, and that function URL has to be `AuthType: NONE` — the alternative,
 * origin access control, requires the *caller* to put a SHA-256 of the request
 * body in `x-amz-content-sha256`, which a browser doing `fetch` cannot do, so
 * every POST from the site would fail. The cost of that is a function URL
 * anyone can reach directly, going around whatever the distribution enforces.
 *
 * A secret that only CloudFront knows, added as an origin header the viewer
 * never sees, is what closes that. It is not authentication of a user; it is
 * the origin refusing to answer anyone who cannot prove they are the edge —
 * the same shape of trust as `trustProxy`, which believes a forwarded client
 * IP only because a proxy it trusts put it there.
 *
 * Unset, the guard passes everything through, which is what local development,
 * the e2e suite and any deployment without a CDN in front of it need. That
 * default is safe only because it is the *absence* of a fronting CDN that
 * makes direct access legitimate — once the distribution exists, leaving this
 * unset makes it decorative.
 */
@Injectable()
export class EdgeOriginGuard implements CanActivate {
  constructor(private readonly secret: string | undefined) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.secret) {
      return true;
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const presented = request.headers[EDGE_SECRET_HEADER];

    if (typeof presented !== 'string' || !this.matches(presented)) {
      // Deliberately says nothing about what was wrong or what was expected.
      // Whoever reaches this either belongs in front of the CDN or is probing
      // the origin directly; neither needs the detail.
      throw new ForbiddenException('Forbidden');
    }

    return true;
  }

  private matches(presented: string): boolean {
    const a = Buffer.from(presented);
    const b = Buffer.from(this.secret!);

    // timingSafeEqual throws on a length mismatch rather than returning false,
    // so length is checked first. That leaks the secret's length and nothing
    // else, which is not worth defending; the byte-by-byte comparison it
    // guards is the part where a difference would be measurable.
    if (a.length !== b.length) {
      return false;
    }

    return timingSafeEqual(a, b);
  }
}
