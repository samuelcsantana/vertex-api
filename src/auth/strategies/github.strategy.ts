import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile } from 'passport-github2';
import type { VerifyCallback } from 'passport-oauth2';
import type { FastifyRequest } from 'fastify';
import { eq, or } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import * as argon2 from 'argon2';
import { DatabaseService } from '../../database/database.service';
import { users } from '../../database/schema';
import { JwtPayload, UserRole } from '../interfaces/jwt-payload.interface';
import {
  GithubAlreadyLinkedException,
  GithubEmailConflictException,
} from '../exceptions/github-link.exceptions';

// passport-github2's typings omit `primary`/`verified`, which GitHub does
// include on each entry in the `user:email` scope response.
interface GithubEmail {
  value: string;
  primary?: boolean;
  verified?: boolean;
}

const POSTGRES_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === POSTGRES_UNIQUE_VIOLATION
  );
}

@Injectable()
export class GithubStrategy extends PassportStrategy(Strategy, 'github') {
  private readonly isConfigured: boolean;

  constructor(private readonly databaseService: DatabaseService) {
    const clientID = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;
    const callbackURL =
      process.env.GITHUB_CALLBACK_URL ??
      'http://localhost:3333/auth/github/callback';

    // Same rationale as GoogleStrategy: constructing with placeholders and
    // failing per-request in authenticate() keeps a missing GITHUB_* env
    // from crashing the whole app at boot — only the /auth/github routes
    // 503 when unconfigured.
    super({
      clientID: clientID ?? 'github-oauth-not-configured',
      clientSecret: clientSecret ?? 'github-oauth-not-configured',
      callbackURL,
      scope: ['user:email'],
      passReqToCallback: true,
    });

    this.isConfigured = Boolean(clientID && clientSecret);
  }

  authenticate(...args: Parameters<Strategy['authenticate']>): void {
    if (!this.isConfigured) {
      throw new ServiceUnavailableException(
        'GitHub OAuth is not configured on this server (GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET).',
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
    const githubId = profile.id;

    if (!githubId) {
      throw new BadRequestException(
        'Could not retrieve the GitHub account identifier.',
      );
    }

    const emails: GithubEmail[] | undefined = profile.emails;
    const realEmail =
      emails && emails.length > 0
        ? (emails.find((e) => e.primary)?.value ?? emails[0].value)
        : null;
    const name = profile.displayName || profile.username || 'GitHub User';
    const avatarUrl =
      profile.photos && profile.photos.length > 0
        ? profile.photos[0].value
        : null;

    const linkUserId = this.getVerifiedLinkUserId(req);

    if (linkUserId) {
      const payload = await this.linkToExistingUser(
        linkUserId,
        githubId,
        avatarUrl,
      );
      done(null, payload);
      return;
    }

    const email = realEmail ?? `github-${githubId}@guest.local`;
    const payload = await this.loginOrRegister(
      githubId,
      email,
      name,
      avatarUrl,
    );

    done(null, payload);
  }

  private getVerifiedLinkUserId(req: FastifyRequest): string | null {
    const signedCookie = req.cookies?.link_user_id;

    if (!signedCookie) {
      return null;
    }

    const unsigned = req.unsignCookie(signedCookie);

    return unsigned.valid && unsigned.value ? unsigned.value : null;
  }

  private async linkToExistingUser(
    linkUserId: string,
    githubId: string,
    avatarUrl: string | null,
  ): Promise<JwtPayload> {
    try {
      const conflictingUser =
        await this.databaseService.db.query.users.findFirst({
          where: eq(users.githubId, githubId),
        });

      if (conflictingUser && conflictingUser.id !== linkUserId) {
        throw new GithubAlreadyLinkedException();
      }

      const currentUser = await this.databaseService.db.query.users.findFirst({
        where: eq(users.id, linkUserId),
      });

      if (!currentUser) {
        throw new UnauthorizedException(
          'User to link the GitHub account to was not found.',
        );
      }

      const [updatedUser] = await this.databaseService.db
        .update(users)
        .set({
          githubId,
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
        error instanceof GithubAlreadyLinkedException ||
        error instanceof UnauthorizedException
      ) {
        throw error;
      }

      console.error('Failed to link GitHub account:', error);
      throw new InternalServerErrorException('Failed to link GitHub account');
    }
  }

  private async loginOrRegister(
    githubId: string,
    email: string,
    name: string,
    avatarUrl: string | null,
  ): Promise<JwtPayload> {
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

        try {
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
        } catch (insertError) {
          if (isUniqueViolation(insertError)) {
            throw new GithubEmailConflictException();
          }
          throw insertError;
        }
      }
    } catch (error) {
      if (error instanceof GithubEmailConflictException) {
        throw error;
      }

      console.error('GitHub strategy error:', error);
      throw new InternalServerErrorException(
        'Failed to authenticate with GitHub',
      );
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
