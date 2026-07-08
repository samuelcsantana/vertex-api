import { z } from 'zod';

const slugSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be a URL-friendly string');

// The admin form submits "" (not an omitted field) for a slug the author
// left blank — normalize that to undefined so it doesn't fail slugSchema's
// .min(1)/regex and so the DB layer treats it as "no translated slug"
// rather than trying to persist an empty string.
const optionalSlugSchema = z
  .union([slugSchema, z.literal('')])
  .transform((value) => (value === '' ? undefined : value))
  .optional();

export const createPostSchema = z.object({
  title: z.string().min(1),
  titleEn: z.string().optional(),
  titleEs: z.string().optional(),
  slug: slugSchema,
  // Optional: a post without its own en/es slug is served under the
  // default (pt) slug for that locale — see PostsService.findPublishedBySlug.
  slugEn: optionalSlugSchema,
  slugEs: optionalSlugSchema,
  content: z.string().min(1),
  contentEn: z.string().optional(),
  contentEs: z.string().optional(),
  isPublished: z.boolean().optional(),
  allowComments: z.boolean().optional(),
  coverUrl: z.string().url().optional(),
  // Only meaningful once coverUrl is set, but not required even then — an
  // admin can still legitimately mark a cover as purely decorative.
  coverAlt: z.string().optional(),
  // Manually-written search-result snippet — falls back to an auto-
  // generated excerpt of `content` when left blank (frontend concern,
  // see blog/[slug]/page.tsx's generateMetadata). 160 chars matches
  // Google's typical meta description truncation point.
  metaDescription: z.string().max(160).optional(),
  topicIds: z.array(z.string().uuid()).optional(),
});

export type CreatePostDto = z.infer<typeof createPostSchema>;
