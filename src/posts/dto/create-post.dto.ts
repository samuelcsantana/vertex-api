import { z } from 'zod';

export const createPostSchema = z.object({
  title: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be a URL-friendly string'),
  content: z.string().min(1),
  isPublished: z.boolean().optional(),
  allowComments: z.boolean().optional(),
  coverUrl: z.string().url().optional(),
  topicIds: z.array(z.string().uuid()).optional(),
});

export type CreatePostDto = z.infer<typeof createPostSchema>;
