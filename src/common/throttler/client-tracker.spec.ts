import {
  EDGE_SECRET_HEADER,
  resolveClientTracker,
  TrackableRequest,
  VIEWER_ADDRESS_HEADER,
} from './client-tracker';

const SECRET = 'a-long-enough-shared-secret';
const FASTIFY_IP = '1.2.3.4';

function request(
  headers: TrackableRequest['headers'] = {},
  ip = FASTIFY_IP,
): TrackableRequest {
  return { ip, headers };
}

describe('resolveClientTracker', () => {
  describe('with no CDN in front', () => {
    it('falls back to the address Fastify resolved', () => {
      // Nothing is proxying, so X-Forwarded-For is as trustworthy here as it
      // has ever been — which is to say, this changes nothing for the current
      // deployment.
      expect(resolveClientTracker(request(), undefined)).toBe(FASTIFY_IP);
    });
  });

  describe('behind the CDN', () => {
    it('counts against the address CloudFront recorded, not the forwarded one', () => {
      // The whole point. request.ip here is the leftmost X-Forwarded-For
      // entry, which the caller supplied; the viewer address is CloudFront's.
      const tracker = resolveClientTracker(
        request({
          [EDGE_SECRET_HEADER]: SECRET,
          [VIEWER_ADDRESS_HEADER]: '198.51.100.9:53124',
        }),
        SECRET,
      );

      expect(tracker).toBe('198.51.100.9');
    });

    it('strips the port from an IPv6 viewer address', () => {
      // The address is itself full of colons, so the port is what follows the
      // last one — not the first.
      const tracker = resolveClientTracker(
        request({
          [EDGE_SECRET_HEADER]: SECRET,
          [VIEWER_ADDRESS_HEADER]: '2001:db8:85a3::8a2e:370:7334:53124',
        }),
        SECRET,
      );

      expect(tracker).toBe('2001:db8:85a3::8a2e:370:7334');
    });

    it('gives two viewers behind one forged X-Forwarded-For separate budgets', () => {
      // Restating the attack as an assertion: identical spoofed request.ip,
      // different real viewers, and the limits must not be shared.
      const forged = request(
        {
          [EDGE_SECRET_HEADER]: SECRET,
          [VIEWER_ADDRESS_HEADER]: '198.51.100.9:1111',
        },
        '9.9.9.9',
      );
      const alsoForged = request(
        {
          [EDGE_SECRET_HEADER]: SECRET,
          [VIEWER_ADDRESS_HEADER]: '203.0.113.7:2222',
        },
        '9.9.9.9',
      );

      expect(resolveClientTracker(forged, SECRET)).not.toBe(
        resolveClientTracker(alsoForged, SECRET),
      );
    });
  });

  describe('when the viewer address cannot be trusted', () => {
    it('ignores a viewer address on a request that did not come through the CDN', () => {
      // Otherwise the header the fix relies on would itself be the bypass:
      // anyone hitting the publicly resolvable origin could name their own
      // viewer address.
      const tracker = resolveClientTracker(
        request({ [VIEWER_ADDRESS_HEADER]: '198.51.100.9:53124' }),
        SECRET,
      );

      expect(tracker).toBe(FASTIFY_IP);
    });

    it('ignores a viewer address presented with the wrong secret', () => {
      const tracker = resolveClientTracker(
        request({
          [EDGE_SECRET_HEADER]: 'b'.repeat(SECRET.length),
          [VIEWER_ADDRESS_HEADER]: '198.51.100.9:53124',
        }),
        SECRET,
      );

      expect(tracker).toBe(FASTIFY_IP);
    });

    it('ignores a repeated secret header, which arrives as an array', () => {
      const tracker = resolveClientTracker(
        request({
          [EDGE_SECRET_HEADER]: [SECRET, SECRET],
          [VIEWER_ADDRESS_HEADER]: '198.51.100.9:53124',
        }),
        SECRET,
      );

      expect(tracker).toBe(FASTIFY_IP);
    });
  });

  describe('when the CDN forwards no viewer address', () => {
    it('falls back, and says so exactly once per process', () => {
      // The distribution is misconfigured — AllViewer does not forward
      // CloudFront-* headers — and the fallback is the spoofable value this
      // function exists to avoid. Silence here would hide a live hole.
      const onMissing = jest.fn();

      const tracker = resolveClientTracker(
        request({ [EDGE_SECRET_HEADER]: SECRET }),
        SECRET,
        onMissing,
      );

      expect(tracker).toBe(FASTIFY_IP);
      expect(onMissing).toHaveBeenCalledTimes(1);
    });

    it('treats an empty viewer address the same as a missing one', () => {
      const onMissing = jest.fn();

      const tracker = resolveClientTracker(
        request({
          [EDGE_SECRET_HEADER]: SECRET,
          [VIEWER_ADDRESS_HEADER]: '',
        }),
        SECRET,
        onMissing,
      );

      expect(tracker).toBe(FASTIFY_IP);
      expect(onMissing).toHaveBeenCalledTimes(1);
    });
  });
});
