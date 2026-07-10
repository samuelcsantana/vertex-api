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

  async getProfile(userId: string) {
    // Re-fetched from the DB on every call rather than read off the JWT
    // payload: githubId can change mid-session (account linking doesn't
    // reissue the token), so the payload would otherwise report stale
    // linked-account state until the user's next login.
    const user = await this.databaseService.db.query.users.findFirst({
      where: eq(users.id, userId),
    });

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
    };
  }
}
