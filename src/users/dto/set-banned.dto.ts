import { z } from 'zod';

export const setBannedSchema = z.object({
  isBanned: z.boolean(),
});

export type SetBannedDto = z.infer<typeof setBannedSchema>;
