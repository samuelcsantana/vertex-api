import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { createCommentSchema } from './dto/create-comment.dto';
import type { CreateCommentDto } from './dto/create-comment.dto';
import { CommentsService } from './comments.service';

@ApiTags('comments')
@Controller()
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  // Public route with optional identification: anonymous callers get the
  // usual payload, a valid admin session additionally gets each author's
  // email for moderation (never exposed publicly).
  @Get('posts/:postId/comments')
  @UseGuards(OptionalJwtAuthGuard)
  async findAllForPost(
    @Param('postId') postId: string,
    @Req() request: FastifyRequest,
  ) {
    return this.commentsService.findAllForPost(
      postId,
      request.user?.role === 'admin',
    );
  }

  @Get('users/:userId/comments')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiCookieAuth('access_token')
  async findAllForAuthor(@Param('userId') userId: string) {
    return this.commentsService.findAllForAuthor(userId);
  }

  @Post('posts/:postId/comments')
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth('access_token')
  async create(
    @Param('postId') postId: string,
    @Body(new ZodValidationPipe(createCommentSchema))
    createCommentDto: CreateCommentDto,
    @Req() request: FastifyRequest,
  ) {
    return this.commentsService.create(
      postId,
      request.user!.sub,
      createCommentDto,
    );
  }

  @Delete('comments/:commentId')
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth('access_token')
  async remove(
    @Param('commentId') commentId: string,
    @Req() request: FastifyRequest,
  ) {
    return this.commentsService.remove(
      commentId,
      request.user!.sub,
      request.user!.role,
    );
  }
}
