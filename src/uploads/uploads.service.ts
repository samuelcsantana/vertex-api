import { Injectable } from '@nestjs/common';
import {
  DeleteObjectsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';

const PRESIGNED_URL_EXPIRES_IN_SECONDS = 60;
const MARKDOWN_IMAGE_URL_PATTERN = /!\[.*?\]\((https:\/\/[^\s)]+)\)/g;

@Injectable()
export class UploadsService {
  private readonly s3Client: S3Client;
  private readonly bucketName: string;
  private readonly bucketUrlPrefix: string;

  constructor() {
    const region = process.env.AWS_REGION;
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    const bucketName = process.env.AWS_S3_BUCKET_NAME;

    if (!region || !accessKeyId || !secretAccessKey || !bucketName) {
      throw new Error(
        'Missing required AWS environment variables: AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_S3_BUCKET_NAME',
      );
    }

    this.bucketName = bucketName;
    this.bucketUrlPrefix = `https://${bucketName}.s3.${region}.amazonaws.com/`;
    this.s3Client = new S3Client({
      region,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  async getPresignedUrl(fileName: string, contentType: string) {
    const date = new Date();
    const folder = `blog-media/${date.getFullYear()}-${String(
      date.getMonth() + 1,
    ).padStart(2, '0')}`;
    const fileKey = `${folder}/${uuidv4()}-${fileName}`;

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: fileKey,
      ContentType: contentType,
    });

    const presignedUrl = await getSignedUrl(this.s3Client, command, {
      expiresIn: PRESIGNED_URL_EXPIRES_IN_SECONDS,
    });

    return { presignedUrl, fileKey };
  }

  extractBucketKeysFromContent(content: string): string[] {
    const matches = [...content.matchAll(MARKDOWN_IMAGE_URL_PATTERN)];

    return matches
      .map((match) => match[1])
      .filter((url) => url.startsWith(this.bucketUrlPrefix))
      .map((url) => url.slice(this.bucketUrlPrefix.length));
  }

  async deleteFiles(keys: string[]): Promise<void> {
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
