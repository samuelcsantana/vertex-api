import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { comments, posts, users } from '../database/schema';

const safeColumns = {
  id: true,
  email: true,
  name: true,
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
  avatarUrl: users.avatarUrl,
  githubId: users.githubId,
  role: users.role,
  isBanned: users.isBanned,
  createdAt: users.createdAt,
};

@Injectable()
export class UsersService {
  constructor(private readonly databaseService: DatabaseService) {}

  async findAll() {
    return this.databaseService.db.query.users.findMany({
      orderBy: desc(users.createdAt),
      columns: safeColumns,
    });
  }

  async setBanned(id: string, isBanned: boolean, requestingUserId: string) {
    if (id === requestingUserId) {
      throw new BadRequestException('You cannot ban your own account');
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
