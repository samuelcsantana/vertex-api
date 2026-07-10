import { z } from 'zod';

export const updateProfileSchema = z.object({
  name: z.string().trim().max(100).optional(),
  displayName: z.string().trim().max(50).optional(),
  // "" clears the avatar (the form always sends a string, never omits).
  avatarUrl: z.union([z.string().url(), z.literal('')]).optional(),
});

export type UpdateProfileDto = z.infer<typeof updateProfileSchema>;
