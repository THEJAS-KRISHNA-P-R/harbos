import React from 'react';
import { OctagonAlert, RotateCcw, RefreshCw } from 'lucide-react';
import {
  haveResetKeysChanged,
  normalizeRenderError,
  type NormalizedRenderError,
} from './error-boundary-utils.ts';

export interface ErrorBoundaryFallbackProps {
  error: Error;
  normalizedError: NormalizedRenderError;
  componentStack: string | null;
  resetErrorBoundary: () => void;
}

export interface ErrorBoundarySecondaryAction {
  label: string;
  onClick: () => void;
}

export interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Optional human-readable context (e.g., active workspace name) */
  contextLabel?: string | undefined;
  /** Headline displayed in the default fallback UI */
  title?: string | undefined;
  /** Supporting message displayed in the default fallback UI */
  description?: string | undefined;
  /** Label for the primary recovery button */
  retryLabel?: string | undefined;
  /** Label for the default reload button when secondaryAction is not provided */
  reloadLabel?: string | undefined;
  /** Label for the collapsible technical details toggle */
  detailsLabel?: string | undefined;
  /** Optional custom fallback element or render function */
  fallback?: React.ReactNode | ((props: ErrorBoundaryFallbackProps) => React.ReactNode) | undefined;
  /** When any value in resetKeys changes, an active error state resets automatically */
  resetKeys?: ReadonlyArray<unknown> | undefined;
  /** Called when the user triggers a reset from the fallback UI (supports async refresh before re-mounting children) */
  onReset?: (() => void | Promise<void>) | undefined;
  /** Called whenever a render error is caught */
  onError?: ((error: Error, errorInfo: React.ErrorInfo) => void) | undefined;
  /** Optional secondary recovery action (defaults to reloading the page) */
  secondaryAction?: ErrorBoundarySecondaryAction | undefined;
  /** Optional test identifier for the fallback container */
  testId?: string | undefined;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  componentStack: string | null;
  resetting: boolean;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  private isMountedFlag = true;

  override state: ErrorBoundaryState = {
    hasError: false,
    error: null,
    componentStack: null,
    resetting: false,
  };

  override componentWillUnmount(): void {
    this.isMountedFlag = false;
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error: error instanceof Error ? error : new Error(String(error)),
      resetting: false,
    };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    const normalized = error instanceof Error ? error : new Error(String(error));
    this.setState({
      componentStack: errorInfo.componentStack?.trim() || null,
    });
    if (this.props.onError) {
      this.props.onError(normalized, errorInfo);
    } else {
      console.error('[ErrorBoundary] Unhandled workspace render error:', normalized, errorInfo);
    }
  }

  override componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (
      this.state.hasError &&
      haveResetKeysChanged(prevProps.resetKeys, this.props.resetKeys)
    ) {
      this.setState({
        hasError: false,
        error: null,
        componentStack: null,
        resetting: false,
      });
    }
  }

  private readonly handleReset = (): void => {
    const clearErrorState = (): void => {
      if (!this.isMountedFlag) return;
      this.setState({
        hasError: false,
        error: null,
        componentStack: null,
        resetting: false,
      });
    };

    if (!this.props.onReset) {
      clearErrorState();
      return;
    }

    const result = this.props.onReset();
    if (result && typeof (result as PromiseLike<void>).then === 'function') {
      this.setState({ resetting: true });
      Promise.resolve(result).finally(clearErrorState);
      return;
    }

    clearErrorState();
  };

  override render(): React.ReactNode {
    const { hasError, error, componentStack, resetting } = this.state;

    if (!hasError || !error) {
      return this.props.children;
    }

    const normalizedError = normalizeRenderError(error);

    if (typeof this.props.fallback === 'function') {
      return this.props.fallback({
        error,
        normalizedError,
        componentStack,
        resetErrorBoundary: this.handleReset,
      });
    }

    if (this.props.fallback !== undefined) {
      return this.props.fallback;
    }

    const {
      contextLabel,
      title = 'Unable to render this view',
      description = 'An unexpected runtime issue interrupted this workspace. Your session and saved harbour records remain safe.',
      retryLabel = 'Try Again',
      reloadLabel = 'Reload Page',
      detailsLabel = 'Technical details',
      secondaryAction,
      testId = 'error-boundary-fallback',
    } = this.props;

    const handleSecondary = (): void => {
      if (secondaryAction) {
        this.setState({ hasError: false, error: null, componentStack: null });
        secondaryAction.onClick();
        return;
      }
      if (typeof window !== 'undefined') {
        window.location.reload();
      }
    };

    const diagnosticBody = [
      `${normalizedError.name}: ${normalizedError.message}`,
      normalizedError.stackPreview,
      componentStack ? `Component stack:${componentStack}` : null,
    ]
      .filter(Boolean)
      .join('\n\n');

    return (
      <section
        role="alert"
        aria-live="assertive"
        data-testid={testId}
        className="w-full max-w-2xl mx-auto my-4 sm:my-8 bg-[var(--bg-surface)] border border-[var(--border-hair)] rounded-[var(--radius-card)] overflow-hidden"
      >
        <div className="p-5 sm:p-6 flex flex-col gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-full bg-[var(--danger-bg)] border border-[var(--danger)]/25 text-[var(--danger-fg)] inline-flex items-center justify-center shrink-0 mt-0.5">
              <OctagonAlert className="w-5 h-5" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1 flex flex-col gap-1">
              {contextLabel && (
                <p className="text-xs font-semibold text-[var(--text-muted)]">
                  {contextLabel}
                </p>
              )}
              <h2 className="text-base sm:text-lg font-bold text-[var(--text-primary)] tracking-tight">
                {title}
              </h2>
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                {description}
              </p>
            </div>
          </div>

          <div className="px-3.5 py-2.5 rounded-[var(--radius-control)] bg-[var(--danger-bg)]/70 border border-[var(--danger)]/25 text-xs text-[var(--danger-fg)] font-mono-code break-words">
            <span className="font-bold">{normalizedError.name}:</span> {normalizedError.message}
          </div>

          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <button
              type="button"
              disabled={resetting}
              onClick={this.handleReset}
              className="h-10 px-4 rounded-[var(--radius-pill)] bg-[var(--brand)] text-[var(--brand-fg)] border border-[var(--brand)] hover:bg-[var(--brand-hover)] hover:border-[var(--brand-hover)] text-sm font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-wait"
            >
              <RotateCcw
                className={`w-4 h-4 shrink-0 ${resetting ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>{retryLabel}</span>
            </button>

            <button
              type="button"
              onClick={handleSecondary}
              className="h-10 px-4 rounded-[var(--radius-pill)] bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-strong)] hover:bg-[var(--bg-tint)] text-sm font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors cursor-pointer"
            >
              <RefreshCw className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{secondaryAction?.label ?? reloadLabel}</span>
            </button>
          </div>
        </div>

        <footer className="px-5 sm:px-6 py-3 bg-[var(--bg-sunken)] border-t border-[var(--border-hair)]">
          <details className="text-xs text-[var(--text-secondary)]">
            <summary className="cursor-pointer font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] select-none">
              {detailsLabel}
            </summary>
            <pre className="mt-2.5 p-3 rounded-[var(--radius-control)] bg-[var(--bg-surface)] border border-[var(--border-hair)] text-[11px] leading-relaxed text-[var(--text-secondary)] font-mono-code overflow-x-auto whitespace-pre-wrap break-words max-h-48">
              {diagnosticBody}
            </pre>
          </details>
        </footer>
      </section>
    );
  }
}
