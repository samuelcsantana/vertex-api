import { NestFastifyApplication } from '@nestjs/platform-fastify';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';

// The browser sends whichever exact host the visitor is on as the Origin
// header — apex (samuelsantana.dev) and www (www.samuelsantana.dev) are
// different origins even though they're "the same site" to a human, and
// even though vertex-web's own routing/DNS may only ever surface one of
// them. A single-origin CORS allowlist that only matches whichever variant
// FRONTEND_URL happens to be set to silently breaks every browser fetch
// from the other variant (production incident: FRONTEND_URL was the apex
// domain, but the deployed frontend was reachable — and being visited — at
// the www subdomain, so every client-side call to this API was blocked by
// CORS with no server-side error at all). Allow both variants of whatever
// host FRONTEND_URL names, so this can't depend on which one happens to be
// configured.
export function withWwwVariant(url: string): string[] {
  try {
    const parsed = new URL(url);
    const altHostname = parsed.hostname.startsWith('www.')
      ? parsed.hostname.slice(4)
      : `www.${parsed.hostname}`;
    const alt = new URL(url);
    alt.hostname = altHostname;
    return [parsed.origin, alt.origin];
  } catch {
    return [url];
  }
}

/**
 * Everything a running instance of this app needs beyond its Nest modules.
 *
 * It lives here rather than inside bootstrap() because there is now more than
 * one way this app starts: a long-lived server (main.ts) and a Lambda handler
 * (lambda.ts). Both register these plugins imperatively, outside the module
 * system, which means a plugin added to one and forgotten in the other is a
 * difference no type error and no unit test would catch — and the failure
 * would be silent in the worst way. Without @fastify/cookie, `res.setCookie`
 * is undefined and every login stops setting a session; without the CORS
 * call, every browser request from the site is blocked with nothing logged
 * server-side.
 *
 * Swagger is deliberately not here. It is a development surface, and
 * SwaggerModule.createDocument walks the metadata of the entire application,
 * which is work worth doing once at the start of a dev server and worth
 * paying on every cold start of a serverless one.
 */
export async function configureApp(app: NestFastifyApplication): Promise<void> {
  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';

  app.enableCors({
    origin: withWwwVariant(frontendUrl),
    credentials: true,
  });

  const cookieSecret = process.env.COOKIE_SECRET;

  if (!cookieSecret) {
    throw new Error('COOKIE_SECRET environment variable is not defined');
  }

  await app.register(helmet, {
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  });
  await app.register(cookie, { secret: cookieSecret });
}
