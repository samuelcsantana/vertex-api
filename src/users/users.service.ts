import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { UploadsService } from '../uploads/uploads.service';
import { comments, posts, users } from '../database/schema';
import { ErrorCode } from '../common/constants/error-codes';
import { UpdateProfileDto } from './dto/update-profile.dto';

const safeColumns = {
  id: true,
  email: true,
  name: true,
  displayName: true,
  avatarUrl: true,
  githubId: true,
  role: true,
  isBanned: true,
  createdAt: true,
} as const;

// db.query.users' relational API takes the {column: true} shorthand above;
// .update()/.delete()'s .returning() (the core query builder) needs actual
// column references instead — two different Drizzle APIs, two shapes.
const safeReturning = {
  id: users.id,
  email: users.email,
  name: users.name,
  displayName: users.displayName,
  avatarUrl: users.avatarUrl,
  githubId: users.githubId,
  role: users.role,
  isBanned: users.isBanned,
  createdAt: users.createdAt,
};

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly uploadsService: UploadsService,
  ) {}

  async findAll() {
    return this.databaseService.db.query.users.findMany({
      orderBy: desc(users.createdAt),
      columns: safeColumns,
    });
  }

  async setBanned(id: string, isBanned: boolean, requestingUserId: string) {
    if (id === requestingUserId) {
      throw new BadRequestException({
        message: 'You cannot ban your own account',
        code: ErrorCode.CannotBanSelf,
      });
    }

    const [updated] = await this.databaseService.db
      .update(users)
      .set({ isBanned })
      .where(eq(users.id, id))
      .returning(safeReturning);

    if (!updated) {
      throw new NotFoundException('User not found');
    }

    return updated;
  }

  async remove(id: string, requestingUserId: string) {
    if (id === requestingUserId) {
      throw new BadRequestException(
        'You cannot delete your own account from the admin panel — use your profile page instead',
      );
    }

    return this.deleteUserAndCascadeComments(id);
  }

  // Anyone gets to delete their own account — that's the point, so there's
  // no requestingUserId self-check here the way remove() has one. Still
  // goes through the same authored-posts guard and comment cascade: the
  // rule that a user's identity can't be reassigned/blocked-away is about
  // the platform's content integrity, not about who is doing the deleting.
  async removeSelf(id: string) {
    return this.deleteUserAndCascadeComments(id);
  }

  // Self-service profile edit — like removeSelf, identity comes from the
  // token (controller passes request.user.sub), never a path param.
  async updateSelf(id: string, updateProfileDto: UpdateProfileDto) {
    const existing = await this.databaseService.db.query.users.findFirst({
      where: eq(users.id, id),
    });

    if (!existing) {
      throw new NotFoundException('User not found');
    }

    // "" means "clear my avatar" (the form always sends a string).
    const nextAvatarUrl =
      updateProfileDto.avatarUrl === ''
        ? null
        : (updateProfileDto.avatarUrl ?? existing.avatarUrl);

    const [updated] = await this.databaseService.db
      .update(users)
      .set({
        name: updateProfileDto.name ?? existing.name,
        displayName: updateProfileDto.displayName ?? existing.displayName,
        avatarUrl: nextAvatarUrl,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning(safeReturning);

    // A replaced/cleared bucket-hosted avatar is orphaned otherwise — same
    // try/warn policy as post media cleanup: never fail the write over it.
    if (existing.avatarUrl && existing.avatarUrl !== updated.avatarUrl) {
      const oldKey = this.uploadsService.extractBucketKeyFromUrl(
        existing.avatarUrl,
      );

      if (oldKey) {
        try {
          await this.uploadsService.deleteFiles([oldKey]);
        } catch (error) {
          this.logger.warn(
            `Failed to delete old avatar for user ${id}: ${error instanceof Error ? error.message : error}`,
          );
        }
      }
    }

    return updated;
  }

  private async deleteUserAndCascadeComments(id: string) {
    return this.databaseService.db.transaction(async (tx) => {
      // Posts require deliberate reassignment/deletion by an admin first —
      // silently cascading someone's published articles away as a side
      // effect of removing their account is not a safe default.
      const authoredPost = await tx.query.posts.findFirst({
        where: eq(posts.authorId, id),
      });

      if (authoredPost) {
        throw new BadRequestException(
          'Cannot delete a user who has authored posts',
        );
      }

      // Comments are low-stakes by comparison — cascade them so the user
      // row isn't blocked by a foreign key it has no other reason to keep.
      await tx.delete(comments).where(eq(comments.authorId, id));

      const [deleted] = await tx
        .delete(users)
        .where(eq(users.id, id))
        .returning(safeReturning);

      if (!deleted) {
        throw new NotFoundException('User not found');
      }

      return deleted;
    });
  }
}
