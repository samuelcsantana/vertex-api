import { randomBytes } from 'crypto';
import type { FastifyReply } from 'fastify';

// Helmet's default CSP blocks inline scripts; scope a nonce to just this
// response instead of weakening the app-wide script-src policy.
export function sendPopupScript(res: FastifyReply, script: string) {
  const nonce = randomBytes(16).toString('base64');
  res.header(
    'Content-Security-Policy',
    `script-src 'self' 'nonce-${nonce}'; object-src 'none'`,
  );
  res.header('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');

  return res
    .type('text/html')
    .send(`<script nonce="${nonce}">${script}</script>`);
}
