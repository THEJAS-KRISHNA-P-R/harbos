import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, ArrowRight, CornerDownLeft, Compass } from 'lucide-react';
import { Badge, Button, Modal } from '@web/ui/index.tsx';
import {
  buildCommandPaletteItems,
  buildWorkspaceQuickJumpItems,
  WORKSPACE_GROUP_META,
  type BootstrapData,
  type CommandPaletteFilterScope,
  type CommandPaletteItem,
  type WorkspaceGroup,
} from '@web/lib/api.ts';
import type { WorkspaceId } from '@shared/contracts/rbac.ts';

export interface CommandPaletteModalProps {
  open: boolean;
  onClose: () => void;
  bootstrap: BootstrapData | null;
  allowedWorkspaceIds: ReadonlySet<WorkspaceId>;
  activeWorkspace?: WorkspaceId | undefined;
  canAccessLedger: boolean;
  onExecuteItem: (item: CommandPaletteItem) => void;
}

const GROUP_ORDER: ReadonlyArray<WorkspaceGroup> = [
  'operations',
  'clearing',
  'governance',
];

export const CommandPaletteModal: React.FC<CommandPaletteModalProps> = ({
  open,
  onClose,
  bootstrap,
  allowedWorkspaceIds,
  activeWorkspace,
  canAccessLedger,
  onExecuteItem,
}) => {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<CommandPaletteFilterScope>('all');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const allowedWorkspaceItems = useMemo(
    () => buildWorkspaceQuickJumpItems(allowedWorkspaceIds),
    [allowedWorkspaceIds]
  );

  const groupCounts = useMemo(() => {
    const counts: Record<WorkspaceGroup, number> = {
      operations: 0,
      clearing: 0,
      governance: 0,
    };
    for (const ws of allowedWorkspaceItems) {
      if (ws.workspaceGroup) {
        counts[ws.workspaceGroup] += 1;
      }
    }
    return counts;
  }, [allowedWorkspaceItems]);

  const items = useMemo(
    () =>
      buildCommandPaletteItems(bootstrap, query, scope).filter((item) => {
        if (item.actionType === 'OPEN_WORKSPACE' && item.targetWorkspace) {
          return allowedWorkspaceIds.has(item.targetWorkspace);
        }
        if (
          item.actionType === 'OPEN_LEDGER_DRAWER' ||
          item.actionType === 'OPEN_UTR_CSV_IMPORT'
        ) {
          return canAccessLedger;
        }
        if (item.actionType === 'OPEN_UI_KIT' && import.meta.env.PROD) {
          return false;
        }
        return true;
      }),
    [bootstrap, query, scope, allowedWorkspaceIds, canAccessLedger]
  );

  useEffect(() => {
    if (open) {
      setQuery('');
      setScope('all');
      setSelectedIndex(0);
    }
  }, [open]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, scope]);

  useEffect(() => {
    const activeEl = itemRefs.current[selectedIndex];
    activeEl?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (!open) return null;

  const workspaceResults = items.filter((i) => i.category === 'WORKSPACE');
  const otherResults = items.filter((i) => i.category !== 'WORKSPACE');
  const orderedVisibleItems: ReadonlyArray<CommandPaletteItem> = [
    ...workspaceResults,
    ...otherResults,
  ];

  const availableGroups = GROUP_ORDER.filter((grp) => groupCounts[grp] > 0);
  const showScopeBar = allowedWorkspaceItems.length > 1;

  const renderItemRow = (item: CommandPaletteItem, flatIndex: number) => {
    const isSelected = flatIndex === selectedIndex;
    const isCurrentWorkspace =
      item.category === 'WORKSPACE' &&
      Boolean(activeWorkspace) &&
      item.targetWorkspace === activeWorkspace;
    const groupLabel = item.workspaceGroup
      ? WORKSPACE_GROUP_META[item.workspaceGroup].label
      : null;

    return (
      <button
        key={item.id}
        ref={(el) => {
          itemRefs.current[flatIndex] = el;
        }}
        type="button"
        data-testid={`command-palette-item-${item.id}`}
        aria-selected={isSelected}
        onClick={() => onExecuteItem(item)}
        onMouseEnter={() => setSelectedIndex(flatIndex)}
        className={`w-full p-3 rounded-[var(--radius-card)] border text-left flex items-center justify-between gap-3 cursor-pointer transition-all ${
          isSelected
            ? 'bg-[var(--brand-soft)] border-[var(--brand)]'
            : 'bg-[var(--bg-surface)] border-[var(--border-hair)] hover:border-[var(--border-strong)]'
        }`}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold font-mono-code uppercase px-2 py-0.5 rounded-[var(--radius-pill)] bg-[var(--bg-sunken)] text-[var(--text-secondary)] whitespace-nowrap shrink-0 leading-none">
              {item.category === 'WORKSPACE' && groupLabel
                ? groupLabel
                : item.category.replace(/_/g, ' ')}
            </span>
            <span className="text-xs font-bold text-[var(--text-primary)] truncate">
              {item.title}
            </span>
            {isCurrentWorkspace && (
              <span className="text-[10px] font-semibold text-[var(--brand)] shrink-0">
                Current
              </span>
            )}
          </div>
          <div className="text-[11px] text-[var(--text-secondary)] truncate mt-0.5">
            {item.subtitle}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {item.category === 'WORKSPACE' && item.targetWorkspace ? (
            <span className="text-[11px] font-mono-code text-[var(--text-muted)]">
              /w/{item.targetWorkspace}
            </span>
          ) : (
            <Badge tone={item.badgeTone} label={item.badgeLabel} />
          )}
          {isSelected ? (
            <CornerDownLeft className="w-3.5 h-3.5 text-[var(--brand)]" />
          ) : (
            <ArrowRight className="w-3.5 h-3.5 text-[var(--text-muted)]" />
          )}
        </div>
      </button>
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Quick Jump & Command Palette (⌘K)"
      footer={
        <div className="w-full flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-secondary)]">
          <span className="font-mono-code">
            ↑↓ Navigate · ↵ Jump / Run · 1–{Math.max(1, allowedWorkspaceIds.size)} Workspaces
            {canAccessLedger ? ' · L Ledger' : ''}
          </span>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close (Esc)
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3" data-testid="command-palette-modal">
        <div className="relative flex items-center">
          <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3.5 pointer-events-none" />
          <input
            type="search"
            autoFocus
            data-testid="command-palette-search"
            aria-label="Universal Command Palette Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex((prev) =>
                  orderedVisibleItems.length > 0
                    ? (prev + 1) % orderedVisibleItems.length
                    : 0
                );
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex((prev) =>
                  orderedVisibleItems.length > 0
                    ? (prev - 1 + orderedVisibleItems.length) %
                      orderedVisibleItems.length
                    : 0
                );
              } else if (e.key === 'Enter' && orderedVisibleItems[selectedIndex]) {
                e.preventDefault();
                onExecuteItem(orderedVisibleItems[selectedIndex]!);
              }
            }}
            placeholder="Quick jump to any workspace (Operations, Clearing, Governance) or search lots, batches…"
            className="w-full h-11 pl-10 pr-4 rounded-[var(--radius-pill)] bg-[var(--bg-sunken)] border border-[var(--border-strong)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--focus)]"
          />
        </div>

        {showScopeBar && (
          <div
            className="flex flex-wrap items-center gap-1.5"
            role="tablist"
            aria-label="Quick Jump Workspace Groups"
          >
            <button
              type="button"
              role="tab"
              aria-selected={scope === 'all'}
              onClick={() => setScope('all')}
              className={`h-7 px-3 rounded-[var(--radius-pill)] text-xs font-semibold transition-colors cursor-pointer ${
                scope === 'all'
                  ? 'bg-[var(--brand)] text-[var(--brand-fg)]'
                  : 'bg-[var(--bg-sunken)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              All
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={scope === 'workspaces'}
              onClick={() => setScope('workspaces')}
              className={`h-7 px-3 rounded-[var(--radius-pill)] text-xs font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer ${
                scope === 'workspaces'
                  ? 'bg-[var(--brand)] text-[var(--brand-fg)]'
                  : 'bg-[var(--bg-sunken)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Compass className="w-3 h-3" />
              Workspaces ({allowedWorkspaceItems.length})
            </button>
            {availableGroups.map((grp) => (
              <button
                key={grp}
                type="button"
                role="tab"
                aria-selected={scope === grp}
                data-testid={`command-palette-group-${grp}`}
                onClick={() => setScope(grp)}
                className={`h-7 px-3 rounded-[var(--radius-pill)] text-xs font-semibold transition-colors cursor-pointer ${
                  scope === grp
                    ? 'bg-[var(--brand)] text-[var(--brand-fg)]'
                    : 'bg-[var(--bg-sunken)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {WORKSPACE_GROUP_META[grp].label} ({groupCounts[grp]})
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-2 max-h-80 overflow-y-auto pr-0.5">
          {orderedVisibleItems.length === 0 ? (
            <div className="p-6 text-center text-xs text-[var(--text-muted)]">
              No workspaces, lots, payout batches, or commands match &ldquo;{query}&rdquo;.
            </div>
          ) : (
            <>
              {workspaceResults.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <div className="px-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                    Quick Jump · Workspaces
                  </div>
                  {workspaceResults.map((item, idx) => renderItemRow(item, idx))}
                </div>
              )}

              {otherResults.length > 0 && (
                <div className="flex flex-col gap-1.5 pt-1">
                  <div className="px-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                    Actions & Records
                  </div>
                  {otherResults.map((item, idx) =>
                    renderItemRow(item, workspaceResults.length + idx)
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
};
