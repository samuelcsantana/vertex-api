import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile } from 'passport-github2';
import type { VerifyCallback } from 'passport-oauth2';
import { eq, or } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import * as argon2 from 'argon2';
import { DatabaseService } from '../../database/database.service';
import { users } from '../../database/schema';
import { JwtPayload, UserRole } from '../interfaces/jwt-payload.interface';

// passport-github2's typings omit `primary`/`verified`, which GitHub does
// include on each entry in the `user:email` scope response.
interface GithubEmail {
  value: string;
  primary?: boolean;
  verified?: boolean;
}

@Injectable()
export class GithubStrategy extends PassportStrategy(Strategy, 'github') {
  constructor(private readonly databaseService: DatabaseService) {
    const clientID = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;
    const callbackURL =
      process.env.GITHUB_CALLBACK_URL ??
      'http://localhost:3333/auth/github/callback';

    if (!clientID || !clientSecret) {
      throw new Error(
        'Missing required GitHub OAuth environment variables: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET',
      );
    }

    super({
      clientID,
      clientSecret,
      callbackURL,
      scope: ['user:email'],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): Promise<void> {
    const githubId = profile.id;
    const emails: GithubEmail[] | undefined = profile.emails;
    const realEmail =
      emails && emails.length > 0
        ? (emails.find((e) => e.primary)?.value ?? emails[0].value)
        : null;

    if (!githubId) {
      throw new BadRequestException(
        'Não foi possível obter o identificador da conta do GitHub.',
      );
    }

    const email = realEmail ?? `github-${githubId}@guest.local`;
    const name = profile.displayName || profile.username || 'GitHub User';
    const avatarUrl =
      profile.photos && profile.photos.length > 0
        ? profile.photos[0].value
        : null;

    let user: typeof users.$inferSelect;

    try {
      const existingUser = await this.databaseService.db.query.users.findFirst({
        where: or(eq(users.githubId, githubId), eq(users.email, email)),
      });

      if (existingUser) {
        [user] = await this.databaseService.db
          .update(users)
          .set({ githubId, name, avatarUrl })
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
            githubId,
            email,
            name,
            avatarUrl,
            passwordHash,
            role,
          })
          .returning();
      }
    } catch (error) {
      console.error('Erro na estratégia do GitHub:', error);
      throw new InternalServerErrorException(
        'Failed to authenticate with GitHub',
      );
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
