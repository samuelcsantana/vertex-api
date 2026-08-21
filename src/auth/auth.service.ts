import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { DatabaseService } from '../database/database.service';
import { users } from '../database/schema';
import { ErrorCode } from '../common/constants/error-codes';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';

interface OAuthExchangeEntry {
  payload: JwtPayload;
  expiresAt: number;
}

const OAUTH_EXCHANGE_CODE_TTL_MS = 60_000;

@Injectable()
export class AuthService {
  // In-memory is fine for this app's single-instance deployment; a code is
  // only ever meant to survive one redirect hop (~seconds), not worth a
  // Redis/DB-backed store. Won't survive a process restart mid-flow, which
  // just means that one login attempt fails and the user retries.
  private readonly oauthExchangeCodes = new Map<string, OAuthExchangeEntry>();

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly jwtService: JwtService,
  ) {}

  async register(registerDto: RegisterDto) {
    const existingUser = await this.databaseService.db.query.users.findFirst({
      where: eq(users.email, registerDto.email),
    });

    if (existingUser) {
      throw new ConflictException({
        message: 'Email is already in use',
        code: ErrorCode.EmailInUse,
      });
    }

    const passwordHash = await argon2.hash(registerDto.password);

    const [createdUser] = await this.databaseService.db
      .insert(users)
      .values({
        email: registerDto.email,
        passwordHash,
        // Same public-identity default as OTP signups (see OtpService).
        displayName: registerDto.email.split('@')[0],
      })
      .returning({ id: users.id, email: users.email });

    return createdUser;
  }

  async login(loginDto: LoginDto): Promise<string> {
    const user = await this.databaseService.db.query.users.findFirst({
      where: eq(users.email, loginDto.email),
    });

    if (!user) {
      throw new UnauthorizedException({
        message: 'Invalid credentials',
        code: ErrorCode.InvalidCredentials,
      });
    }

    const isPasswordValid = await argon2.verify(
      user.passwordHash,
      loginDto.password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException({
        message: 'Invalid credentials',
        code: ErrorCode.InvalidCredentials,
      });
    }

    return this.generateAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      avatarUrl: user.avatarUrl,
    });
  }

  async generateAccessToken(payload: JwtPayload): Promise<string> {
    return this.jwtService.signAsync(payload);
  }

  // The OAuth popup redirects to the frontend with this code in the URL —
  // never the real access token — so anything that captures the URL
  // (browser history, referrer leaks, a proxy's access log) only gets a
  // value that's worthless within a minute and can't be replayed even
  // sooner than that, since exchanging it deletes it immediately.
  createOAuthExchangeCode(payload: JwtPayload): string {
    this.pruneExpiredExchangeCodes();

    const code = randomBytes(32).toString('hex');

    this.oauthExchangeCodes.set(code, {
      payload,
      expiresAt: Date.now() + OAUTH_EXCHANGE_CODE_TTL_MS,
    });

    return code;
  }

  async exchangeOAuthCode(code: string): Promise<string> {
    const entry = this.oauthExchangeCodes.get(code);

    // Deleted unconditionally, before checking validity: a code is single-use
    // regardless of whether this particular lookup succeeds.
    this.oauthExchangeCodes.delete(code);

    if (!entry || entry.expiresAt < Date.now()) {
      throw new UnauthorizedException('Invalid or expired exchange code');
    }

    return this.generateAccessToken(entry.payload);
  }

  private pruneExpiredExchangeCodes(): void {
    const now = Date.now();

    for (const [code, entry] of this.oauthExchangeCodes) {
      if (entry.expiresAt < now) {
        this.oauthExchangeCodes.delete(code);
      }
    }
  }

  /**
   * The public shape of a user, built from a row the caller already has.
   *
   * Takes the row rather than an id on purpose. It used to take an id and do
   * its own findFirst, which meant every call ran a second query on a primary
   * key JwtAuthGuard had just looked up to check isBanned — measured at ~240ms
   * of the ~740ms a signed-in GET /auth/profile took.
   *
   * Still DB data rather than JWT claims, and that part has not changed: the
   * payload is frozen at issue time, so githubId would report stale
   * linked-account state until the user's next login. The row is current; it
   * simply does not need to be fetched twice.
   */
  toProfile(user: typeof users.$inferSelect | undefined) {
    // A token can outlive the account it names — deleting your own account
    // does not invalidate the cookie already in your browser.
    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      githubId: user.githubId,
      googleId: user.googleId,
    };
  }
}
