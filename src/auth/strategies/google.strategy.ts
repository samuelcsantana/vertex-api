import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile, VerifyCallback } from 'passport-google-oauth20';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import { users } from '../../database/schema';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(private readonly databaseService: DatabaseService) {
    const clientID = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const callbackURL =
      process.env.GOOGLE_CALLBACK_URL ??
      'http://localhost:3333/auth/google/callback';

    if (!clientID || !clientSecret) {
      throw new Error(
        'Missing required Google OAuth environment variables: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET',
      );
    }

    super({
      clientID,
      clientSecret,
      callbackURL,
      scope: ['email', 'profile'],
    });
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

    const user = await this.databaseService.db.query.users.findFirst({
      where: eq(users.email, email),
    });

    if (!user) {
      done(new UnauthorizedException('User is not registered'), false);
      return;
    }

    const payload: JwtPayload = { sub: user.id, email: user.email };

    done(null, payload);
  }
}
