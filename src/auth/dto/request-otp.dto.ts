import { z } from 'zod';

export const requestOtpSchema = z.object({
  email: z.email().transform((value) => value.toLowerCase()),
  // Language for the code email — defaults to the site's default locale.
  locale: z.enum(['pt', 'en', 'es']).default('pt'),
});

export type RequestOtpDto = z.infer<typeof requestOtpSchema>;
