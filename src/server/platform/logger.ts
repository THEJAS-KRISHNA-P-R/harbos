export type LogLevel = 'info' | 'warn' | 'error';

function writeLog(level: LogLevel, msg: string, meta?: Record<string, unknown>): void {
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
