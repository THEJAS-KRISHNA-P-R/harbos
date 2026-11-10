import {
  recordCentralizedLog,
  type ServiceComponentId,
} from '@server/platform/observability.ts';

export type LogLevel = 'info' | 'warn' | 'error';

function writeLog(level: LogLevel, msg: string, meta?: Record<string, unknown>): void {
  const service =
    typeof meta?.service === 'string'
      ? (meta.service as ServiceComponentId)
      : 'harbouros-api';
  const actionCode =
    typeof meta?.actionCode === 'string' ? meta.actionCode : 'SERVER_EVENT';
  const durationMs =
    typeof meta?.durationMs === 'number' ? meta.durationMs : undefined;

  recordCentralizedLog({
    level,
    service,
    actionCode,
    message: msg,
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(meta ? { meta } : {}),
  });

  const entry = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...(meta ?? {}),
  });
  if (level === 'error') {
    console.error(entry);
  } else {
    console.log(entry);
  }
}

export const logger = {
  info: (msg: string, meta?: Record<string, unknown>): void => writeLog('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>): void => writeLog('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>): void => writeLog('error', msg, meta),
};
