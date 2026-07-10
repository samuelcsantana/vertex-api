import { z } from 'zod';

export const verifyOtpSchema = z.object({
  email: z.email().transform((value) => value.toLowerCase()),
  code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
});

export type VerifyOtpDto = z.infer<typeof verifyOtpSchema>;
