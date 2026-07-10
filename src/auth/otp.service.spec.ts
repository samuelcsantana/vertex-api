import { HttpException, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import { OtpService } from './otp.service';
import { DatabaseService } from '../database/database.service';
import { AuthService } from './auth.service';
import { EmailSender } from './email/email-sender';
import { emailOtps } from '../database/schema';

// Independent re-implementation of the service's hashing scheme, so a test
// failure here means the scheme itself changed — not that both sides drifted
// together.
function hashOf(email: string, code: string): string {
  return createHash('sha256').update(`${email}:${code}`).digest('hex');
}

const baseUser = {
  id: 'user-1',
  email: 'visitor@example.com',
  name: null,
  avatarUrl: null,
  role: 'user' as const,
  isBanned: false,
};

function createService(options: {
  otpFindFirst?: jest.Mock;
  userFindFirst?: jest.Mock;
  userInsertReturning?: jest.Mock;
  sendOtpEmail?: jest.Mock;
}) {
  const otpFindFirst =
    options.otpFindFirst ?? jest.fn().mockResolvedValue(undefined);
  const userFindFirst =
    options.userFindFirst ?? jest.fn().mockResolvedValue(undefined);
  const userInsertReturning =
    options.userInsertReturning ?? jest.fn().mockResolvedValue([baseUser]);

  const otpInsertValues = jest.fn().mockResolvedValue(undefined);
  const userInsertValues = jest
    .fn()
    .mockReturnValue({ returning: userInsertReturning });
  const insert = jest
    .fn()
    .mockImplementation((table: unknown) =>
      table === emailOtps
        ? { values: otpInsertValues }
        : { values: userInsertValues },
    );

  const deleteWhere = jest.fn().mockResolvedValue(undefined);
  const del = jest.fn().mockReturnValue({ where: deleteWhere });

  const updateWhere = jest.fn().mockResolvedValue(undefined);
  const updateSet = jest.fn().mockReturnValue({ where: updateWhere });
  const update = jest.fn().mockReturnValue({ set: updateSet });

  const databaseService = {
    db: {
      query: {
        emailOtps: { findFirst: otpFindFirst },
        users: { findFirst: userFindFirst },
      },
      insert,
      delete: del,
      update,
    },
  } as unknown as DatabaseService;
  const generateAccessToken = jest.fn().mockResolvedValue('fake.jwt.token');
  const authService = { generateAccessToken } as unknown as AuthService;
  const sendOtpEmail =
    options.sendOtpEmail ?? jest.fn().mockResolvedValue(undefined);
  const emailSender = { sendOtpEmail } as unknown as EmailSender;

  return {
    service: new OtpService(databaseService, authService, emailSender),
    otpInsertValues,
    userInsertValues,
    del,
    updateSet,
    sendOtpEmail,
    generateAccessToken,
  };
}

describe('OtpService — requestCode', () => {
  it('stores a hashed 6-digit code and emails the plain one', async () => {
    const { service, otpInsertValues, sendOtpEmail } = createService({});

    await service.requestCode('visitor@example.com', 'pt');

    expect(sendOtpEmail).toHaveBeenCalledTimes(1);
    const [to, code, locale] = sendOtpEmail.mock.calls[0] as [
      string,
      string,
      string,
    ];
    expect(to).toBe('visitor@example.com');
    expect(code).toMatch(/^\d{6}$/);
    expect(locale).toBe('pt');

    const [row] = otpInsertValues.mock.calls[0] as [
      { email: string; codeHash: string; expiresAt: Date },
    ];
    expect(row.email).toBe('visitor@example.com');
    // The stored hash must correspond to the exact code that was emailed.
    expect(row.codeHash).toBe(hashOf('visitor@example.com', code));
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects a resend within the 60s cooldown without sending anything', async () => {
    const otpFindFirst = jest.fn().mockResolvedValue({
      id: 'otp-1',
      email: 'visitor@example.com',
      codeHash: 'x',
      attempts: 0,
      createdAt: new Date(Date.now() - 30_000),
      expiresAt: new Date(Date.now() + 9 * 60_000),
    });
    const { service, sendOtpEmail } = createService({ otpFindFirst });

    await expect(
      service.requestCode('visitor@example.com', 'pt'),
    ).rejects.toThrow(HttpException);
    expect(sendOtpEmail).not.toHaveBeenCalled();
  });

  it('allows a new code once the cooldown has passed, replacing the old row', async () => {
    const otpFindFirst = jest.fn().mockResolvedValue({
      id: 'otp-1',
      email: 'visitor@example.com',
      codeHash: 'x',
      attempts: 3,
      createdAt: new Date(Date.now() - 90_000),
      expiresAt: new Date(Date.now() + 8 * 60_000),
    });
    const { service, del, otpInsertValues, sendOtpEmail } = createService({
      otpFindFirst,
    });

    await service.requestCode('visitor@example.com', 'pt');

    expect(del).toHaveBeenCalled();
    expect(otpInsertValues).toHaveBeenCalled();
    expect(sendOtpEmail).toHaveBeenCalled();
  });

  it('removes the stored code and rethrows when the email fails to send', async () => {
    const sendOtpEmail = jest
      .fn()
      .mockRejectedValue(new Error('Resend rejected the OTP email (500)'));
    const { service, del } = createService({ sendOtpEmail });

    await expect(
      service.requestCode('visitor@example.com', 'pt'),
    ).rejects.toThrow('Resend rejected the OTP email (500)');
    // Once to replace any previous row, once to clean up after the failure.
    expect(del).toHaveBeenCalledTimes(2);
  });
});

describe('OtpService — verifyCode', () => {
  const email = 'visitor@example.com';
  const code = '123456';

  function validEntry(overrides: Record<string, unknown> = {}) {
    return {
      id: 'otp-1',
      email,
      codeHash: hashOf(email, code),
      attempts: 0,
      createdAt: new Date(Date.now() - 5_000),
      expiresAt: new Date(Date.now() + 9 * 60_000),
      ...overrides,
    };
  }

  it('returns a token and deletes the row for an existing user', async () => {
    const otpFindFirst = jest.fn().mockResolvedValue(validEntry());
    const userFindFirst = jest.fn().mockResolvedValue(baseUser);
    const { service, del, generateAccessToken } = createService({
      otpFindFirst,
      userFindFirst,
    });

    await expect(service.verifyCode(email, code)).resolves.toEqual({
      access_token: 'fake.jwt.token',
    });
    expect(del).toHaveBeenCalled();
    expect(generateAccessToken).toHaveBeenCalledWith({
      sub: baseUser.id,
      email: baseUser.email,
      role: baseUser.role,
      name: baseUser.name,
      avatarUrl: baseUser.avatarUrl,
    });
  });

  it('creates the user on first login', async () => {
    const otpFindFirst = jest.fn().mockResolvedValue(validEntry());
    const { service, userInsertValues } = createService({ otpFindFirst });

    await service.verifyCode(email, code);

    const [inserted] = userInsertValues.mock.calls[0] as [
      { email: string; passwordHash: string; role: string },
    ];
    expect(inserted.email).toBe(email);
    expect(inserted.role).toBe('user');
    // passwordHash is NOT NULL in the schema — passwordless users get a
    // random argon2-hashed throwaway, never an empty value.
    expect(inserted.passwordHash).toMatch(/^\$argon2/);
  });

  it('rejects when no code was ever requested', async () => {
    const { service } = createService({});

    await expect(service.verifyCode(email, code)).rejects.toThrow(
      'Invalid code',
    );
  });

  it('rejects and deletes an expired code', async () => {
    const otpFindFirst = jest
      .fn()
      .mockResolvedValue(
        validEntry({ expiresAt: new Date(Date.now() - 1_000) }),
      );
    const { service, del } = createService({ otpFindFirst });

    await expect(service.verifyCode(email, code)).rejects.toThrow(
      'Code expired',
    );
    expect(del).toHaveBeenCalled();
  });

  it('rejects the right code once the attempt cap is exhausted', async () => {
    const otpFindFirst = jest
      .fn()
      .mockResolvedValue(validEntry({ attempts: 5 }));
    const { service, del } = createService({ otpFindFirst });

    await expect(service.verifyCode(email, code)).rejects.toThrow(
      'Too many attempts',
    );
    expect(del).toHaveBeenCalled();
  });

  it('increments attempts on a wrong code and keeps the row', async () => {
    const otpFindFirst = jest
      .fn()
      .mockResolvedValue(validEntry({ attempts: 2 }));
    const { service, updateSet, del } = createService({ otpFindFirst });

    await expect(service.verifyCode(email, '000000')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(updateSet).toHaveBeenCalledWith({ attempts: 3 });
    expect(del).not.toHaveBeenCalled();
  });

  it('rejects a banned user even with the right code', async () => {
    const otpFindFirst = jest.fn().mockResolvedValue(validEntry());
    const userFindFirst = jest
      .fn()
      .mockResolvedValue({ ...baseUser, isBanned: true });
    const { service } = createService({ otpFindFirst, userFindFirst });

    await expect(service.verifyCode(email, code)).rejects.toThrow(
      'User is banned',
    );
  });
});
