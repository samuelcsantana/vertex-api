import { Logger } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';

/** Set by the CDN on every request it forwards; proves the request is its. */
export const EDGE_SECRET_HEADER = 'x-edge-secret';

/**
 * CloudFront's own record of who it is answering, as `address:port`. It is a
 * `CloudFront-*` header, which CloudFront generates and overwrites — a viewer
 * that sends its own is ignored — and that is the entire reason it can be
 * believed where `X-Forwarded-For` cannot.
 */
export const VIEWER_ADDRESS_HEADER = 'cloudfront-viewer-address';

export interface TrackableRequest {
  ip: string;
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Decides what a rate limit counts against.
 *
 * The default in @nestjs/throttler is `request.ip`, which with
 * `trustProxy: true` is the **leftmost** entry of `X-Forwarded-For`. Behind a
 * CDN that is a value the caller chooses: CloudFront *appends* the viewer's
 * address to whatever `X-Forwarded-For` arrived rather than replacing it, so
 * a caller who sends `X-Forwarded-For: 1.2.3.4` is counted as 1.2.3.4 — and a
 * caller who sends a different one each time is never counted twice. Every
 * per-IP budget in this app becomes decorative, `/auth/login` and
 * `/auth/otp/request` included, and no amount of sharing the counters between
 * instances helps: they would be sharing a number that means nothing.
 *
 * So the address is read from `CloudFront-Viewer-Address`, which the CDN
 * writes and a viewer cannot forge — but only once the request has proved it
 * came through that CDN. Proof is the same shared secret the edge guard
 * checks, verified again here rather than assumed from guard ordering: a
 * tracker that quietly starts trusting a spoofable header because two
 * providers were reordered is not a failure anyone would notice.
 *
 * With no secret configured there is no CDN in front, `X-Forwarded-For` is
 * exactly as trustworthy as it has always been, and `request.ip` stands.
 */
export function resolveClientTracker(
  request: TrackableRequest,
  secret: string | undefined,
  onViewerAddressMissing?: () => void,
): string {
  if (!secret || !cameThroughEdge(request.headers, secret)) {
    return request.ip;
  }

  const viewerAddress = request.headers[VIEWER_ADDRESS_HEADER];

  if (typeof viewerAddress !== 'string' || viewerAddress.length === 0) {
    // Reachable only through a misconfiguration, and a silent one: the
    // request proved it came from the CDN, so the header should be there.
    // CloudFront's AllViewer origin request policy does *not* forward
    // `CloudFront-*` headers, and the fallback below is the spoofable value
    // this function exists to avoid — hence the noise.
    onViewerAddressMissing?.();
    return request.ip;
  }

  return withoutPort(viewerAddress);
}

/**
 * Builds the tracker @nestjs/throttler calls, owning the one piece of state
 * the decision needs: whether the misconfiguration above has been reported
 * already. Logging it per request would bury the rest of the log under it.
 */
export function createClientTracker(): (req: TrackableRequest) => string {
  const logger = new Logger('ClientTracker');
  let warned = false;

  return (req) =>
    resolveClientTracker(req, process.env.EDGE_SHARED_SECRET, () => {
      if (warned) {
        return;
      }

      warned = true;
      logger.warn(
        `Requests arrive through the CDN but carry no ${VIEWER_ADDRESS_HEADER} header, ` +
          'so rate limits are falling back to X-Forwarded-For, which a caller can set. ' +
          'Forward that header from the distribution (AllViewer does not include CloudFront-* headers).',
      );
    });
}

// `address:port`, and the address may be IPv6 and full of colons — so the
// port is what follows the *last* one.
function withoutPort(viewerAddress: string): string {
  const lastColon = viewerAddress.lastIndexOf(':');

  return lastColon === -1 ? viewerAddress : viewerAddress.slice(0, lastColon);
}

function cameThroughEdge(
  headers: TrackableRequest['headers'],
  secret: string,
): boolean {
  const presented = headers[EDGE_SECRET_HEADER];

  if (typeof presented !== 'string') {
    return false;
  }

  const a = Buffer.from(presented);
  const b = Buffer.from(secret);

  // Length first: timingSafeEqual throws on mismatched buffers instead of
  // returning false.
  return a.length === b.length && timingSafeEqual(a, b);
}
