import { z } from 'zod';

export const createPostSchema = z.object({
  title: z.string().min(1),
  titleEn: z.string().optional(),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be a URL-friendly string'),
  content: z.string().min(1),
  contentEn: z.string().optional(),
  isPublished: z.boolean().optional(),
  allowComments: z.boolean().optional(),
  coverUrl: z.string().url().optional(),
  // Only meaningful once coverUrl is set, but not required even then — an
  // admin can still legitimately mark a cover as purely decorative.
  coverAlt: z.string().optional(),
  topicIds: z.array(z.string().uuid()).optional(),
});

export type CreatePostDto = z.infer<typeof createPostSchema>;
