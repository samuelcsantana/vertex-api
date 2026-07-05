import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { UploadsModule } from '../uploads/uploads.module';
import { PostsController } from './posts.controller';
import { DashboardPostsController } from './dashboard-posts.controller';
import { PostsService } from './posts.service';

@Module({
  imports: [DatabaseModule, AuthModule, UploadsModule],
  controllers: [PostsController, DashboardPostsController],
  providers: [PostsService],
})
export class PostsModule {}
