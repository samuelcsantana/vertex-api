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
@UseGuards(JwtAuthGuard)
@ApiCookieAuth('access_token')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @UseGuards(AdminGuard)
  async findAll() {
    return this.usersService.findAll();
  }

  @Patch(':id/ban')
  @UseGuards(AdminGuard)
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

  // Declared before the :id route below — Nest matches routes in
  // declaration order, and a literal segment like "me" would otherwise be
  // swallowed by :id, making this endpoint unreachable (id="me" would just
  // 404 as "no such user"). No AdminGuard: this is every user's own right
  // to delete their own account, not an admin action.
  @Delete('me')
  async removeSelf(@Req() request: FastifyRequest) {
    return this.usersService.removeSelf(request.user!.sub);
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  async remove(@Param('id') id: string, @Req() request: FastifyRequest) {
    return this.usersService.remove(id, request.user!.sub);
  }
}
