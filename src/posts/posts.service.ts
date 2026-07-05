import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { UploadsService } from '../uploads/uploads.service';
import { posts } from '../database/schema';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';

@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly uploadsService: UploadsService,
  ) {}

  async create(createPostDto: CreatePostDto, authorId: string) {
    const [createdPost] = await this.databaseService.db
      .insert(posts)
      .values({ ...createPostDto, authorId })
      .returning();

    return createdPost;
  }

  async findAllPublished() {
    return this.databaseService.db.query.posts.findMany({
      where: eq(posts.isPublished, true),
      orderBy: desc(posts.createdAt),
    });
  }

  async findAllForDashboard() {
    return this.databaseService.db.query.posts.findMany({
      orderBy: desc(posts.createdAt),
    });
  }

  async findPublishedBySlug(slug: string) {
    const post = await this.databaseService.db.query.posts.findFirst({
      where: and(eq(posts.slug, slug), eq(posts.isPublished, true)),
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    return post;
  }

  async update(id: string, updatePostDto: UpdatePostDto) {
    const [updatedPost] = await this.databaseService.db
      .update(posts)
      .set({ ...updatePostDto, updatedAt: new Date() })
      .where(eq(posts.id, id))
      .returning();

    if (!updatedPost) {
      throw new NotFoundException('Post not found');
    }

    return updatedPost;
  }

  async remove(id: string) {
    const [deletedPost] = await this.databaseService.db
      .delete(posts)
      .where(eq(posts.id, id))
      .returning();

    if (!deletedPost) {
      throw new NotFoundException('Post not found');
    }

    const imageKeys = this.uploadsService.extractBucketKeysFromContent(
      deletedPost.content,
    );

    if (imageKeys.length > 0) {
      try {
        await this.uploadsService.deleteFiles(imageKeys);
      } catch (error) {
        this.logger.warn(
          `Failed to delete S3 media for post ${id}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }

    return deletedPost;
  }
}
