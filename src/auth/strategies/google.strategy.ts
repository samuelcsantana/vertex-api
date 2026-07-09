import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile, VerifyCallback } from 'passport-google-oauth20';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import * as argon2 from 'argon2';
import { DatabaseService } from '../../database/database.service';
import { users } from '../../database/schema';
import { JwtPayload, UserRole } from '../interfaces/jwt-payload.interface';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  private readonly isConfigured: boolean;

  constructor(private readonly databaseService: DatabaseService) {
    const clientID = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const callbackURL =
      process.env.GOOGLE_CALLBACK_URL ??
      'http://localhost:3333/auth/google/callback';

    // Passport demands credential-shaped options at super() time, but
    // throwing here used to take the entire app down whenever the Google
    // env vars were absent — which forced OAuth-less local dev and every
    // e2e run to supply real-looking credentials just to boot. Construct
    // with placeholders instead and fail per-request in authenticate()
    // below: only the /auth/google routes become unavailable when
    // unconfigured, not the application.
    super({
      clientID: clientID ?? 'google-oauth-not-configured',
      clientSecret: clientSecret ?? 'google-oauth-not-configured',
      callbackURL,
      scope: ['email', 'profile'],
    });

    this.isConfigured = Boolean(clientID && clientSecret);
  }

  authenticate(...args: Parameters<Strategy['authenticate']>): void {
    if (!this.isConfigured) {
      throw new ServiceUnavailableException(
        'Google OAuth is not configured on this server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).',
      );
    }

    super.authenticate(...args);
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): Promise<void> {
    const email = profile.emails?.[0]?.value;

    if (!email) {
      done(new UnauthorizedException('Google account has no email'), false);
      return;
    }

    const name =
      profile.displayName || profile.name?.givenName || 'Google User';
    const avatarUrl =
      profile.photos && profile.photos.length > 0
        ? profile.photos[0].value
        : null;

    const existingUser = await this.databaseService.db.query.users.findFirst({
      where: eq(users.email, email),
    });

    let user: typeof users.$inferSelect;

    if (existingUser) {
      [user] = await this.databaseService.db
        .update(users)
        .set({ name, avatarUrl })
        .where(eq(users.id, existingUser.id))
        .returning();
    } else {
      const role: UserRole =
        email === process.env.ADMIN_EMAIL ? 'admin' : 'user';
      const randomPassword = randomBytes(32).toString('hex');
      const passwordHash = await argon2.hash(randomPassword);

      [user] = await this.databaseService.db
        .insert(users)
        .values({
          email,
          name,
          avatarUrl,
          passwordHash,
          role,
        })
        .returning();
    }

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      avatarUrl: user.avatarUrl,
    };

    done(null, payload);
  }
}
