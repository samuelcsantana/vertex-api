import { ForbiddenException } from '@nestjs/common';
import { ErrorCode } from '../../common/constants/error-codes';

// The provider's redirect back did not carry the `state` this browser was
// handed when it left, or this browser holds no attempt to compare it with
// (cookie expired or blocked, a second login started in parallel, or a
// callback URL that was replayed or planted). The login is refused before the
// authorization code is ever exchanged.
//
// 403 because that is how passport-oauth2 answers its own state failures; the
// status never reaches the visitor, since OAuthPopupExceptionFilter turns this
// into a redirect carrying the code — same shape as the link exceptions.
export class OAuthStateMismatchException extends ForbiddenException {
  readonly code = ErrorCode.OAuthStateMismatch;

  constructor() {
    super({
      message: 'The sign-in attempt could not be verified. Please try again.',
      code: ErrorCode.OAuthStateMismatch,
    });
  }
}
