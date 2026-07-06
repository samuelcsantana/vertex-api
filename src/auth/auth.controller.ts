import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiCookieAuth, ApiOperation } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { loginSchema } from './dto/login.dto';
import type { LoginDto } from './dto/login.dto';
import { registerSchema } from './dto/register.dto';
import type { RegisterDto } from './dto/register.dto';

const SEVEN_DAYS_IN_SECONDS = 7 * 24 * 60 * 60;

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(
    @Body(new ZodValidationPipe(registerSchema)) registerDto: RegisterDto,
  ) {
    return this.authService.register(registerDto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) loginDto: LoginDto,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const token = await this.authService.login(loginDto);

    this.setAccessTokenCookie(res, token);

    return { message: 'Login successful' };
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Get current user profile' })
  getProfile(@Req() request: FastifyRequest) {
    return request.user;
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
    const token = await this.authService.generateAccessToken(request.user!);

    this.setAccessTokenCookie(res, token);

    return res.redirect(
      process.env.FRONTEND_URL ?? 'http://localhost:3000/dashboard',
      302,
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
