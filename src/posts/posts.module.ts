import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [PostsController],
  providers: [PostsService],
})
export class PostsModule {}
