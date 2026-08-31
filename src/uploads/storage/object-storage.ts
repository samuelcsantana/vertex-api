// DIP seam for the one external layer in this module with a real variation
// axis: object storage is S3 in production, a fake in unit tests, and a
// future local-disk driver for offline dev would slot in here without
// touching UploadsService. An abstract class rather than an interface on
// purpose — Nest can use it directly as the DI token (see UploadsModule's
// provider binding), so consumers never name a concrete implementation.
//
// Deliberately NOT a template for the rest of the codebase: Drizzle gets no
// repository-interface layer on top of it. There is one database and no
// second implementation anyone is waiting for, so an interface over it would
// name the same thing twice; the ORM is already the abstraction. Tests that
// need a database fake build a chainable stand-in for databaseService.db by
// hand — see otp.service.spec.ts.
export abstract class ObjectStorage {
  /**
   * Absolute URL prefix (with trailing slash) that publicly served objects
   * live under — what UploadsService uses to recognize its own uploads
   * inside authored Markdown.
   */
  abstract readonly publicUrlPrefix: string;

  abstract createPresignedUploadUrl(
    key: string,
    contentType: string,
  ): Promise<string>;

  abstract deleteObjects(keys: string[]): Promise<void>;
}
