import { Injectable } from '@nestjs/common';
import { EmailSender } from './email-sender';
import { buildOtpEmail, type OtpEmailLocale } from './otp-email-template';

const RESEND_API_URL = 'https://api.resend.com/emails';

@Injectable()
export class ResendEmailSender extends EmailSender {
  private readonly apiKey: string;
  private readonly from: string;

  constructor() {
    super();

    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.OTP_EMAIL_FROM;

    if (!apiKey || !from) {
      const missing = [
        !apiKey && 'RESEND_API_KEY',
        !from && 'OTP_EMAIL_FROM',
      ].filter(Boolean);
      throw new Error(
        `Missing required Resend environment variables: ${missing.join(', ')}`,
      );
    }

    this.apiKey = apiKey;
    this.from = from;
  }

  async sendOtpEmail(
    to: string,
    code: string,
    locale: OtpEmailLocale,
  ): Promise<void> {
    const { subject, text, html } = buildOtpEmail(code, locale);

    const response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: this.from, to: [to], subject, text, html }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Resend rejected the OTP email (${response.status}): ${body}`,
      );
    }
  }
}
