import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';
import { ObjectStorage } from './storage/object-storage';
import { S3ObjectStorage } from './storage/s3-object-storage';

@Module({
  imports: [AuthModule],
  controllers: [UploadsController],
  // The abstract class doubles as the DI token — this binding is the single
  // place that decides which concrete storage the app runs on.
  providers: [
    UploadsService,
    { provide: ObjectStorage, useClass: S3ObjectStorage },
  ],
  exports: [UploadsService],
})
export class UploadsModule {}
