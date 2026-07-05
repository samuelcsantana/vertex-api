import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { createPostSchema } from './dto/create-post.dto';
import type { CreatePostDto } from './dto/create-post.dto';
import { updatePostSchema } from './dto/update-post.dto';
import type { UpdatePostDto } from './dto/update-post.dto';
import { PostsService } from './posts.service';

@Controller('posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Get()
  async findAll() {
    return this.postsService.findAllPublished();
  }

  @Get(':slug')
  async findBySlug(@Param('slug') slug: string) {
    return this.postsService.findPublishedBySlug(slug);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  async create(
    @Body(new ZodValidationPipe(createPostSchema)) createPostDto: CreatePostDto,
    @Req() request: FastifyRequest,
  ) {
    const authorId = request.user!.sub;

    return this.postsService.create(createPostDto, authorId);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updatePostSchema)) updatePostDto: UpdatePostDto,
  ) {
    return this.postsService.update(id, updatePostDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async remove(@Param('id') id: string) {
    return this.postsService.remove(id);
  }
}
