import React, { useEffect, useState } from 'react';
import { Search, ArrowRight, CornerDownLeft } from 'lucide-react';
import { Badge, Button, Modal } from '@web/ui/index.tsx';
import {
  buildCommandPaletteItems,
  type BootstrapData,
  type CommandPaletteItem,
} from '@web/lib/api.ts';

export interface CommandPaletteModalProps {
  open: boolean;
  onClose: () => void;
  bootstrap: BootstrapData | null;
  onExecuteItem: (item: CommandPaletteItem) => void;
}

export const CommandPaletteModal: React.FC<CommandPaletteModalProps> = ({
  open,
  onClose,
  bootstrap,
  onExecuteItem,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const items = buildCommandPaletteItems(bootstrap, query);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, open]);

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="HarbourOS Universal Command & Entity Search (⌘K)"
      description="Search across live PostgreSQL landed catch lots, nodal payout batches, SHA-256 journals, buyers, and statutory workspaces"
      footer={
        <div className="w-full flex items-center justify-between text-xs text-[var(--text-secondary)]">
          <span>
            Showing <strong>{items.length}</strong> indexed harbour entities & actions
          </span>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close (Esc)
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="relative flex items-center">
          <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3.5 pointer-events-none" />
          <input
            type="search"
            autoFocus
            aria-label="Universal Command Palette Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex((prev) =>
                  items.length > 0 ? (prev + 1) % items.length : 0
                );
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex((prev) =>
                  items.length > 0 ? (prev - 1 + items.length) % items.length : 0
                );
              } else if (e.key === 'Enter' && items[selectedIndex]) {
                e.preventDefault();
                onExecuteItem(items[selectedIndex]!);
              }
            }}
            placeholder="Search LOT-MUN-20261106-001, MUN-PAY, UTR CSV, Buyer #101, JRN-ALLOC..."
            className="w-full h-11 pl-10 pr-4 rounded-[var(--radius-pill)] bg-[var(--bg-sunken)] border border-[var(--border-strong)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--focus)]"
          />
        </div>

        <div className="flex flex-col gap-1.5 max-h-80 overflow-y-auto">
          {items.length === 0 ? (
            <div className="p-6 text-center text-xs text-[var(--text-muted)]">
              No harbour lots, payout batches, journals, or commands match &ldquo;{query}&rdquo;.
            </div>
          ) : (
            items.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onExecuteItem(item)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`w-full p-3 rounded-[var(--radius-card)] border text-left flex items-center justify-between gap-3 cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-[var(--brand-soft)] border-[var(--brand)]'
                      : 'bg-[var(--bg-surface)] border-[var(--border-hair)] hover:border-[var(--border-strong)]'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold font-mono-code uppercase px-2 py-0.5 rounded-[var(--radius-pill)] bg-[var(--bg-sunken)] text-[var(--text-secondary)] whitespace-nowrap shrink-0 leading-none">
                        {item.category}
                      </span>
                      <span className="text-xs font-bold text-[var(--text-primary)] truncate">
                        {item.title}
                      </span>
                    </div>
                    <div className="text-[11px] text-[var(--text-secondary)] truncate mt-0.5">
                      {item.subtitle}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge tone={item.badgeTone} label={item.badgeLabel} />
                    {isSelected ? (
                      <CornerDownLeft className="w-3.5 h-3.5 text-[var(--brand)]" />
                    ) : (
                      <ArrowRight className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </Modal>
  );
};
