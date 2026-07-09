import { ServiceUnavailableException } from '@nestjs/common';
import { GoogleStrategy } from './google.strategy';
import { GithubStrategy } from './github.strategy';
import { DatabaseService } from '../../database/database.service';

// Regression guard for the boot-time failure mode: missing OAuth env vars
// must degrade to a 503 on the OAuth routes themselves, never crash the
// whole app at construction (which used to force OAuth-less local dev and
// every e2e run to supply credentials just to boot).
describe('OAuth strategies without credentials configured', () => {
  const originalEnv = process.env;
  const databaseService = {} as DatabaseService;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('constructs without throwing', () => {
    expect(() => new GoogleStrategy(databaseService)).not.toThrow();
    expect(() => new GithubStrategy(databaseService)).not.toThrow();
  });

  it('rejects Google authentication attempts with a 503', () => {
    const strategy = new GoogleStrategy(databaseService);

    expect(() =>
      strategy.authenticate(
        {} as Parameters<GoogleStrategy['authenticate']>[0],
      ),
    ).toThrow(ServiceUnavailableException);
  });

  it('rejects GitHub authentication attempts with a 503', () => {
    const strategy = new GithubStrategy(databaseService);

    expect(() =>
      strategy.authenticate(
        {} as Parameters<GithubStrategy['authenticate']>[0],
      ),
    ).toThrow(ServiceUnavailableException);
  });
});
