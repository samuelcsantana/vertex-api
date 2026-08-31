import { loadConfigFromParameterStore } from './parameter-store';

const send = jest.fn();

jest.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: jest.fn().mockImplementation(() => ({
    send: (...args: unknown[]): unknown => send(...args),
  })),
  GetParametersByPathCommand: jest
    .fn()
    .mockImplementation((input: unknown) => ({ input })),
}));

interface CapturedCommand {
  input: { Path?: string; WithDecryption?: boolean; NextToken?: string };
}

function captured(index: number): CapturedCommand {
  return (send.mock.calls as unknown as CapturedCommand[][])[index][0];
}

describe('loadConfigFromParameterStore', () => {
  const PREFIX = '/vertex-api/';
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    env = { ...process.env };
    send.mockReset();
  });

  afterEach(() => {
    process.env = env;
  });

  it('does nothing when no prefix is configured', async () => {
    // Local development and the e2e suite: .env and the shell are the source,
    // and this code must stay entirely out of the way.
    delete process.env.CONFIG_PARAMETER_PREFIX;

    await expect(loadConfigFromParameterStore()).resolves.toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it('puts each parameter into the environment under its last path segment', async () => {
    process.env.CONFIG_PARAMETER_PREFIX = PREFIX;
    delete process.env.DATABASE_URL;
    send.mockResolvedValueOnce({
      Parameters: [
        { Name: '/vertex-api/DATABASE_URL', Value: 'postgres://somewhere' },
      ],
    });

    const loaded = await loadConfigFromParameterStore();

    expect(process.env.DATABASE_URL).toBe('postgres://somewhere');
    expect(loaded).toEqual(['DATABASE_URL']);
  });

  it('asks for decrypted values', async () => {
    // A SecureString read without this comes back as ciphertext, and the app
    // boots happily with a password-shaped string that is not the password.
    process.env.CONFIG_PARAMETER_PREFIX = PREFIX;
    send.mockResolvedValueOnce({ Parameters: [] });

    await loadConfigFromParameterStore();

    expect(captured(0).input.WithDecryption).toBe(true);
    expect(captured(0).input.Path).toBe(PREFIX);
  });

  it('follows pagination rather than stopping at the first page', async () => {
    // Silently loading half the configuration is worse than loading none:
    // the app starts and fails later, somewhere unrelated.
    process.env.CONFIG_PARAMETER_PREFIX = PREFIX;
    delete process.env.FIRST;
    delete process.env.SECOND;
    send
      .mockResolvedValueOnce({
        Parameters: [{ Name: '/vertex-api/FIRST', Value: '1' }],
        NextToken: 'more',
      })
      .mockResolvedValueOnce({
        Parameters: [{ Name: '/vertex-api/SECOND', Value: '2' }],
      });

    const loaded = await loadConfigFromParameterStore();

    expect(loaded.sort()).toEqual(['FIRST', 'SECOND']);
    expect(captured(1).input.NextToken).toBe('more');
  });

  it('leaves an existing environment variable alone', async () => {
    // The override path: one variable changed for a debug run should not need
    // a write to the store, and should not be silently undone by it.
    process.env.CONFIG_PARAMETER_PREFIX = PREFIX;
    process.env.DATABASE_URL = 'postgres://the-one-i-set';
    send.mockResolvedValueOnce({
      Parameters: [
        {
          Name: '/vertex-api/DATABASE_URL',
          Value: 'postgres://the-stored-one',
        },
      ],
    });

    const loaded = await loadConfigFromParameterStore();

    expect(process.env.DATABASE_URL).toBe('postgres://the-one-i-set');
    expect(loaded).toEqual([]);
  });

  it('skips a parameter with no value rather than writing undefined', async () => {
    process.env.CONFIG_PARAMETER_PREFIX = PREFIX;
    delete process.env.EMPTY_ONE;
    send.mockResolvedValueOnce({
      Parameters: [{ Name: '/vertex-api/EMPTY_ONE' }],
    });

    const loaded = await loadConfigFromParameterStore();

    expect('EMPTY_ONE' in process.env).toBe(false);
    expect(loaded).toEqual([]);
  });
});
