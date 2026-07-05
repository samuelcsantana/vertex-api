import { z } from 'zod';

export const createProjectSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  techStack: z.array(z.string()).default([]),
  link: z.string().url().optional(),
});

export type CreateProjectDto = z.infer<typeof createProjectSchema>;
