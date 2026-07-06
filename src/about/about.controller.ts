import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { updateAboutSchema } from './dto/update-about.dto';
import type { UpdateAboutDto } from './dto/update-about.dto';
import { AboutService } from './about.service';

@ApiTags('about')
@Controller('about')
export class AboutController {
  constructor(private readonly aboutService: AboutService) {}

  @Get()
  async get() {
    return this.aboutService.get();
  }

  @Patch()
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiCookieAuth('access_token')
  async update(
    @Body(new ZodValidationPipe(updateAboutSchema))
    updateAboutDto: UpdateAboutDto,
  ) {
    return this.aboutService.update(updateAboutDto);
  }
}
