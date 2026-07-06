import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { UploadsService } from '../uploads/uploads.service';
import { posts, postsToTopics, topics } from '../database/schema';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';

const postWithTopicsQuery = {
  with: {
    author: {
      columns: { id: true, name: true, avatarUrl: true },
    },
    postsToTopics: {
      with: {
        topic: true,
      },
    },
  },
} as const;

function withFlattenedTopics<
  T extends { postsToTopics: { topic: typeof topics.$inferSelect }[] },
>(post: T) {
  const { postsToTopics: postTopics, ...rest } = post;

  return { ...rest, topics: postTopics.map((entry) => entry.topic) };
}

@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly uploadsService: UploadsService,
  ) {}

  async create(createPostDto: CreatePostDto, authorId: string) {
    const { topicIds, ...postData } = createPostDto;

    return this.databaseService.db.transaction(async (tx) => {
      const [createdPost] = await tx
        .insert(posts)
        .values({ ...postData, authorId })
        .returning();

      if (topicIds && topicIds.length > 0) {
        await tx
          .insert(postsToTopics)
          .values(
            topicIds.map((topicId) => ({ postId: createdPost.id, topicId })),
          );
      }

      const postWithTopics = await tx.query.posts.findFirst({
        where: eq(posts.id, createdPost.id),
        ...postWithTopicsQuery,
      });

      return withFlattenedTopics(postWithTopics!);
    });
  }

  async findAllPublished() {
    const results = await this.databaseService.db.query.posts.findMany({
      where: eq(posts.isPublished, true),
      orderBy: desc(posts.createdAt),
      ...postWithTopicsQuery,
    });

    return results.map(withFlattenedTopics);
  }

  async findAllForDashboard() {
    const results = await this.databaseService.db.query.posts.findMany({
      orderBy: desc(posts.createdAt),
      ...postWithTopicsQuery,
    });

    return results.map(withFlattenedTopics);
  }

  async findPublishedBySlug(slug: string) {
    const post = await this.databaseService.db.query.posts.findFirst({
      where: and(eq(posts.slug, slug), eq(posts.isPublished, true)),
      ...postWithTopicsQuery,
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    return withFlattenedTopics(post);
  }

  async update(id: string, updatePostDto: UpdatePostDto) {
    const { topicIds, ...postData } = updatePostDto;

    return this.databaseService.db.transaction(async (tx) => {
      const [updatedPost] = await tx
        .update(posts)
        .set({ ...postData, updatedAt: new Date() })
        .where(eq(posts.id, id))
        .returning();

      if (!updatedPost) {
        throw new NotFoundException('Post not found');
      }

      if (topicIds) {
        await tx.delete(postsToTopics).where(eq(postsToTopics.postId, id));

        if (topicIds.length > 0) {
          await tx
            .insert(postsToTopics)
            .values(topicIds.map((topicId) => ({ postId: id, topicId })));
        }
      }

      const postWithTopics = await tx.query.posts.findFirst({
        where: eq(posts.id, id),
        ...postWithTopicsQuery,
      });

      return withFlattenedTopics(postWithTopics!);
    });
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
