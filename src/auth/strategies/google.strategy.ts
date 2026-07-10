import {
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile, VerifyCallback } from 'passport-google-oauth20';
import type { FastifyRequest } from 'fastify';
import { eq, or } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import * as argon2 from 'argon2';
import { DatabaseService } from '../../database/database.service';
import { users } from '../../database/schema';
import { JwtPayload, UserRole } from '../interfaces/jwt-payload.interface';
import { GoogleAlreadyLinkedException } from '../exceptions/google-link.exceptions';
import { getVerifiedLinkUserId } from '../utils/link-cookie.util';

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
      // Needed to read the signed link_user_id cookie that distinguishes
      // an account-linking popup from a plain login (see /auth/google/link).
      passReqToCallback: true,
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
    req: FastifyRequest,
    accessToken: string,
    refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): Promise<void> {
    const googleId = profile.id;
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

    const linkUserId = getVerifiedLinkUserId(req);

    if (linkUserId) {
      const payload = await this.linkToExistingUser(
        linkUserId,
        googleId,
        avatarUrl,
      );
      done(null, payload);
      return;
    }

    const payload = await this.loginOrRegister(
      googleId,
      email,
      name,
      avatarUrl,
    );

    done(null, payload);
  }

  private async linkToExistingUser(
    linkUserId: string,
    googleId: string,
    avatarUrl: string | null,
  ): Promise<JwtPayload> {
    try {
      const conflictingUser =
        await this.databaseService.db.query.users.findFirst({
          where: eq(users.googleId, googleId),
        });

      if (conflictingUser && conflictingUser.id !== linkUserId) {
        throw new GoogleAlreadyLinkedException();
      }

      const currentUser = await this.databaseService.db.query.users.findFirst({
        where: eq(users.id, linkUserId),
      });

      if (!currentUser) {
        throw new UnauthorizedException(
          'User to link the Google account to was not found.',
        );
      }

      const [updatedUser] = await this.databaseService.db
        .update(users)
        .set({
          googleId,
          avatarUrl: currentUser.avatarUrl ?? avatarUrl,
        })
        .where(eq(users.id, linkUserId))
        .returning();

      return {
        sub: updatedUser.id,
        email: updatedUser.email,
        role: updatedUser.role,
        name: updatedUser.name,
        avatarUrl: updatedUser.avatarUrl,
      };
    } catch (error) {
      if (
        error instanceof GoogleAlreadyLinkedException ||
        error instanceof UnauthorizedException
      ) {
        throw error;
      }

      console.error('Failed to link Google account:', error);
      throw new InternalServerErrorException('Failed to link Google account');
    }
  }

  private async loginOrRegister(
    googleId: string,
    email: string,
    name: string,
    avatarUrl: string | null,
  ): Promise<JwtPayload> {
    // googleId match first (survives a Google-account email change), then
    // email (merges with accounts created via OTP/password/GitHub under
    // the same address).
    const existingUser = await this.databaseService.db.query.users.findFirst({
      where: or(eq(users.googleId, googleId), eq(users.email, email)),
    });

    let user: typeof users.$inferSelect;

    if (existingUser) {
      // Fill-if-missing, never overwrite: a returning user may have edited
      // their name/avatar on /profile, and a login must not clobber that.
      [user] = await this.databaseService.db
        .update(users)
        .set({
          googleId,
          name: existingUser.name ?? name,
          avatarUrl: existingUser.avatarUrl ?? avatarUrl,
        })
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
          googleId,
          email,
          name,
          avatarUrl,
          passwordHash,
          role,
        })
        .returning();
    }

    return {
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      avatarUrl: user.avatarUrl,
    };
  }
}
