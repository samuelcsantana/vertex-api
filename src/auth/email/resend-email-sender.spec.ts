import { ResendEmailSender } from './resend-email-sender';
import { ConsoleEmailSender } from './console-email-sender';

describe('ResendEmailSender', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  function configureEnv() {
    process.env = {
      ...originalEnv,
      RESEND_API_KEY: 're_test_key',
      OTP_EMAIL_FROM: 'Samuel Santana <login@samuelsantana.dev>',
    };
  }

  it('throws when required environment variables are missing', () => {
    process.env = {
      ...originalEnv,
      RESEND_API_KEY: undefined,
      OTP_EMAIL_FROM: undefined,
    };

    expect(() => new ResendEmailSender()).toThrow(
      'Missing required Resend environment variables: RESEND_API_KEY, OTP_EMAIL_FROM',
    );
  });

  it('posts the localized email to the Resend API', async () => {
    configureEnv();
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: true } as Response);

    await new ResendEmailSender().sendOtpEmail(
      'visitor@example.com',
      '123456',
      'en',
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer re_test_key',
    );
    const body = JSON.parse(init.body as string) as {
      from: string;
      to: string[];
      subject: string;
      html: string;
    };
    expect(body.to).toEqual(['visitor@example.com']);
    expect(body.subject).toBe('123456 is your sign-in code');
    expect(body.html).toContain('123456');
  });

  it('throws when Resend rejects the request', async () => {
    configureEnv();
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 422,
      text: () => Promise.resolve('domain not verified'),
    } as unknown as Response);

    await expect(
      new ResendEmailSender().sendOtpEmail(
        'visitor@example.com',
        '123456',
        'pt',
      ),
    ).rejects.toThrow(
      'Resend rejected the OTP email (422): domain not verified',
    );
  });
});

describe('ConsoleEmailSender', () => {
  it('resolves without any network activity', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');

    await expect(
      new ConsoleEmailSender().sendOtpEmail(
        'visitor@example.com',
        '123456',
        'pt',
      ),
    ).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();

    jest.restoreAllMocks();
  });
});
