import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ApiCookieAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { createPostSchema } from './dto/create-post.dto';
import type { CreatePostDto } from './dto/create-post.dto';
import { updatePostSchema } from './dto/update-post.dto';
import type { UpdatePostDto } from './dto/update-post.dto';
import { PostsService } from './posts.service';

@ApiTags('posts')
@Controller('posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Get()
  async findAll() {
    return this.postsService.findAllPublished();
  }

  @Get(':slug')
  @ApiQuery({
    name: 'locale',
    required: false,
    description:
      'pt (default), en, or es — resolves that locale\'s own slug column first, falling back to the default "slug" when the post has no translated slug of its own.',
  })
  async findBySlug(
    @Param('slug') slug: string,
    @Query('locale') locale?: string,
  ) {
    return this.postsService.findPublishedBySlug(slug, locale);
  }

  @Post()
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiCookieAuth('access_token')
  async create(
    @Body(new ZodValidationPipe(createPostSchema)) createPostDto: CreatePostDto,
    @Req() request: FastifyRequest,
  ) {
    const authorId = request.user!.sub;

    return this.postsService.create(createPostDto, authorId);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiCookieAuth('access_token')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updatePostSchema)) updatePostDto: UpdatePostDto,
  ) {
    return this.postsService.update(id, updatePostDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiCookieAuth('access_token')
  async remove(@Param('id') id: string) {
    return this.postsService.remove(id);
  }
}
