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
import { EdgeOriginGuard } from './common/edge/edge-origin.guard';
import { createClientTracker } from './common/throttler/client-tracker';
import { createThrottlerStorage } from './common/throttler/throttler-storage.factory';

@Module({
  imports: [
    // Global default: 100 requests per IP per 60s, applied to every route
    // via the APP_GUARD below unless overridden with @Throttle(...) on a
    // specific handler (see login/register in auth.controller.ts).
    //
    // Two things about that sentence are decided elsewhere, and both have to
    // be right for the limit to mean anything.
    //
    // *Where* the counts are kept is chosen by the environment, not here:
    // in-memory by default, which is correct for one process, and DynamoDB
    // when THROTTLER_DDB_TABLE points at a table — the same limits counted
    // across every instance instead of once per instance.
    //
    // *What* they are counted against is the other half. The default answer,
    // request.ip, stops being usable behind a CDN, where it is a value the
    // caller can set. Counters shared across instances would then be sharing
    // a number that means nothing. See createClientTracker.
    ThrottlerModule.forRoot({
      throttlers: [
        {
          name: 'default',
          ttl: 60_000,
          limit: 100,
        },
      ],
      storage: createThrottlerStorage(),
      getTracker: createClientTracker(),
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
      // Registered before the throttler on purpose: global guards run in the
      // order they are declared, and a request that has no business reaching
      // this origin should be turned away before it costs a rate-limit lookup.
      provide: APP_GUARD,
      useFactory: () => new EdgeOriginGuard(process.env.EDGE_SHARED_SECRET),
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
