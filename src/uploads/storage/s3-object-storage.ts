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
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    const bucketName = process.env.AWS_S3_BUCKET_NAME;

    if (!region || !bucketName) {
      throw new Error(
        'Missing required AWS environment variables: AWS_REGION, AWS_S3_BUCKET_NAME',
      );
    }

    this.bucketName = bucketName;
    this.publicUrlPrefix = `https://${bucketName}.s3.${region}.amazonaws.com/`;
    this.s3Client = new S3Client({
      region,
      // A key pair is required where there is no other identity — a container
      // on Render is nobody until it is handed one — and must be left out
      // where there is: on Lambda the execution role is the identity, and
      // supplying static keys as well would be two answers to one question,
      // with the long-lived one winning. Both are still required together;
      // half a pair is a typo, not a configuration.
      ...(accessKeyId && secretAccessKey
        ? { credentials: { accessKeyId, secretAccessKey } }
        : {}),
    });
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
