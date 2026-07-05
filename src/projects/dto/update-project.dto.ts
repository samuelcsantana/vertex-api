import { z } from 'zod';
import { createProjectSchema } from './create-project.dto';

export const updateProjectSchema = createProjectSchema
  .extend({ techStack: z.array(z.string()) })
  .partial();

export type UpdateProjectDto = z.infer<typeof updateProjectSchema>;
