import { Injectable } from '@nestjs/common';
import {
  DeleteObjectsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ObjectStorage } from './object-storage';

const PRESIGNED_URL_EXPIRES_IN_SECONDS = 60;

@Injectable()
export class S3ObjectStorage extends ObjectStorage {
  private readonly s3Client: S3Client;
  private readonly bucketName: string;
  readonly publicUrlPrefix: string;

  constructor() {
    super();

    const region = process.env.AWS_REGION;
    const bucketName = process.env.AWS_S3_BUCKET_NAME;

    if (!region || !bucketName) {
      throw new Error(
        'Missing required AWS environment variables: AWS_REGION, AWS_S3_BUCKET_NAME',
      );
    }

    this.bucketName = bucketName;
    this.publicUrlPrefix = `https://${bucketName}.s3.${region}.amazonaws.com/`;

    // No credentials passed, deliberately. This used to hand the client
    // AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY read from the environment,
    // which the SDK's own default chain already does — and does better,
    // because it also reads AWS_SESSION_TOKEN.
    //
    // That last part is not a detail. A Lambda execution role arrives as all
    // three variables, and a client handed only the first two signs requests
    // with temporary credentials while omitting the token that makes them
    // valid. Every presign would come back rejected, at upload time, in
    // production, from code that looked like it was configured correctly.
    //
    // Leaving it to the chain covers both homes this app has: static keys in
    // the environment where it is nobody until handed some, and the execution
    // role where it is somebody.
    this.s3Client = new S3Client({ region });
  }

  async createPresignedUploadUrl(
    key: string,
    contentType: string,
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      ContentType: contentType,
    });

    return getSignedUrl(this.s3Client, command, {
      expiresIn: PRESIGNED_URL_EXPIRES_IN_SECONDS,
    });
  }

  async deleteObjects(keys: string[]): Promise<void> {
    if (keys.length === 0) {
      return;
    }

    await this.s3Client.send(
      new DeleteObjectsCommand({
        Bucket: this.bucketName,
        Delete: { Objects: keys.map((key) => ({ Key: key })) },
      }),
    );
  }
}
