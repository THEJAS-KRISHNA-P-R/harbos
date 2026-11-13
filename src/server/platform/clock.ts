/**
 * Clock interface for testable time and Asia/Kolkata date rendering.
 * In production, SystemClock uses the real system time.
 * In tests, Clock can be mocked or frozen.
 */
export interface Clock {
  now(): Date;
  nowIso(): string;
  getKolkataDayCode(d?: Date): string; // YYMMDD
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }

  nowIso(): string {
    return new Date().toISOString();
  }

  getKolkataDayCode(d: Date = new Date()): string {
    // Formats date into YYMMDD in 'Asia/Kolkata' (UTC+05:30)
    const formatter = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      year: '2-digit',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(d);
    let yy = '';
    let mm = '';
    let dd = '';
    for (const part of parts) {
      if (part.type === 'year') yy = part.value;
      if (part.type === 'month') mm = part.value;
      if (part.type === 'day') dd = part.value;
    }
    return `${yy}${mm}${dd}`;
  }
}

export const defaultClock: Clock = new SystemClock();
