import { z } from 'zod';

export const OutboxQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});
