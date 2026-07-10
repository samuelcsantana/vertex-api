import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { DatabaseModule } from '../database/database.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { EmailSender } from './email/email-sender';
import { ResendEmailSender } from './email/resend-email-sender';
import { ConsoleEmailSender } from './email/console-email-sender';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AdminGuard } from './guards/admin.guard';
import { GoogleStrategy } from './strategies/google.strategy';
import { GithubStrategy } from './strategies/github.strategy';

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is not defined');
}

@Module({
  imports: [
    DatabaseModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    OtpService,
    {
      provide: EmailSender,
      // Resend when configured; the console fallback keeps local dev
      // working without credentials but must never reach production —
      // it would silently swallow every visitor's login code.
      useFactory: (): EmailSender => {
        if (process.env.RESEND_API_KEY) {
          return new ResendEmailSender();
        }

        if (process.env.NODE_ENV === 'production') {
          throw new Error(
            'RESEND_API_KEY is required in production (email OTP login)',
          );
        }

        return new ConsoleEmailSender();
      },
    },
    JwtAuthGuard,
    AdminGuard,
    GoogleStrategy,
    GithubStrategy,
  ],
  exports: [JwtAuthGuard, AdminGuard, JwtModule],
})
export class AuthModule {}
