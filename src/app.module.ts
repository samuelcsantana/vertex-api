import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { PostsModule } from './posts/posts.module';
import { UploadsModule } from './uploads/uploads.module';
import { ProjectsModule } from './projects/projects.module';
import { TopicsModule } from './topics/topics.module';
import { CommentsModule } from './comments/comments.module';
import { AboutModule } from './about/about.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    // Global default: 100 requests per IP per 60s, applied to every route
    // via the APP_GUARD below unless overridden with @Throttle(...) on a
    // specific handler (see login/register in auth.controller.ts).
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: 100,
      },
    ]),
    DatabaseModule,
    AuthModule,
    PostsModule,
    UploadsModule,
    ProjectsModule,
    TopicsModule,
    CommentsModule,
    AboutModule,
    UsersModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
