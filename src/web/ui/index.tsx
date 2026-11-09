import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CheckCircle2,
  AlertTriangle,
  OctagonAlert,
  Info,
  X,
  Inbox,
  Loader2,
  Wifi,
  WifiOff,
  Delete,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
} from 'lucide-react';
import {
  HarbourCrestIcon,
  DockScaleIcon,
  AuctionGavelBellIcon,
  BuyerCrateEscrowIcon,
  FisherVesselPassbookIcon,
  ThermometerFishGradeIcon,
  HarbourLedgerVaultIcon,
  StatutorySealIcon,
  PelagicFishIcon,
  TrawlerVesselIcon,
  type CustomIconProps,
} from './custom-icons.tsx';
import {
  MaritimeCrestSvgEmblem,
  HarbourQuayDawnSvgDecor,
  DocksideWeighingScaleSvgDecor,
  AuctionPitAmphitheatreSvgDecor,
  StatutoryLedgerWaterfallSvgDecor,
  ColdChainInspectorSvgDecor,
  type SvgDecorProps,
} from './svg-decor.tsx';

export {
  HarbourCrestIcon,
  DockScaleIcon,
  AuctionGavelBellIcon,
  BuyerCrateEscrowIcon,
  FisherVesselPassbookIcon,
  ThermometerFishGradeIcon,
  HarbourLedgerVaultIcon,
  StatutorySealIcon,
  PelagicFishIcon,
  TrawlerVesselIcon,
  type CustomIconProps,
  MaritimeCrestSvgEmblem,
  HarbourQuayDawnSvgDecor,
  DocksideWeighingScaleSvgDecor,
  AuctionPitAmphitheatreSvgDecor,
  StatutoryLedgerWaterfallSvgDecor,
  ColdChainInspectorSvgDecor,
  type SvgDecorProps,
};

/* ============================================================================
 * 1. Button & IconButton (§11.2 — Clean Rounded Pill Geometry: --radius-pill)
 * ============================================================================ */
export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'dock';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  children,
  className = '',
  disabled,
  type = 'button',
  ...rest
}) => {
  const sizeClasses: Record<ButtonSize, string> = {
    sm: 'h-9 px-3 text-xs rounded-[var(--radius-pill)]',
    md: 'h-10 px-5 text-sm rounded-[var(--radius-pill)]',
    dock: 'min-h-[64px] px-6 text-base rounded-[var(--radius-pill)]',
  };

  const variantClasses: Record<ButtonVariant, string> = {
    primary:
      'bg-[var(--brand)] text-[var(--brand-fg)] border border-[var(--brand)] hover:bg-[var(--brand-hover)] hover:border-[var(--brand-hover)]',
    secondary:
      'bg-[var(--brand-soft)] text-[var(--brand-soft-fg)] border border-[var(--border-strong)]/30 hover:bg-[var(--navy-200)]',
    outline:
      'bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-strong)] hover:bg-[var(--bg-tint)]',
    danger:
      'bg-[var(--danger)] text-[var(--brand-fg)] border border-[var(--danger)] hover:opacity-90',
    ghost:
      'bg-transparent text-[var(--text-secondary)] border border-transparent hover:bg-[var(--brand-soft)] hover:text-[var(--brand-soft-fg)]',
  };

  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 font-semibold whitespace-nowrap transition-all duration-[160ms] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${sizeClasses[size]} ${variantClasses[variant]} ${className}`}
      {...rest}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden="true" /> : icon}
      <span>{children}</span>
    </button>
  );
};

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  icon: React.ReactNode;
  variant?: ButtonVariant;
}

export const IconButton: React.FC<IconButtonProps> = ({
  label,
  icon,
  variant = 'outline',
  className = '',
  type = 'button',
  ...rest
}) => {
  const variantClasses: Record<ButtonVariant, string> = {
    primary: 'bg-[var(--brand)] text-[var(--brand-fg)] border border-[var(--brand)]',
    secondary: 'bg-[var(--brand-soft)] text-[var(--brand-soft-fg)] border border-transparent',
    outline: 'bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-strong)] hover:bg-[var(--bg-tint)]',
    danger: 'bg-[var(--danger-bg)] text-[var(--danger-fg)] border border-[var(--danger)]',
    ghost: 'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--brand-soft)]',
  };

  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={`w-10 h-10 rounded-[var(--radius-pill)] inline-flex items-center justify-center transition-colors cursor-pointer ${variantClasses[variant]} ${className}`}
      {...rest}
    >
      {icon}
    </button>
  );
};

/* ============================================================================
 * 2. Input, NumberInput, Select, Checkbox (--radius-control: 10px, --border-strong)
 * ============================================================================ */
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
  mono?: boolean;
  dockSize?: boolean;
}

export const Input: React.FC<InputProps> = ({
  label,
  hint,
  error,
  mono = false,
  dockSize = false,
  id,
  className = '',
  ...rest
}) => {
  const inputId = id ?? `input-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const heightClass = dockSize ? 'min-h-[64px] text-base px-4' : 'h-10 text-sm px-3.5';

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={inputId}
        className="text-xs font-semibold text-[var(--text-secondary)] tracking-wide"
      >
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
        className={`w-full rounded-[var(--radius-control)] bg-[var(--bg-surface)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] border transition-colors ${
          error ? 'border-[var(--danger)]' : 'border-[var(--border-strong)]'
        } ${heightClass} ${mono ? 'font-mono-code tabular-nums' : ''} ${className}`}
        {...rest}
      />
      {error ? (
        <p id={`${inputId}-error`} className="text-xs font-medium text-[var(--danger-fg)]" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="text-xs text-[var(--text-muted)]">
          {hint}
        </p>
      ) : null}
    </div>
  );
};

