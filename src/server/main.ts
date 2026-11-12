import { startServer } from '@server/entry/web.ts';
import { logger } from '@server/platform/logger.ts';

export { startServer };

startServer().catch((err: unknown) => {
  logger.error('Failed to boot HarbourOS server', {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
