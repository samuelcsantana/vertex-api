import { z } from 'zod';

export const updateAboutSchema = z.object({
  content: z.string().min(1),
});

export type UpdateAboutDto = z.infer<typeof updateAboutSchema>;
