import { UploadsService } from './uploads.service';

describe('UploadsService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      AWS_REGION: 'us-east-1',
      AWS_ACCESS_KEY_ID: 'test-key',
      AWS_SECRET_ACCESS_KEY: 'test-secret',
      AWS_S3_BUCKET_NAME: 'test-bucket',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function createService() {
    const service = new UploadsService();
    const send = jest.fn().mockResolvedValue(undefined);
    (service as unknown as { s3Client: { send: jest.Mock } }).s3Client = {
      send,
    };
    return { service, send };
  }

  it('throws when required AWS environment variables are missing', () => {
    process.env = { ...originalEnv, AWS_REGION: undefined };

    expect(() => new UploadsService()).toThrow(
      'Missing required AWS environment variables',
    );
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
      const { service, send } = createService();

      await service.deleteFiles([]);

      expect(send).not.toHaveBeenCalled();
    });

    it('sends a DeleteObjectsCommand for the given keys', async () => {
      const { service, send } = createService();

      await service.deleteFiles(['key-1', 'key-2']);

      expect(send).toHaveBeenCalledTimes(1);
    });
  });
});
