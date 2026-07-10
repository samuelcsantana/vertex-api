import type { OtpEmailLocale } from './otp-email-template';

// DIP seam with a real variation axis, same reasoning as ObjectStorage
// (src/uploads/storage/object-storage.ts): the sender is Resend in
// production, a console logger in local dev without credentials, and a
// fake in unit tests. Abstract class on purpose — Nest uses it directly
// as the DI token (see AuthModule's provider binding), so consumers
// never name a concrete implementation.
export abstract class EmailSender {
  abstract sendOtpEmail(
    to: string,
    code: string,
    locale: OtpEmailLocale,
  ): Promise<void>;
}
