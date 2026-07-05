import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { generatePresignedUrlSchema } from './dto/generate-presigned-url.dto';
import type { GeneratePresignedUrlDto } from './dto/generate-presigned-url.dto';
import { UploadsService } from './uploads.service';

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post('presigned-url')
  @UseGuards(JwtAuthGuard)
  async generatePresignedUrl(
    @Body(new ZodValidationPipe(generatePresignedUrlSchema))
    generatePresignedUrlDto: GeneratePresignedUrlDto,
  ) {
    const { fileName, contentType } = generatePresignedUrlDto;

    return this.uploadsService.getPresignedUrl(fileName, contentType);
  }
}