export const NumberInput: React.FC<InputProps> = (props) => (
  <Input type="number" mono {...props} />
);

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  options: ReadonlyArray<SelectOption>;
  dockSize?: boolean | undefined;
  pill?: boolean | undefined;
}

export const Select: React.FC<SelectProps> = ({
  label,
  options,
  dockSize = false,
  pill = false,
  id,
  className = '',
  ...rest
}) => {
  const selectId = id ?? `select-${(label || 'control').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const heightClass = dockSize ? 'min-h-[64px] text-base px-4' : 'h-9 text-[13px] font-semibold px-3.5';
  const radiusClass = pill ? 'rounded-[var(--radius-pill)]' : 'rounded-[var(--radius-control)]';

  return (
    <div className="flex flex-col gap-1.5">
      {label ? (
        <label
          htmlFor={selectId}
          className="text-xs font-semibold text-[var(--text-secondary)] tracking-wide"
        >
          {label}
        </label>
      ) : null}
      <select
        id={selectId}
        className={`w-full ${radiusClass} bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-strong)] ${heightClass} ${className}`}
        {...rest}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
};

export interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

export const Checkbox: React.FC<CheckboxProps> = ({ label, id, ...rest }) => {
  const cbId = id ?? `cb-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <label htmlFor={cbId} className="inline-flex items-center gap-2.5 cursor-pointer select-none">
      <input
        id={cbId}
        type="checkbox"
        className="w-4 h-4 rounded-[4px] border border-[var(--border-strong)] accent-[var(--brand)]"
        {...rest}
      />
      <span className="text-sm text-[var(--text-primary)] font-medium">{label}</span>
    </label>
  );
};

/* ============================================================================
 * 3. Card (§11.2 — --bg-surface, 1px --border-hair, 16px radius, flat, rich hierarchy)
 * ============================================================================ */
export interface CardProps {
  title?: string;
  subtitle?: string;
  kicker?: string;
  stepBadge?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  sunkenFooter?: React.ReactNode;
}

export const Card: React.FC<CardProps> = ({
  title,
  subtitle,
  actions,
  children,
  className = '',
  sunkenFooter,
}) => {
  return (
    <section
      className={`bg-[var(--bg-surface)] border border-[var(--border-hair)] rounded-[var(--radius-card)] overflow-hidden transition-colors ${className}`}
    >
      {(title || actions) && (
        <header className="px-5 py-3.5 bg-[var(--bg-surface)] border-b border-[var(--border-hair)] flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            {title && (
              <h3 className="text-[15px] leading-5 font-bold text-[var(--text-primary)] tracking-tight truncate">
                {title}
              </h3>
            )}
            {subtitle && (
              <p className="text-xs text-[var(--text-secondary)] mt-0.5 truncate">{subtitle}</p>
            )}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
        </header>
      )}
      <div className="p-4 sm:p-5">{children}</div>
      {sunkenFooter && (
        <footer className="px-5 py-3 bg-[var(--bg-sunken)] border-t border-[var(--border-hair)] text-xs text-[var(--text-secondary)]">
          {sunkenFooter}
        </footer>
      )}
    </section>
  );
};

/* ============================================================================
 * 4. Badge / StatusPill (§11.1 — Pill shape, icon + text, zero green, never stacks)
 * ============================================================================ */
export type BadgeTone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral';

export interface BadgeProps {
  tone?: BadgeTone | undefined;
  label: string;
  code?: string | undefined;
  className?: string | undefined;
}

export const Badge: React.FC<BadgeProps> = ({
  tone = 'info',
  label,
  code,
  className = '',
}) => {
  const toneConfig: Record<BadgeTone, { style: string; icon: React.ReactNode }> = {
    ok: {
      style: 'bg-[var(--brand-soft)] text-[var(--brand-soft-fg)] border-[var(--navy-200)]',
      icon: <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
    },
    warn: {
      style: 'bg-[var(--warning-bg)] text-[var(--warning)] border-[var(--warning)]/30',
      icon: <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
    },
    danger: {
      style: 'bg-[var(--danger-bg)] text-[var(--danger-fg)] border-[var(--danger)]/30',
      icon: <OctagonAlert className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
    },
    info: {
      style: 'bg-[var(--info-bg)] text-[var(--info)] border-[var(--info)]/30',
      icon: <Info className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
    },
    neutral: {
      style: 'bg-[var(--bg-sunken)] text-[var(--text-secondary)] border-[var(--border-strong)]/40',
      icon: <Info className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
    },
  };

  const current = toneConfig[tone];

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-[var(--radius-pill)] border text-xs leading-none font-semibold tabular-nums whitespace-nowrap shrink-0 ${current.style} ${className}`}
    >
      {current.icon}
      <span className="whitespace-nowrap">{label}</span>
      {code && <span className="font-mono-code opacity-85 whitespace-nowrap">({code})</span>}
    </span>
  );
};

export const StatusPill = Badge;

/* ============================================================================
 * 5. Metric (Bento Metric Card — 28px/32px tabular-nums, 16px radius, hierarchy)
 * ============================================================================ */
export interface MetricProps {
  label: string;
  value: string;
  unit?: string;
  sublabel?: string;
  formulaCue?: string;
  featured?: boolean;
  icon?: React.ReactNode;
  status?: { tone: BadgeTone; label: string };
  action?: React.ReactNode;
}

export const Metric: React.FC<MetricProps> = ({
  label,
  value,
  unit,
  sublabel,
  featured = false,
  status,
  action,
}) => {
  return (
    <div
      className={`rounded-[var(--radius-card)] p-4 sm:p-5 flex flex-col justify-between gap-2 border transition-colors ${
        featured
          ? 'bg-[var(--brand-soft)]/50 border-[var(--navy-200)]'
          : 'bg-[var(--bg-surface)] border-[var(--border-hair)]'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-[var(--text-secondary)] truncate">
          {label}
        </span>
        {status && <Badge tone={status.tone} label={status.label} className="shrink-0" />}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl font-bold text-[var(--text-primary)] font-mono-code tabular-nums tracking-tight">
          {value}
        </span>
        {unit && (
          <span className="text-xs font-semibold text-[var(--text-muted)] font-mono-code">
            {unit}
          </span>
        )}
      </div>
      {(sublabel || action) && (
        <div className="flex items-center justify-between gap-2 pt-1">
          {sublabel && (
            <p className="text-xs text-[var(--text-muted)] truncate">{sublabel}</p>
          )}
          {action}
        </div>
      )}
    </div>
  );
};

