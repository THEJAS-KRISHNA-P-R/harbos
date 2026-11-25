export interface NormalizedRenderError {
  name: string;
  message: string;
  stackPreview: string | null;
}

const DEFAULT_ERROR_MESSAGE = 'An unexpected rendering error occurred.';

/**
 * Normalizes any thrown value (Error instance, string, or arbitrary object)
 * into a clean, display-safe structure for ErrorBoundary fallbacks.
 */
export function normalizeRenderError(error: unknown): NormalizedRenderError {
  if (error instanceof Error) {
    const cleanName = error.name?.trim() || 'Error';
    const cleanMessage = error.message?.trim() || DEFAULT_ERROR_MESSAGE;
    const stackLines = error.stack
      ? error.stack
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .slice(0, 6)
      : [];
    return {
      name: cleanName,
      message: cleanMessage,
      stackPreview: stackLines.length > 0 ? stackLines.join('\n') : null,
    };
  }

  if (typeof error === 'string') {
    const trimmed = error.trim();
    return {
      name: 'Error',
      message: trimmed || DEFAULT_ERROR_MESSAGE,
      stackPreview: null,
    };
  }

  if (error && typeof error === 'object' && 'message' in error) {
    const candidate = (error as { name?: unknown; message?: unknown }).message;
    const nameCandidate = (error as { name?: unknown }).name;
    const cleanMessage =
      typeof candidate === 'string' && candidate.trim().length > 0
        ? candidate.trim()
        : DEFAULT_ERROR_MESSAGE;
    const cleanName =
      typeof nameCandidate === 'string' && nameCandidate.trim().length > 0
        ? nameCandidate.trim()
        : 'Error';
    return {
      name: cleanName,
      message: cleanMessage,
      stackPreview: null,
    };
  }

  return {
    name: 'Error',
    message: DEFAULT_ERROR_MESSAGE,
    stackPreview: null,
  };
}

/**
 * Shallow-compares two optional resetKeys arrays using Object.is.
 * Returns true whenever length differs or any element changed, allowing
 * ErrorBoundary to auto-recover when the user navigates to another workspace.
 */
export function haveResetKeysChanged(
  prevKeys: ReadonlyArray<unknown> | undefined,
  nextKeys: ReadonlyArray<unknown> | undefined
): boolean {
  if (!prevKeys && !nextKeys) return false;
  if (!prevKeys || !nextKeys) return true;
  if (prevKeys.length !== nextKeys.length) return true;

  for (let i = 0; i < prevKeys.length; i += 1) {
    if (!Object.is(prevKeys[i], nextKeys[i])) {
      return true;
    }
  }
  return false;
}
