import { ConflictException } from '@nestjs/common';
import { ErrorCode } from '../../common/constants/error-codes';

// Both exceptions expose their code as a property (not just inside the
// response body) so OAuthPopupExceptionFilter can put it in the redirect
// URL it sends the OAuth popup to — see that filter for how the code
// reaches the frontend, which translates it per-locale.
export class GithubAlreadyLinkedException extends ConflictException {
  readonly code = ErrorCode.GithubAlreadyLinked;

  constructor() {
    super({
      message: 'This GitHub profile is already linked to another account.',
      code: ErrorCode.GithubAlreadyLinked,
    });
  }
}

export class GithubEmailConflictException extends ConflictException {
  readonly code = ErrorCode.GithubEmailConflict;

  constructor() {
    super({
      message:
        'This email is already associated with a Google account. Sign in with Google and connect GitHub from your profile settings.',
      code: ErrorCode.GithubEmailConflict,
    });
  }
}
