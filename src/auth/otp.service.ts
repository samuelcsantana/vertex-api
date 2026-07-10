import {
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes, randomInt } from 'crypto';
import { eq } from 'drizzle-orm';
import * as argon2 from 'argon2';
import { DatabaseService } from '../database/database.service';
import { emailOtps, users } from '../database/schema';
import { ErrorCode } from '../common/constants/error-codes';
import { AuthService } from './auth.service';
import { EmailSender } from './email/email-sender';
import type { OtpEmailLocale } from './email/otp-email-template';

const OTP_TTL_MS = 10 * 60_000;
const OTP_RESEND_COOLDOWN_MS = 60_000;
const OTP_MAX_ATTEMPTS = 5;

// sha256 rather than argon2 on purpose: a 6-digit space (10^6) is
// offline-brute-forceable under any hash if the table leaks, so a slow
// hash buys nothing here. The real defenses are the 10-minute TTL, the
// 5-attempt cap below, and the route throttle on both endpoints.
function hashOtpCode(email: string, code: string): string {
  return createHash('sha256').update(`${email}:${code}`).digest('hex');
}

@Injectable()
export class OtpService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly authService: AuthService,
    private readonly emailSender: EmailSender,
  ) {}

  async requestCode(email: string, locale: OtpEmailLocale) {
    const existing = await this.databaseService.db.query.emailOtps.findFirst({
      where: eq(emailOtps.email, email),
    });

    if (
      existing &&
      existing.createdAt.getTime() + OTP_RESEND_COOLDOWN_MS > Date.now() &&
      existing.expiresAt.getTime() > Date.now()
    ) {
      throw new HttpException(
        {
          message: 'Wait before requesting another code',
          code: ErrorCode.OtpCooldown,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Full 000000–999999 space, crypto-grade randomness.
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');

    // Replace-don't-stack: one active code per email, so a resend
    // invalidates the previous code instead of widening the guess space.
    await this.databaseService.db
      .delete(emailOtps)
      .where(eq(emailOtps.email, email));
    await this.databaseService.db.insert(emailOtps).values({
      email,
      codeHash: hashOtpCode(email, code),
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    });

    try {
      await this.emailSender.sendOtpEmail(email, code, locale);
    } catch (error) {
      // A stored code the visitor never received would only block their
      // retry behind the cooldown — remove it before surfacing the failure.
      await this.databaseService.db
        .delete(emailOtps)
        .where(eq(emailOtps.email, email));
      throw error;
    }

    return { message: 'Code sent' };
  }

  async verifyCode(email: string, code: string) {
    const entry = await this.databaseService.db.query.emailOtps.findFirst({
      where: eq(emailOtps.email, email),
    });

    if (!entry) {
      throw new UnauthorizedException({
        message: 'Invalid code',
        code: ErrorCode.OtpInvalid,
      });
    }

    if (entry.expiresAt.getTime() < Date.now()) {
      await this.deleteEntry(entry.id);
      throw new UnauthorizedException({
        message: 'Code expired',
        code: ErrorCode.OtpExpired,
      });
    }

    if (entry.attempts >= OTP_MAX_ATTEMPTS) {
      await this.deleteEntry(entry.id);
      throw new UnauthorizedException({
        message: 'Too many attempts — request a new code',
        code: ErrorCode.OtpTooManyAttempts,
      });
    }

    if (entry.codeHash !== hashOtpCode(email, code)) {
      await this.databaseService.db
        .update(emailOtps)
        .set({ attempts: entry.attempts + 1 })
        .where(eq(emailOtps.id, entry.id));
      throw new UnauthorizedException({
        message: 'Invalid code',
        code: ErrorCode.OtpInvalid,
      });
    }

    await this.deleteEntry(entry.id);

    // Find-or-create mirrors the Google strategy's first-login branch:
    // passwordHash is NOT NULL, so passwordless users get a random
    // argon2-hashed throwaway; ADMIN_EMAIL bootstraps the admin role.
    let user = await this.databaseService.db.query.users.findFirst({
      where: eq(users.email, email),
    });

    if (!user) {
      const role = email === process.env.ADMIN_EMAIL ? 'admin' : 'user';
      const passwordHash = await argon2.hash(randomBytes(32).toString('hex'));

      [user] = await this.databaseService.db
        .insert(users)
        .values({ email, passwordHash, role })
        .returning();
    }

    if (user.isBanned) {
      throw new UnauthorizedException({
        message: 'User is banned',
        code: ErrorCode.UserBanned,
      });
    }

    const accessToken = await this.authService.generateAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      avatarUrl: user.avatarUrl,
    });

    return { access_token: accessToken };
  }

  private async deleteEntry(id: string): Promise<void> {
    await this.databaseService.db.delete(emailOtps).where(eq(emailOtps.id, id));
  }
}
