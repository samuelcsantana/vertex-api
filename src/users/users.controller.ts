import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { setBannedSchema } from './dto/set-banned.dto';
import type { SetBannedDto } from './dto/set-banned.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@Controller('users')
@UseGuards(JwtAuthGuard, AdminGuard)
@ApiCookieAuth('access_token')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  async findAll() {
    return this.usersService.findAll();
  }

  @Patch(':id/ban')
  async setBanned(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(setBannedSchema)) setBannedDto: SetBannedDto,
    @Req() request: FastifyRequest,
  ) {
    return this.usersService.setBanned(
      id,
      setBannedDto.isBanned,
      request.user!.sub,
    );
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() request: FastifyRequest) {
    return this.usersService.remove(id, request.user!.sub);
  }
}
