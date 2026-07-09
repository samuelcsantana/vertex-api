import { ConflictException } from '@nestjs/common';

export class GithubAlreadyLinkedException extends ConflictException {
  constructor() {
    super('This GitHub profile is already linked to another account.');
  }
}

export class GithubEmailConflictException extends ConflictException {
  constructor() {
    super(
      'This email is already associated with a Google account. Sign in with Google and connect GitHub from your profile settings.',
    );
  }
}