/* ============================================================================
 * 5b. WorkflowStepStrip (Interactive Visual Cue Bar for Multi-Step Harbour Flows)
 * ============================================================================ */
export interface WorkflowStepItem {
  step: string;
  title: string;
  detail: string;
  active?: boolean;
  done?: boolean;
  badge?: string;
  onClick?: () => void;
}

export const WorkflowStepStrip: React.FC<{
  steps: ReadonlyArray<WorkflowStepItem>;
}> = ({ steps }) => {
  return (
    <div
      aria-label="Operational Workflow Steps"
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
    >
      {steps.map((item) => {
        const isInteractive = Boolean(item.onClick);
        const Tag = isInteractive ? 'button' : 'div';
        return (
          <Tag
            key={item.step}
            {...(isInteractive ? { type: 'button' as const, onClick: item.onClick } : {})}
            className={`p-4 rounded-[var(--radius-card)] border text-left flex flex-col justify-between gap-2 transition-all ${
              item.active
                ? 'bg-[var(--brand-soft)] border-[var(--brand)] ring-1 ring-[var(--brand)]'
                : 'bg-[var(--bg-surface)] border-[var(--border-hair)] hover:border-[var(--border-strong)]'
            } ${isInteractive ? 'cursor-pointer' : ''}`}
          >
            <div className="flex items-center justify-between gap-2 w-full">
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-[var(--radius-pill)] text-[11px] font-bold font-mono-code uppercase whitespace-nowrap shrink-0 ${
                  item.active
                    ? 'bg-[var(--brand)] text-[var(--brand-fg)]'
                    : item.done
                    ? 'bg-[var(--brand-soft)] text-[var(--brand-soft-fg)]'
                    : 'bg-[var(--bg-sunken)] text-[var(--text-secondary)]'
                }`}
              >
                {item.step}
              </span>
              {item.badge ? (
                <span className="text-[11px] font-mono-code font-semibold text-[var(--text-muted)] whitespace-nowrap shrink-0">
                  {item.badge}
                </span>
              ) : item.done ? (
                <CheckCircle2 className="w-4 h-4 text-[var(--brand)] shrink-0" aria-hidden="true" />
              ) : null}
            </div>
            <div>
              <div className="text-sm font-bold text-[var(--text-primary)]">{item.title}</div>
              <div className="text-xs text-[var(--text-secondary)] mt-0.5">{item.detail}</div>
            </div>
          </Tag>
        );
      })}
    </div>
  );
};

/* ============================================================================
 * 6. DataTable (Sticky header on --bg-sunken, row actions, empty/loading/error)
 * ============================================================================ */
export interface DataTableColumn<T> {
  key: string;
  header: string;
  align?: 'left' | 'right';
  mono?: boolean;
  render: (row: T) => React.ReactNode;
}

export interface DataTableProps<T> {
  caption?: string;
  columns: ReadonlyArray<DataTableColumn<T>>;
  rows: ReadonlyArray<T>;
  getRowKey: (row: T) => string;
  loading?: boolean;
  error?: string | null;
  emptyTitle?: string;
  emptyDescription?: string;
  onRowClick?: (row: T) => void;
}

export function DataTable<T>({
  caption,
  columns,
  rows,
  getRowKey,
  loading = false,
  error = null,
  emptyTitle = 'No statutory records found',
  emptyDescription = 'Adjust the active filter criteria or record a new harbour transaction.',
  onRowClick,
}: DataTableProps<T>): React.ReactElement {
  if (error) {
    return (
      <div
        role="alert"
        className="p-4 rounded-[var(--radius-card)] bg-[var(--danger-bg)] border border-[var(--danger)] text-[var(--danger-fg)] flex items-center gap-3"
      >
        <OctagonAlert className="w-5 h-5 shrink-0" aria-hidden="true" />
        <div className="text-sm font-medium">{error}</div>
      </div>
    );
  }

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border-hair)] rounded-[var(--radius-card)] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr className="bg-[var(--bg-sunken)] border-b border-[var(--border-hair)]">
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={`px-4 py-3 text-[11px] leading-4 font-semibold uppercase tracking-[0.05em] text-[var(--text-secondary)] ${
                    col.align === 'right' ? 'text-right' : 'text-left'
                  }`}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-hair)]">
            {loading ? (
              Array.from({ length: 3 }).map((_, idx) => (
                <tr key={`skeleton-${idx}`} aria-busy="true">
                  {columns.map((col) => (
                    <td key={col.key} className="px-4 py-3.5">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="p-8">
                  <EmptyState title={emptyTitle} description={emptyDescription} />
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={getRowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={`transition-colors hover:bg-[var(--bg-tint)] ${
                    onRowClick ? 'cursor-pointer' : ''
                  }`}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={`px-4 py-3.5 text-sm leading-5 text-[var(--text-primary)] tabular-nums ${
                        col.align === 'right' ? 'text-right' : 'text-left'
                      } ${col.mono ? 'font-mono-code text-[13px]' : ''}`}
                    >
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ============================================================================
 * 7. Drawer (Right, 560px, Portaled to document.body, --shadow-overlay)
 * ============================================================================ */
export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export const Drawer: React.FC<DrawerProps> = ({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
}) => {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex justify-end bg-[var(--scrim)]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="drawer-title"
    >
      <div className="fixed inset-0" onClick={onClose} aria-hidden="true" />
      <aside className="relative z-10 w-full max-w-[560px] h-full bg-[var(--bg-surface)] border-l border-[var(--border-hair)] shadow-[var(--shadow-overlay)] flex flex-col justify-between overflow-hidden">
        <header className="px-4 sm:px-6 py-4 sm:py-5 bg-[var(--bg-sunken)] border-b border-[var(--border-hair)] flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2
              id="drawer-title"
              className="text-base sm:text-lg font-semibold text-[var(--text-primary)] tracking-tight"
            >
              {title}
            </h2>
            {subtitle && (
              <p className="text-xs sm:text-sm text-[var(--text-secondary)] mt-0.5">{subtitle}</p>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            aria-label="Close drawer"
            icon={<X className="w-4 h-4" />}
          >
            Close
          </Button>
        </header>
        <div className="p-4 sm:p-6 overflow-y-auto flex-1">{children}</div>
        {footer && (
          <footer className="px-4 sm:px-6 py-3.5 sm:py-4 bg-[var(--bg-sunken)] border-t border-[var(--border-hair)] flex flex-wrap items-center justify-end gap-2 sm:gap-3">
            {footer}
          </footer>
        )}
      </aside>
    </div>,
    document.body
  );
};

/* ============================================================================
 * 8. Modal (Portaled to document.body, 16px radius, --shadow-overlay)
 * ============================================================================ */
export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}) => {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--scrim)]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div className="fixed inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative z-10 w-full max-w-xl bg-[var(--bg-surface)] border border-[var(--border-strong)] rounded-[var(--radius-card)] shadow-[var(--shadow-overlay)] overflow-hidden">
        <header className="px-6 py-5 bg-[var(--bg-sunken)] border-b border-[var(--border-hair)] flex items-start justify-between gap-4">
          <div>
            <h2
              id="modal-title"
              className="text-lg font-semibold text-[var(--text-primary)] tracking-tight"
            >
              {title}
            </h2>
            {description && (
              <p className="text-sm text-[var(--text-secondary)] mt-0.5">{description}</p>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            aria-label="Close modal"
            icon={<X className="w-4 h-4" />}
          >
            Close
          </Button>
        </header>
        <div className="p-6">{children}</div>
        {footer && (
          <footer className="px-6 py-4 bg-[var(--bg-sunken)] border-t border-[var(--border-hair)] flex items-center justify-end gap-3">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body
  );
};

/* ============================================================================
 * 9. Toast (aria-live="polite", non-green semantic tones)
 * ============================================================================ */
export interface ToastProps {
  tone?: 'ok' | 'warn' | 'danger' | 'info';
  title: string;
  message?: string;
  onDismiss?: () => void;
}

export const Toast: React.FC<ToastProps> = ({
  tone = 'info',
  title,
  message,
  onDismiss,
}) => {
  const toneStyles: Record<'ok' | 'warn' | 'danger' | 'info', string> = {
    ok: 'bg-[var(--brand-soft)] text-[var(--brand-soft-fg)] border-[var(--navy-200)]',
    warn: 'bg-[var(--warning-bg)] text-[var(--warning)] border-[var(--warning)]/40',
    danger: 'bg-[var(--danger-bg)] text-[var(--danger-fg)] border-[var(--danger)]/40',
    info: 'bg-[var(--info-bg)] text-[var(--info)] border-[var(--info)]/40',
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className={`px-5 py-3.5 rounded-[var(--radius-card)] border flex items-start justify-between gap-3 ${toneStyles[tone]}`}
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-bold uppercase tracking-wide">{title}</span>
        {message && <p className="text-sm">{message}</p>}
      </div>
      {onDismiss && (
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      )}
    </div>
  );
};

/* ============================================================================
 * 10. Tabs, Skeleton, EmptyState
 * ============================================================================ */
export interface TabItem {
  id: string;
  label: string;
  badge?: string | number;
}

export interface TabsProps {
  items: ReadonlyArray<TabItem>;
  activeId: string;
  onChange: (id: string) => void;
}

export const Tabs: React.FC<TabsProps> = ({ items, activeId, onChange }) => {
  return (
    <div
      role="tablist"
      className="inline-flex items-center gap-1.5 p-1.5 rounded-[var(--radius-pill)] bg-[var(--bg-sunken)] border border-[var(--border-hair)] overflow-x-auto max-w-full"
    >
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <button
            key={item.id}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(item.id)}
            className={`min-h-[36px] py-1.5 px-3.5 sm:px-4 rounded-[var(--radius-pill)] text-xs sm:text-sm font-semibold whitespace-nowrap shrink-0 transition-all cursor-pointer inline-flex items-center gap-2 ${
              active
                ? 'bg-[var(--brand)] text-[var(--brand-fg)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]/60'
            }`}
          >
            <span className="whitespace-nowrap">{item.label}</span>
            {item.badge !== undefined && (
              <span
                className={`px-2 py-0.5 text-xs rounded-[var(--radius-pill)] font-mono-code whitespace-nowrap shrink-0 leading-none ${
                  active
                    ? 'bg-[var(--brand-hover)] text-[var(--brand-fg)]'
                    : 'bg-[var(--brand-soft)] text-[var(--brand-soft-fg)]'
                }`}
              >
                {item.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

export const Skeleton: React.FC<{ className?: string }> = ({ className = 'h-4 w-full' }) => (
  <div className={`rounded-[var(--radius-control)] bg-[var(--bg-sunken)] animate-pulse ${className}`} />
);

export interface EmptyStateProps {
  title: string;
  description: string;
  action?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  action,
}) => {
  return (
    <div className="p-8 rounded-[var(--radius-card)] bg-[var(--bg-sunken)] border border-[var(--border-hair)] flex flex-col items-center text-center gap-2.5">
      <Inbox className="w-7 h-7 text-[var(--text-muted)]" aria-hidden="true" />
      <h4 className="text-base font-semibold text-[var(--text-primary)]">{title}</h4>
      <p className="text-sm text-[var(--text-secondary)] max-w-md">{description}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
};

/* ============================================================================
 * 11. Keypad (Pit Auctioneer Numeric Keypad — >= 64px touch targets)
 * ============================================================================ */
export interface KeypadProps {
  value: string;
  onChange: (nextVal: string) => void;
  onQuickIncrement?: (deltaRupees: number) => void;
  label?: string;
}

export const Keypad: React.FC<KeypadProps> = ({
  value,
  onChange,
  onQuickIncrement,
  label = 'Bid Price (₹ / kg)',
}) => {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'BACK'] as const;

  const handleKey = (k: (typeof keys)[number]): void => {
    if (k === 'C') {
      onChange('0');
      return;
    }
    if (k === 'BACK') {
      onChange(value.length > 1 ? value.slice(0, -1) : '0');
      return;
    }
    const next = value === '0' ? k : `${value}${k}`;
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="p-4 rounded-[var(--radius-card)] bg-[var(--bg-sunken)] border border-[var(--border-strong)] flex items-baseline justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          {label}
        </span>
        <span className="text-3xl font-bold font-mono-code tabular-nums text-[var(--text-primary)]">
          ₹{Number(value || '0').toLocaleString('en-IN')}/kg
        </span>
      </div>

      {onQuickIncrement && (
        <div className="grid grid-cols-4 gap-2">
          {[5, 10, 25, 50].map((inc) => (
            <Button
              key={inc}
              variant="secondary"
              size="sm"
              onClick={() => onQuickIncrement(inc)}
              className="w-full font-mono-code"
            >
              +₹{inc}
            </Button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        {keys.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => handleKey(k)}
            className="min-h-[64px] rounded-[var(--radius-card)] bg-[var(--bg-surface)] border border-[var(--border-strong)] hover:bg-[var(--brand-soft)] text-xl font-bold font-mono-code text-[var(--text-primary)] flex items-center justify-center cursor-pointer transition-colors"
          >
            {k === 'BACK' ? <Delete className="w-5 h-5" /> : k}
          </button>
        ))}
      </div>
    </div>
  );
};

/* ============================================================================
 * 12. SpeciesTile (Weighing Workspace Species Selector — Malayalam + English)
 * ============================================================================ */
export interface SpeciesTileProps {
  code: string;
  nameEn: string;
  nameMl: string;
  floorPriceFormatted: string;
  selected: boolean;
  onSelect: () => void;
}

export const SpeciesTile: React.FC<SpeciesTileProps> = ({
  code,
  nameEn,
  nameMl,
  floorPriceFormatted,
  selected,
  onSelect,
}) => {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`min-h-[84px] p-4 rounded-[var(--radius-card)] border text-left transition-all cursor-pointer flex flex-col justify-between gap-2 ${
        selected
          ? 'bg-[var(--brand-soft)] border-[var(--brand)] ring-2 ring-[var(--brand)]'
          : 'bg-[var(--bg-surface)] border-[var(--border-strong)] hover:bg-[var(--bg-tint)]'
      }`}
    >
      <div className="flex items-center justify-between gap-2 w-full">
        <span className="inline-flex items-center gap-1.5 text-xs font-bold font-mono-code uppercase px-2.5 py-0.5 rounded-[var(--radius-pill)] bg-[var(--bg-sunken)] text-[var(--text-secondary)]">
          <PelagicFishIcon size={14} className="text-[var(--brand)] shrink-0" />
          <span>{code}</span>
        </span>
        <span className="text-xs font-mono-code font-semibold text-[var(--text-secondary)]">
          Floor: {floorPriceFormatted}/kg
        </span>
      </div>
      <div>
        <div className="text-base font-bold text-[var(--text-primary)]">{nameEn}</div>
        <div lang="ml" className="text-sm font-medium text-[var(--text-secondary)] mt-0.5">
          {nameMl}
        </div>
      </div>
    </button>
  );
};

/* ============================================================================
 * 13. ConnectivityBadge (Online / Offline + Queue Count)
 * ============================================================================ */
export interface ConnectivityBadgeProps {
  online: boolean;
  queuedCount: number;
  onToggleSimulateOffline?: () => void;
}

export const ConnectivityBadge: React.FC<ConnectivityBadgeProps> = ({
  online,
  queuedCount,
  onToggleSimulateOffline,
}) => {
  return (
    <div className="inline-flex items-center gap-2" aria-live="polite">
      <button
        type="button"
        onClick={onToggleSimulateOffline}
        title="Click to toggle offline queue simulation"
        className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-[var(--radius-pill)] border text-xs font-semibold cursor-pointer ${
          online
            ? 'bg-[var(--brand-soft)] text-[var(--brand-soft-fg)] border-[var(--navy-200)]'
            : 'bg-[var(--warning-bg)] text-[var(--warning)] border-[var(--warning)]/40'
        }`}
      >
        {online ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
        <span>{online ? 'ONLINE (SSE)' : 'OFFLINE QUEUE MODE'}</span>
        {queuedCount > 0 && (
          <span className="px-2 py-0.5 rounded-[var(--radius-pill)] bg-[var(--brand)] text-[var(--brand-fg)] font-mono-code">
            {queuedCount} queued
          </span>
        )}
      </button>
    </div>
  );
};

/* ============================================================================
 * 14. AppShell (Desktop 240px Sidebar on --bg-sunken, Active Pill --brand-soft)
 *     & DocksideShell (Mobile/Tablet Dockside Layout with >=64px touch targets)
 * ============================================================================ */
export interface NavItem {
  id: string;
  labelEn: string;
  labelMl: string;
  icon: React.ReactNode;
  badge?: string | undefined;
  group?: 'operations' | 'clearing' | 'governance' | undefined;
}

export interface OperatorCardSummary {
  initials: string;
  fullName: string;
  roleBadge: string;
  phoneE164: string;
  onOpenProfile: () => void;
}

export interface ShellLayoutProps {
  brandSubtitle: string;
  navItems: ReadonlyArray<NavItem>;
  activeNavId: string;
  onSelectNav: (id: string) => void;
  lang: 'en' | 'ml';
  headerRight: React.ReactNode;
  operatorCard?: OperatorCardSummary | undefined;
  children: React.ReactNode;
}

export const AppShell: React.FC<ShellLayoutProps> = ({
  brandSubtitle,
  navItems,
  activeNavId,
  onSelectNav,
  lang,
  headerRight,
  operatorCard,
  children,
}) => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth >= 768 && window.innerWidth < 1100;
    }
    return false;
  });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const navGroups: ReadonlyArray<{
    id: 'operations' | 'clearing' | 'governance';
    title: string;
  }> = [
    { id: 'operations', title: 'Dockside & Pit' },
    { id: 'clearing', title: 'Clearing & Passbooks' },
    { id: 'governance', title: 'Governance & Engine' },
  ];

  const activeItem = navItems.find((n) => n.id === activeNavId);

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-[var(--bg-app)] text-[var(--text-primary)] overflow-x-hidden">
      {/* Mobile Slide-Over Navigation Drawer (< 768px) */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-50 md:hidden flex bg-[var(--scrim)]"
          role="dialog"
          aria-modal="true"
          aria-label="Mobile Navigation Menu"
        >
          <div
            className="fixed inset-0"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative z-10 w-[280px] max-w-[85vw] h-full bg-[var(--bg-sunken)] border-r border-[var(--border-hair)] p-4 flex flex-col justify-between overflow-y-auto">
            <div className="flex flex-col gap-5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <MaritimeCrestSvgEmblem size={36} />
                  <div className="min-w-0">
                    <div className="text-base font-bold text-[var(--text-primary)] truncate">
                      HarbourOS
                    </div>
                    <div className="text-[11px] font-medium text-[var(--text-muted)] truncate">
                      {brandSubtitle}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileNavOpen(false)}
                  aria-label="Close mobile menu"
                  className="w-8 h-8 rounded-[var(--radius-pill)] bg-[var(--bg-surface)] border border-[var(--border-strong)] inline-flex items-center justify-center text-[var(--text-secondary)] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <nav className="flex flex-col gap-4" aria-label="Mobile Grouped Navigation">
                {navGroups.map((grp) => {
                  const groupItems = navItems.filter(
                    (item) => (item.group ?? 'operations') === grp.id
                  );
                  if (groupItems.length === 0) return null;
                  return (
                    <div key={grp.id} className="flex flex-col gap-1">
                      <div className="px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                        {grp.title}
                      </div>
                      {groupItems.map((item) => {
                        const active = item.id === activeNavId;
                        const labelText = lang === 'ml' ? item.labelMl : item.labelEn;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => {
                              onSelectNav(item.id);
                              setMobileNavOpen(false);
                            }}
                            className={`h-10 w-full px-3.5 rounded-[var(--radius-pill)] flex items-center justify-between gap-2.5 text-left text-sm cursor-pointer ${
                              active
                                ? 'bg-[var(--brand)] text-[var(--brand-fg)] font-semibold'
                                : 'text-[var(--text-secondary)] font-medium hover:bg-[var(--bg-surface)]/80'
                            }`}
                          >
                            <span className="flex items-center gap-2.5 truncate">
                              <span className="shrink-0">{item.icon}</span>
                              <span className="truncate">{labelText}</span>
                            </span>
                            {item.badge && (
                              <span
                                className={`text-[11px] font-mono-code px-2 py-0.5 rounded-[var(--radius-pill)] whitespace-nowrap shrink-0 ${
                                  active
                                    ? 'bg-[var(--brand-hover)] text-[var(--brand-fg)]'
                                    : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-hair)]'
                                }`}
                              >
                                {item.badge}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </nav>
            </div>

            {operatorCard && (
              <div className="pt-3 border-t border-[var(--border-hair)]">
                <button
                  type="button"
                  onClick={() => {
                    setMobileNavOpen(false);
                    operatorCard.onOpenProfile();
                  }}
                  className="p-3 w-full rounded-[var(--radius-card)] bg-[var(--bg-surface)] border border-[var(--border-strong)]/60 flex items-center gap-3 text-left cursor-pointer"
                >
                  <span className="w-8 h-8 rounded-[var(--radius-pill)] bg-[var(--brand)] text-[var(--brand-fg)] text-xs font-bold font-mono-code inline-flex items-center justify-center shrink-0">
                    {operatorCard.initials}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-[var(--text-primary)] truncate">
                      {operatorCard.fullName}
                    </div>
                    <div className="text-[11px] font-medium text-[var(--brand)] truncate">
                      {operatorCard.roleBadge} · Profile
                    </div>
                  </div>
                </button>
              </div>
            )}
          </aside>
        </div>
      )}

      {/* Collapsible Left Sidebar on Tablet (md: 768px+) & MacBook/Desktop (lg/xl/2xl) */}
      <aside
        aria-label="Primary Sidebar"
        className={`hidden md:flex shrink-0 bg-[var(--bg-sunken)] border-r border-[var(--border-hair)] flex-col justify-between sticky top-0 h-screen transition-all duration-200 no-print ${
          sidebarCollapsed ? 'w-[76px] p-3 items-center' : 'w-[252px] xl:w-[268px] p-4'
        }`}
      >
        <div className="flex flex-col gap-5 w-full overflow-y-auto">
          <div
            className={`pt-1 flex items-center ${
              sidebarCollapsed ? 'flex-col gap-2.5 justify-center' : 'px-2 justify-between gap-2'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <MaritimeCrestSvgEmblem size={36} />
              {!sidebarCollapsed && (
                <div className="min-w-0">
                  <div className="text-base font-bold tracking-tight text-[var(--text-primary)] truncate">
                    HarbourOS
                  </div>
                  <div className="text-[11px] font-medium text-[var(--text-muted)] truncate">
                    {brandSubtitle}
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setSidebarCollapsed((prev) => !prev)}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="w-8 h-8 shrink-0 rounded-[var(--radius-pill)] bg-[var(--bg-surface)] border border-[var(--border-strong)] text-[var(--text-secondary)] hover:bg-[var(--brand-soft)] hover:text-[var(--brand-soft-fg)] inline-flex items-center justify-center transition-colors cursor-pointer"
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen className="w-4 h-4" />
              ) : (
                <PanelLeftClose className="w-4 h-4" />
              )}
            </button>
          </div>

          <nav className="flex flex-col gap-4 w-full" aria-label="Workspace Navigation">
            {navGroups.map((grp) => {
              const groupItems = navItems.filter(
                (item) => (item.group ?? 'operations') === grp.id
              );
              if (groupItems.length === 0) return null;
              return (
                <div key={grp.id} className="flex flex-col gap-1">
                  {!sidebarCollapsed && (
                    <div className="px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                      {grp.title}
                    </div>
                  )}
                  {groupItems.map((item) => {
                    const active = item.id === activeNavId;
                    const labelText = lang === 'ml' ? item.labelMl : item.labelEn;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => onSelectNav(item.id)}
                        title={labelText}
                        aria-label={labelText}
                        className={`h-10 rounded-[var(--radius-pill)] flex items-center transition-colors cursor-pointer ${
                          sidebarCollapsed
                            ? 'w-10 mx-auto justify-center px-0'
                            : 'w-full px-3.5 justify-between gap-2.5 text-left'
                        } text-sm ${
                          active
                            ? 'bg-[var(--brand)] text-[var(--brand-fg)] font-semibold'
                            : 'text-[var(--text-secondary)] font-medium hover:bg-[var(--bg-surface)]/80 hover:text-[var(--text-primary)]'
                        }`}
                      >
                        <span
                          className={`flex items-center ${
                            sidebarCollapsed ? 'justify-center' : 'gap-2.5 truncate'
                          }`}
                        >
                          <span className="shrink-0">{item.icon}</span>
                          {!sidebarCollapsed && (
                            <span lang={lang === 'ml' ? 'ml' : 'en'} className="truncate">
                              {labelText}
                            </span>
                          )}
                        </span>
                        {!sidebarCollapsed && item.badge && (
                          <span
                            className={`text-[11px] font-mono-code px-2 py-0.5 rounded-[var(--radius-pill)] whitespace-nowrap shrink-0 ${
                              active
                                ? 'bg-[var(--brand-hover)] text-[var(--brand-fg)]'
                                : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-hair)]'
                            }`}
                          >
                            {item.badge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </nav>
        </div>

        {/* Bottom Operator Profile Card */}
        <div className="flex flex-col gap-2 w-full pt-3 border-t border-[var(--border-hair)]">
          {operatorCard && (
            <button
              type="button"
              onClick={operatorCard.onOpenProfile}
              title={`Operator Profile: ${operatorCard.fullName} (${operatorCard.roleBadge})`}
              aria-label={`Open Operator Profile for ${operatorCard.fullName}`}
              className={`rounded-[var(--radius-card)] bg-[var(--bg-surface)] border border-[var(--border-hair)] hover:border-[var(--brand)] transition-colors cursor-pointer text-left ${
                sidebarCollapsed ? 'w-10 h-10 mx-auto flex items-center justify-center p-0' : 'p-2.5 w-full flex items-center gap-2.5'
              }`}
            >
              <span className="w-7 h-7 rounded-[var(--radius-pill)] bg-[var(--brand)] text-[var(--brand-fg)] text-xs font-bold font-mono-code inline-flex items-center justify-center shrink-0">
                {operatorCard.initials}
              </span>
              {!sidebarCollapsed && (
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-[var(--text-primary)] truncate">
                    {operatorCard.fullName}
                  </div>
                  <div className="text-[11px] text-[var(--text-muted)] truncate">
                    {operatorCard.roleBadge}
                  </div>
                </div>
              )}
            </button>
          )}
        </div>
      </aside>

      {/* Main Workspace Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="min-h-[54px] px-4 sm:px-6 lg:px-8 py-2 bg-[var(--bg-surface)] border-b border-[var(--border-hair)] flex items-center justify-between gap-4 no-print">
          <div className="flex items-center gap-2 min-w-0 shrink-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open mobile navigation menu"
              className="md:hidden w-9 h-9 rounded-[var(--radius-pill)] bg-[var(--bg-sunken)] border border-[var(--border-strong)] text-[var(--text-primary)] inline-flex items-center justify-center shrink-0 cursor-pointer"
            >
              <Menu className="w-4 h-4" />
            </button>
            <span className="text-sm font-bold text-[var(--text-primary)] truncate">
              {activeItem?.labelEn ?? 'Workspace'}
            </span>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto max-w-full py-0.5">
            {headerRight}
          </div>
        </header>

        {/* Mobile Horizontal Pill Navigation (< 768px) */}
        <nav
          aria-label="Mobile Workspace Navigation"
          className="md:hidden px-3 py-2 bg-[var(--bg-sunken)] border-b border-[var(--border-hair)] flex items-center gap-1.5 overflow-x-auto no-print"
        >
          {navItems.map((item) => {
            const active = item.id === activeNavId;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectNav(item.id)}
                className={`h-8 px-3 rounded-[var(--radius-pill)] inline-flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  active
                    ? 'bg-[var(--brand)] text-[var(--brand-fg)]'
                    : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-hair)]'
                }`}
              >
                <span className="shrink-0">{item.icon}</span>
                <span lang={lang === 'ml' ? 'ml' : 'en'} className="whitespace-nowrap">
                  {lang === 'ml' ? item.labelMl : item.labelEn}
                </span>
              </button>
            );
          })}
        </nav>

        {/* Responsive Content Container: Fluid from 390px Mobile up to 1440px Desktop */}
        <main className="flex-1 w-full max-w-[1440px] mx-auto px-3 sm:px-6 lg:px-8 xl:px-10 py-4 sm:py-6 md:py-7 flex flex-col gap-5 sm:gap-6 lg:gap-7">
          {children}
        </main>
      </div>
    </div>
  );
};

export const DocksideShell: React.FC<ShellLayoutProps> = ({
  brandSubtitle,
  navItems,
  activeNavId,
  onSelectNav,
  lang,
  headerRight,
  children,
}) => {
  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-app)] text-[var(--text-primary)] pb-24 overflow-x-hidden">
      <header className="px-3 sm:px-6 lg:px-8 py-3 bg-[var(--bg-surface)] border-b border-[var(--border-hair)] flex flex-wrap items-center justify-between gap-3 no-print">
        <div className="flex items-center gap-2.5">
          <MaritimeCrestSvgEmblem size={36} />
          <div>
            <span className="text-base font-bold text-[var(--text-primary)]">HarbourOS</span>
            <span className="text-xs text-[var(--text-muted)] ml-2">{brandSubtitle}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">{headerRight}</div>
      </header>

      <main className="flex-1 w-full max-w-[1200px] mx-auto px-3 sm:px-6 lg:px-8 py-5 sm:py-6 flex flex-col gap-6">
        {children}
      </main>

      <nav
        aria-label="Dockside Workspace Switcher"
        className="fixed bottom-0 inset-x-0 z-40 bg-[var(--bg-surface)] border-t border-[var(--border-strong)] px-2 sm:px-4 py-2 flex items-center justify-around gap-1.5 sm:gap-2 no-print"
      >
        {navItems.slice(0, 4).map((item) => {
          const active = item.id === activeNavId;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectNav(item.id)}
              className={`min-h-[64px] flex-1 max-w-[260px] px-2.5 sm:px-4 rounded-[var(--radius-pill)] flex items-center justify-center gap-1.5 sm:gap-2.5 text-xs sm:text-sm font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                active
                  ? 'bg-[var(--brand)] text-[var(--brand-fg)]'
                  : 'bg-[var(--brand-soft)] text-[var(--brand-soft-fg)] hover:bg-[var(--navy-200)]'
              }`}
            >
              <span className="shrink-0">{item.icon}</span>
              <span lang={lang === 'ml' ? 'ml' : 'en'} className="truncate">
                {lang === 'ml' ? item.labelMl : item.labelEn}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
};
