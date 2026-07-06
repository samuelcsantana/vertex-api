import { z } from 'zod';

export const createTopicSchema = z.object({
  name: z.string().min(1),
});

export type CreateTopicDto = z.infer<typeof createTopicSchema>;
