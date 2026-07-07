import { z } from 'zod';

export const exchangeSchema = z.object({
  code: z.string().min(1),
});

export type ExchangeDto = z.infer<typeof exchangeSchema>;
