import { UploadsService } from './uploads.service';
import { ObjectStorage } from './storage/object-storage';
import { S3ObjectStorage } from './storage/s3-object-storage';

class FakeObjectStorage extends ObjectStorage {
  readonly publicUrlPrefix = 'https://test-bucket.s3.us-east-1.amazonaws.com/';
  createPresignedUploadUrl = jest
    .fn<Promise<string>, [string, string]>()
    .mockResolvedValue('https://signed.example.com/upload');
  deleteObjects = jest.fn<Promise<void>, [string[]]>().mockResolvedValue();
}

describe('UploadsService', () => {
  function createService() {
    const storage = new FakeObjectStorage();
    return { service: new UploadsService(storage), storage };
  }

  describe('getPresignedUrl', () => {
    it('generates a dated, uuid-prefixed key and presigns it', async () => {
      const { service, storage } = createService();

      const result = await service.getPresignedUrl('photo.png', 'image/png');

      expect(result.presignedUrl).toBe('https://signed.example.com/upload');
      expect(result.fileKey).toMatch(
        /^blog-media\/\d{4}-\d{2}\/[0-9a-f-]{36}-photo\.png$/,
      );
      expect(storage.createPresignedUploadUrl).toHaveBeenCalledWith(
        result.fileKey,
        'image/png',
      );
    });
  });

  describe('getAvatarPresignedUrl', () => {
    it('scopes the key under the requesting user, apart from blog-media', async () => {
      const { service, storage } = createService();

      const result = await service.getAvatarPresignedUrl(
        'user-1',
        'me.png',
        'image/png',
      );

      expect(result.fileKey).toMatch(
        /^avatars\/user-1\/[0-9a-f-]{36}-me\.png$/,
      );
      expect(storage.createPresignedUploadUrl).toHaveBeenCalledWith(
        result.fileKey,
        'image/png',
      );
    });
  });

  describe('extractBucketKeyFromUrl', () => {
    it('returns the key for a bucket-hosted URL', () => {
      const { service } = createService();

      expect(
        service.extractBucketKeyFromUrl(
          'https://test-bucket.s3.us-east-1.amazonaws.com/blog-media/2026-07/abc-cover.png',
        ),
      ).toBe('blog-media/2026-07/abc-cover.png');
    });

    it('returns null for a URL hosted outside the bucket', () => {
      const { service } = createService();

      expect(
        service.extractBucketKeyFromUrl('https://example.com/cover.png'),
      ).toBeNull();
    });

    it.each([null, undefined, ''])('returns null for %p', (url) => {
      const { service } = createService();

      expect(service.extractBucketKeyFromUrl(url)).toBeNull();
    });
  });

  describe('extractBucketKeysFromContent', () => {
    it('extracts bucket-hosted image keys from markdown content', () => {
      const { service } = createService();
      const content =
        'Look at this: ![alt](https://test-bucket.s3.us-east-1.amazonaws.com/blog-media/2026-07/abc-photo.png) and text.';

      expect(service.extractBucketKeysFromContent(content)).toEqual([
        'blog-media/2026-07/abc-photo.png',
      ]);
    });

    it('ignores image urls that are not hosted in this bucket', () => {
      const { service } = createService();
      const content = '![alt](https://example.com/not-our-bucket.png)';

      expect(service.extractBucketKeysFromContent(content)).toEqual([]);
    });

    it('returns an empty array when there are no images', () => {
      const { service } = createService();

      expect(service.extractBucketKeysFromContent('no images here')).toEqual(
        [],
      );
    });
  });

  describe('deleteFiles', () => {
    it('does nothing when given an empty key list', async () => {
      const { service, storage } = createService();

      await service.deleteFiles([]);

      expect(storage.deleteObjects).not.toHaveBeenCalled();
    });

    it('forwards the keys to the storage layer', async () => {
      const { service, storage } = createService();

      await service.deleteFiles(['key-1', 'key-2']);

      expect(storage.deleteObjects).toHaveBeenCalledWith(['key-1', 'key-2']);
    });
  });
});

describe('S3ObjectStorage', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  it('throws when required AWS environment variables are missing', () => {
    process.env = { ...originalEnv, AWS_REGION: undefined };

    expect(() => new S3ObjectStorage()).toThrow(
      'Missing required AWS environment variables',
    );
  });

  it('derives the public URL prefix from the bucket and region', () => {
    process.env = {
      ...originalEnv,
      AWS_REGION: 'us-east-1',
      AWS_ACCESS_KEY_ID: 'test-key',
      AWS_SECRET_ACCESS_KEY: 'test-secret',
      AWS_S3_BUCKET_NAME: 'test-bucket',
    };

    expect(new S3ObjectStorage().publicUrlPrefix).toBe(
      'https://test-bucket.s3.us-east-1.amazonaws.com/',
    );
  });
});
