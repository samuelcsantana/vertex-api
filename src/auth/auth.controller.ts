import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiCookieAuth, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { GithubAuthGuard } from './guards/github-auth.guard';
import { GithubPopupExceptionFilter } from './filters/github-popup-exception.filter';
import { sendPopupScript } from './utils/popup-response.util';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { loginSchema } from './dto/login.dto';
import type { LoginDto } from './dto/login.dto';
import { registerSchema } from './dto/register.dto';
import type { RegisterDto } from './dto/register.dto';
import { exchangeSchema } from './dto/exchange.dto';
import type { ExchangeDto } from './dto/exchange.dto';
import { requestOtpSchema } from './dto/request-otp.dto';
import type { RequestOtpDto } from './dto/request-otp.dto';
import { verifyOtpSchema } from './dto/verify-otp.dto';
import type { VerifyOtpDto } from './dto/verify-otp.dto';

const SEVEN_DAYS_IN_SECONDS = 7 * 24 * 60 * 60;
const LINK_COOKIE_MAX_AGE_SECONDS = 5 * 60;

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly otpService: OtpService,
  ) {}

  // Stricter than the global default (100/60s): both are direct credential-
  // guessing/account-spam targets, so brute-forcing them needs its own,
  // much tighter budget rather than sharing the same allowance as ordinary
  // read traffic like GET /posts.
  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async register(
    @Body(new ZodValidationPipe(registerSchema)) registerDto: RegisterDto,
  ) {
    return this.authService.register(registerDto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(
    @Body(new ZodValidationPipe(loginSchema)) loginDto: LoginDto,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const token = await this.authService.login(loginDto);

    this.setAccessTokenCookie(res, token);

    return { message: 'Login successful' };
  }

  @Post('exchange')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Exchange a short-lived OAuth code (from /auth/callback) for a real access token',
  })
  async exchange(
    @Body(new ZodValidationPipe(exchangeSchema)) exchangeDto: ExchangeDto,
  ) {
    const token = await this.authService.exchangeOAuthCode(exchangeDto.code);

    return { access_token: token };
  }

  // Same tightened budget rationale as register/login above — request is
  // an email-spam vector, verify is a code-guessing vector.
  @Post('otp/request')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Email a passwordless sign-in code' })
  async requestOtp(
    @Body(new ZodValidationPipe(requestOtpSchema)) requestOtpDto: RequestOtpDto,
  ) {
    return this.otpService.requestCode(
      requestOtpDto.email,
      requestOtpDto.locale,
    );
  }

  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Verify an emailed sign-in code and receive an access token',
  })
  async verifyOtp(
    @Body(new ZodValidationPipe(verifyOtpSchema)) verifyOtpDto: VerifyOtpDto,
  ) {
    return this.otpService.verifyCode(verifyOtpDto.email, verifyOtpDto.code);
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Get current user profile' })
  getProfile(@Req() request: FastifyRequest) {
    return this.authService.getProfile(request.user!.sub);
  }

  @Get('google')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: 'Redirect to Google OAuth2 consent screen' })
  googleAuth() {}

  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: 'Google OAuth2 callback' })
  async googleAuthCallback(
    @Req() request: FastifyRequest,
    @Res() res: FastifyReply,
  ) {
    return this.handleOAuthCallback(request, res);
  }

  @Get('github')
  @UseGuards(GithubAuthGuard)
  @ApiOperation({ summary: 'Redirect to GitHub OAuth2 consent screen' })
  githubAuth() {}

  @Get('github/link')
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Start linking a GitHub account to the logged-in user',
  })
  githubLink(@Req() request: FastifyRequest, @Res() res: FastifyReply) {
    res.setCookie('link_user_id', request.user!.sub, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      signed: true,
      maxAge: LINK_COOKIE_MAX_AGE_SECONDS,
    });

    return res.redirect('/auth/github', HttpStatus.FOUND);
  }

  @Get('github/callback')
  @UseGuards(GithubAuthGuard)
  @UseFilters(GithubPopupExceptionFilter)
  @ApiOperation({ summary: 'GitHub OAuth2 callback' })
  async githubAuthCallback(
    @Req() request: FastifyRequest,
    @Res() res: FastifyReply,
  ) {
    const isLinkFlow = Boolean(request.cookies?.link_user_id);

    if (isLinkFlow) {
      res.clearCookie('link_user_id', { path: '/' });
      return sendPopupScript(res, 'window.close();');
    }

    return this.handleOAuthCallback(request, res);
  }

  private handleOAuthCallback(request: FastifyRequest, res: FastifyReply) {
    // vertex-web and vertex-api are on different domains (Vercel vs Render),
    // so a cookie set here would be scoped to this API's own domain and the
    // frontend's cookies() calls could never see it — no amount of polling
    // bridges that gap. Redirecting the popup to the frontend's own callback
    // route instead lets vertex-web set the cookie itself, on its own
    // domain, via a Server Action.
    //
    // The redirect carries a short-lived, single-use exchange code — never
    // the real access token — since a URL can end up in browser history,
    // Referer headers, or a proxy's access log. The frontend trades this
    // code for the real token server-to-server via POST /auth/exchange,
    // immediately after which the code stops working.
    const code = this.authService.createOAuthExchangeCode(request.user!);
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';

    return res.redirect(
      `${frontendUrl}/auth/callback?code=${encodeURIComponent(code)}`,
      HttpStatus.FOUND,
    );
  }

  private setAccessTokenCookie(res: FastifyReply, token: string) {
    res.setCookie('access_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SEVEN_DAYS_IN_SECONDS,
    });
  }
}
