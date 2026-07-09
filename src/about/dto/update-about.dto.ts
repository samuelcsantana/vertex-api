import { z } from 'zod';

export const updateAboutSchema = z.object({
  // content is the pt (default-locale) text and stays required; en/es are
  // optional translations — an empty string means "no translation", same
  // convention posts use for contentEn/contentEs.
  content: z.string().min(1),
  contentEn: z.string().optional(),
  contentEs: z.string().optional(),
});

export type UpdateAboutDto = z.infer<typeof updateAboutSchema>;
