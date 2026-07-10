import { ConflictException } from '@nestjs/common';
import { ErrorCode } from '../../common/constants/error-codes';

// Same shape as the GitHub link exceptions: the code doubles as a property
// so OAuthPopupExceptionFilter can put it in the popup redirect URL.
export class GoogleAlreadyLinkedException extends ConflictException {
  readonly code = ErrorCode.GoogleAlreadyLinked;

  constructor() {
    super({
      message: 'This Google account is already linked to another account.',
      code: ErrorCode.GoogleAlreadyLinked,
    });
  }
}
