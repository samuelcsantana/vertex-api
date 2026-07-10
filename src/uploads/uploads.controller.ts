import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { generatePresignedUrlSchema } from './dto/generate-presigned-url.dto';
import type { GeneratePresignedUrlDto } from './dto/generate-presigned-url.dto';
import { UploadsService } from './uploads.service';

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post('presigned-url')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async generatePresignedUrl(
    @Body(new ZodValidationPipe(generatePresignedUrlSchema))
    generatePresignedUrlDto: GeneratePresignedUrlDto,
  ) {
    const { fileName, contentType } = generatePresignedUrlDto;

    return this.uploadsService.getPresignedUrl(fileName, contentType);
  }

  // Deliberately NOT the admin route above with a relaxed guard: avatars
  // are every authenticated user's right, but they get their own per-user
  // key prefix and a tight rate budget instead of the blog-media tree.
  @Post('avatar-presigned-url')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async generateAvatarPresignedUrl(
    @Body(new ZodValidationPipe(generatePresignedUrlSchema))
    generatePresignedUrlDto: GeneratePresignedUrlDto,
    @Req() request: FastifyRequest,
  ) {
    const { fileName, contentType } = generatePresignedUrlDto;

    return this.uploadsService.getAvatarPresignedUrl(
      request.user!.sub,
      fileName,
      contentType,
    );
  }
}
