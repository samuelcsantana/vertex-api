// Machine-readable codes attached to user-facing exception response bodies
// so vertex-web can translate the error per-locale (see its
// src/lib/api-error-message.ts) instead of showing this API's English
// message verbatim. The English `message` stays alongside the code as the
// readable default for any other API consumer. Only add a code here when
// the frontend actually presents that failure to an end user — internal/
// generic errors (not-found lookups, token plumbing) stay message-only on
// purpose.
export const ErrorCode = {
  InvalidCredentials: 'INVALID_CREDENTIALS',
  EmailInUse: 'EMAIL_IN_USE',
  UserBanned: 'USER_BANNED',
  AdminOnly: 'ADMIN_ONLY',
  CommentsDisabled: 'COMMENTS_DISABLED',
  CannotBanSelf: 'CANNOT_BAN_SELF',
  SlugInUse: 'SLUG_IN_USE',
  GithubAlreadyLinked: 'GITHUB_ALREADY_LINKED',
  GithubEmailConflict: 'GITHUB_EMAIL_CONFLICT',
  GoogleAlreadyLinked: 'GOOGLE_ALREADY_LINKED',
  OtpInvalid: 'OTP_INVALID',
  OtpExpired: 'OTP_EXPIRED',
  OtpTooManyAttempts: 'OTP_TOO_MANY_ATTEMPTS',
  OtpCooldown: 'OTP_COOLDOWN',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
