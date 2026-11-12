import { z } from 'zod';

export const SyncCommandsBodySchema = z.object({
  commands: z.array(z.record(z.string(), z.unknown())).optional(),
});
