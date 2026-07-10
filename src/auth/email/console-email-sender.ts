import { Injectable, Logger } from '@nestjs/common';
import { EmailSender } from './email-sender';

// Local-dev fallback when RESEND_API_KEY isn't set: prints the code to the
// server console instead of sending anything. AuthModule refuses to bind
// this in production (see its EmailSender factory).
@Injectable()
export class ConsoleEmailSender extends EmailSender {
  private readonly logger = new Logger(ConsoleEmailSender.name);

  sendOtpEmail(to: string, code: string): Promise<void> {
    this.logger.log(`OTP code for ${to}: ${code}`);
    return Promise.resolve();
  }
}
