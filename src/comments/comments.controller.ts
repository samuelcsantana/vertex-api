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
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { createCommentSchema } from './dto/create-comment.dto';
import type { CreateCommentDto } from './dto/create-comment.dto';
import { CommentsService } from './comments.service';

@ApiTags('comments')
@Controller()
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Get('posts/:postId/comments')
  async findAllForPost(@Param('postId') postId: string) {
    return this.commentsService.findAllForPost(postId);
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
