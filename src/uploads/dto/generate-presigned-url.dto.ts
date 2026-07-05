import { z } from 'zod';

export const generatePresignedUrlSchema = z.object({
  fileName: z.string().min(1),
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
});

export type GeneratePresignedUrlDto = z.infer<
  typeof generatePresignedUrlSchema
>;
