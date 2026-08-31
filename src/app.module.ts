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
import { HealthModule } from './health/health.module';
import { createThrottlerStorage } from './common/throttler/throttler-storage.factory';

@Module({
  imports: [
    // Global default: 100 requests per IP per 60s, applied to every route
    // via the APP_GUARD below unless overridden with @Throttle(...) on a
    // specific handler (see login/register in auth.controller.ts).
    //
    // Where those counts are kept is decided by the environment, not here.
    // In-memory is the default and is correct for one process; point
    // THROTTLER_DDB_TABLE at a DynamoDB table and the same limits start being
    // counted across every instance instead of once per instance.
    ThrottlerModule.forRoot({
      throttlers: [
        {
          name: 'default',
          ttl: 60_000,
          limit: 100,
        },
      ],
      storage: createThrottlerStorage(),
    }),
    DatabaseModule,
    AuthModule,
    PostsModule,
    UploadsModule,
    ProjectsModule,
    TopicsModule,
    CommentsModule,
    AboutModule,
    UsersModule,
    HealthModule,
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
