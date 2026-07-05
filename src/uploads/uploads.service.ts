import { Injectable } from '@nestjs/common';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';

const PRESIGNED_URL_EXPIRES_IN_SECONDS = 60;

@Injectable()
export class UploadsService {
  private readonly s3Client: S3Client;
  private readonly bucketName: string;

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
    this.s3Client = new S3Client({
      region,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  async getPresignedUrl(fileName: string, contentType: string) {
    const fileKey = `${uuidv4()}-${fileName}`;

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
}
