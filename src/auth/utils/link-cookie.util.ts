import type { FastifyRequest } from 'fastify';

// The signed link_user_id cookie is what turns an OAuth popup round-trip
// into a "link this provider to the logged-in user" flow instead of a
// login (see the /auth/github/link and /auth/google/link routes). Signed
// so a visitor can't forge someone else's user id into their own popup.
export function getVerifiedLinkUserId(req: FastifyRequest): string | null {
  const signedCookie = req.cookies?.link_user_id;

  if (!signedCookie) {
    return null;
  }

  const unsigned = req.unsignCookie(signedCookie);

  return unsigned.valid && unsigned.value ? unsigned.value : null;
}
