import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { comments, posts } from '../database/schema';
import { UserRole } from '../auth/interfaces/jwt-payload.interface';
import { CreateCommentDto } from './dto/create-comment.dto';

@Injectable()
export class CommentsService {
  constructor(private readonly databaseService: DatabaseService) {}

  async findAllForPost(postId: string) {
    return this.databaseService.db.query.comments.findMany({
      where: eq(comments.postId, postId),
      orderBy: desc(comments.createdAt),
      with: {
        author: {
          columns: { id: true, name: true, avatarUrl: true },
        },
      },
    });
  }

  async create(
    postId: string,
    authorId: string,
    createCommentDto: CreateCommentDto,
  ) {
    const post = await this.databaseService.db.query.posts.findFirst({
      where: eq(posts.id, postId),
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    if (!post.allowComments) {
      throw new BadRequestException(
        'Comentários desativados para este artigo.',
      );
    }

    const [createdComment] = await this.databaseService.db
      .insert(comments)
      .values({ postId, authorId, content: createCommentDto.content })
      .returning();

    return createdComment;
  }

  async remove(commentId: string, requestingUserId: string, role: UserRole) {
    const comment = await this.databaseService.db.query.comments.findFirst({
      where: eq(comments.id, commentId),
    });

    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    const isOwner = comment.authorId === requestingUserId;
    const isAdmin = role === 'admin';

    if (!isOwner && !isAdmin) {
      throw new ForbiddenException(
        'You are not allowed to delete this comment',
      );
    }

    await this.databaseService.db
      .delete(comments)
      .where(eq(comments.id, commentId));

    return comment;
  }
}
