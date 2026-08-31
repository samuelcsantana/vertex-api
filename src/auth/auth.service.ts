import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { eq, lt } from 'drizzle-orm';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
import { DatabaseService } from '../database/database.service';
import { oauthExchangeCodes, users } from '../database/schema';
import { ErrorCode } from '../common/constants/error-codes';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';

const OAUTH_EXCHANGE_CODE_TTL_MS = 60_000;

// Plain SHA-256, not argon2, and both halves of that matter. The code is 32
// bytes from a CSPRNG, so there is no dictionary for an attacker to grind
// through and nothing for a slow KDF to buy. And argon2 salts every hash by
// design, which would make the stored value impossible to find by equality —
// the lookup below is the whole mechanism.
function hashExchangeCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

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

    return this.generateAccessToken(this.toJwtPayload(user));
  }

  async generateAccessToken(payload: JwtPayload): Promise<string> {
    return this.jwtService.signAsync(payload);
  }

  /**
   * Mints the code the OAuth popup carries back to the frontend.
   *
   * The redirect URL gets this code and never the real access token, so
   * anything that captures the URL — browser history, a Referer header, a
   * proxy's access log — only gets a value that is worthless within a minute
   * and stops working the instant it is spent.
   *
   * Stored in Postgres rather than in a Map in this process. The request that
   * mints a code and the `POST /auth/exchange` that spends it are two separate
   * HTTP calls, so anything running more than one process — a second instance,
   * the overlap of a rolling deploy, a serverless environment — can land them
   * in different memory. The in-memory version was correct only for a
   * single-instance deployment, and its failure mode is the expensive kind:
   * OAuth logins that fail for some visitors some of the time while every
   * local test passes.
   *
   * Takes the user's id, not the token payload it used to freeze. The payload
   * is rebuilt from the row when the code is spent (see below), which is what
   * keeps a role change made during the 60-second window from riding into a
   * token that then lives for seven days. Storing the id also means this table
   * holds no second copy of the user's email and name, and that a deleted user
   * takes any pending codes with them.
   */
  async createOAuthExchangeCode(userId: string): Promise<string> {
    const code = randomBytes(32).toString('hex');

    await this.databaseService.db.insert(oauthExchangeCodes).values({
      codeHash: hashExchangeCode(code),
      userId,
      expiresAt: new Date(Date.now() + OAUTH_EXCHANGE_CODE_TTL_MS),
    });

    // Housekeeping for codes nobody ever came back to spend — an abandoned
    // popup leaves a row that is already inert, since expiry is checked on
    // the way out. It runs after the insert and cannot fail the login: the
    // code the user needs already exists by this point, and letting a
    // cleanup error surface would turn a successful sign-in into a 500.
    try {
      await this.databaseService.db
        .delete(oauthExchangeCodes)
        .where(lt(oauthExchangeCodes.expiresAt, new Date()));
    } catch (error) {
      this.logger.warn(
        `Failed to prune expired OAuth exchange codes: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return code;
  }

  async exchangeOAuthCode(code: string): Promise<string> {
    // Deleted unconditionally, and in the same statement that reads it. A code
    // is single-use whether or not this particular lookup turns out to be
    // valid, and `DELETE ... RETURNING` is what makes two simultaneous
    // exchanges of the same code resolve to exactly one winner — a SELECT
    // followed by a DELETE lets both readers see the row before either
    // removes it.
    const [entry] = await this.databaseService.db
      .delete(oauthExchangeCodes)
      .where(eq(oauthExchangeCodes.codeHash, hashExchangeCode(code)))
      .returning();

    // Expiry is compared here rather than folded into the WHERE clause above,
    // so that presenting an expired code still consumes it. It also keeps the
    // 60-second boundary testable: the tests move Jest's clock, which has no
    // effect on Postgres's now().
    if (!entry || entry.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Invalid or expired exchange code');
    }

    const user = await this.databaseService.db.query.users.findFirst({
      where: eq(users.id, entry.userId),
    });

    // The account can be gone by now — the row's cascade removes pending codes
    // when a user is deleted, but this exchange may already have read one.
    // Same message as an invalid code: which of the two happened is not the
    // caller's business.
    if (!user) {
      throw new UnauthorizedException('Invalid or expired exchange code');
    }

    return this.generateAccessToken(this.toJwtPayload(user));
  }

  /**
   * The claims a token carries, built from a user row.
   *
   * One function rather than an object literal at each call site: a claim
   * added for password login and forgotten for the OAuth exchange would be a
   * token that means different things depending on how the user signed in,
   * and `role` is one of these claims.
   */
  private toJwtPayload(user: typeof users.$inferSelect): JwtPayload {
    return {
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      avatarUrl: user.avatarUrl,
    };
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
