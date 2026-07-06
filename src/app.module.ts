import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { PostsModule } from './posts/posts.module';
import { UploadsModule } from './uploads/uploads.module';
import { ProjectsModule } from './projects/projects.module';
import { TopicsModule } from './topics/topics.module';
import { CommentsModule } from './comments/comments.module';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    PostsModule,
    UploadsModule,
    ProjectsModule,
    TopicsModule,
    CommentsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
