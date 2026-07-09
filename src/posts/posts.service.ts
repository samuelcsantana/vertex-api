import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { UploadsService } from '../uploads/uploads.service';
import { posts, postsToTopics, topics } from '../database/schema';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { ErrorCode } from '../common/constants/error-codes';

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

// Field name shown to the admin (matching CreatePostDto's keys) for each
// unique constraint the "postgres" driver (porsager/postgres) can report
// on posts.create/update. Drizzle wraps the driver's PostgresError in its
// own error class, so the actual #code/#constraint_name aren't on the
// error it throws directly — they're one level down, on error.cause.
const SLUG_CONSTRAINT_FIELDS: Record<string, string> = {
  posts_slug_unique: 'slug',
  posts_slug_en_unique: 'slugEn',
  posts_slug_es_unique: 'slugEs',
};

function rethrowFriendlySlugConflict(error: unknown): never {
  const pgError = (error instanceof Error ? error.cause : undefined) as {
    code?: string;
    constraint_name?: string;
  };

  if (pgError?.code === '23505' && pgError.constraint_name) {
    const field = SLUG_CONSTRAINT_FIELDS[pgError.constraint_name];
    if (field) {
      // `field` rides along so the frontend's translated message can name
      // the offending slug field without parsing the English text.
      throw new ConflictException({
        message: `The "${field}" slug is already in use by another post.`,
        code: ErrorCode.SlugInUse,
        field,
      });
    }
  }

  throw error;
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

    return this.databaseService.db
      .transaction(async (tx) => {
        const [createdPost] = await tx
          .insert(posts)
          .values({ ...postData, authorId })
          .returning();

        if (topicIds && topicIds.length > 0) {
          await tx.insert(postsToTopics).values(
            topicIds.map((topicId) => ({
              postId: createdPost.id,
              topicId,
            })),
          );
        }

        const postWithTopics = await tx.query.posts.findFirst({
          where: eq(posts.id, createdPost.id),
          ...postWithTopicsQuery,
        });

        return withFlattenedTopics(postWithTopics!);
      })
      .catch(rethrowFriendlySlugConflict);
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

  // A post without its own slugEn/slugEs is reached under the default
  // (pt) slug for that locale too — same fallback semantics as
  // title/content already have (see localized-content.ts on the
  // frontend). "pt" and any unrecognized locale just match the default
  // slug column directly.
  async findPublishedBySlug(slug: string, locale?: string) {
    const localeSlugMatch =
      locale === 'en'
        ? or(
            eq(posts.slugEn, slug),
            and(isNull(posts.slugEn), eq(posts.slug, slug)),
          )
        : locale === 'es'
          ? or(
              eq(posts.slugEs, slug),
              and(isNull(posts.slugEs), eq(posts.slug, slug)),
            )
          : eq(posts.slug, slug);

    const post = await this.databaseService.db.query.posts.findFirst({
      where: and(localeSlugMatch, eq(posts.isPublished, true)),
      ...postWithTopicsQuery,
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    return withFlattenedTopics(post);
  }

  async update(id: string, updatePostDto: UpdatePostDto) {
    const { topicIds, ...postData } = updatePostDto;

    return this.databaseService.db
      .transaction(async (tx) => {
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
      })
      .catch(rethrowFriendlySlugConflict);
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
