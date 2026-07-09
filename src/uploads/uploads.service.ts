import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { ObjectStorage } from './storage/object-storage';

const MARKDOWN_IMAGE_URL_PATTERN = /!\[.*?\]\((https:\/\/[^\s)]+)\)/g;

// Domain logic only — key naming and Markdown parsing. Everything
// provider-specific (S3 client, presigning, batch deletes, env validation)
// lives behind the ObjectStorage abstraction, which is what lets the spec
// test this class with a fake instead of poking a private s3Client field
// and faking AWS env vars.
@Injectable()
export class UploadsService {
  constructor(private readonly storage: ObjectStorage) {}

  async getPresignedUrl(fileName: string, contentType: string) {
    const date = new Date();
    const folder = `blog-media/${date.getFullYear()}-${String(
      date.getMonth() + 1,
    ).padStart(2, '0')}`;
    const fileKey = `${folder}/${uuidv4()}-${fileName}`;

    const presignedUrl = await this.storage.createPresignedUploadUrl(
      fileKey,
      contentType,
    );

    return { presignedUrl, fileKey };
  }

  extractBucketKeysFromContent(content: string): string[] {
    const matches = [...content.matchAll(MARKDOWN_IMAGE_URL_PATTERN)];

    return matches
      .map((match) => match[1])
      .filter((url) => url.startsWith(this.storage.publicUrlPrefix))
      .map((url) => url.slice(this.storage.publicUrlPrefix.length));
  }

  async deleteFiles(keys: string[]): Promise<void> {
    if (keys.length === 0) {
      return;
    }

    await this.storage.deleteObjects(keys);
  }
}
