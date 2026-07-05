import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { PostsModule } from './posts/posts.module';
import { UploadsModule } from './uploads/uploads.module';
import { ProjectsModule } from './projects/projects.module';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    PostsModule,
    UploadsModule,
    ProjectsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
