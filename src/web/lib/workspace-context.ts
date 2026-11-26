import type { WorkspaceId } from '@shared/contracts/rbac.ts';
import {
  WORKSPACE_GROUP_MAP,
  WORKSPACE_GROUP_META,
  type WorkspaceGroup,
} from '@web/lib/command-palette.ts';

export interface BreadcrumbSegment {
  id: string;
  label: string;
  kind: 'tenant' | 'group' | 'workspace';
  groupId?: WorkspaceGroup | undefined;
  current?: boolean | undefined;
}

export function buildWorkspaceBreadcrumbs(params: {
  tenantName: string | null | undefined;
  workspaceId: WorkspaceId;
  workspaceLabel: string;
  screenMode?: 'workspace' | 'gallery' | 'login' | undefined;
}): ReadonlyArray<BreadcrumbSegment> {
  const tenantLabel = params.tenantName?.trim() || 'Munambam Fishing Harbour (HMS)';

  if (params.screenMode === 'gallery') {
    return [
      { id: 'tenant', label: tenantLabel, kind: 'tenant' },
      { id: 'group', label: 'Design System', kind: 'group' },
      { id: 'workspace', label: 'UI Kit Gallery', kind: 'workspace', current: true },
    ];
  }

  const groupId = WORKSPACE_GROUP_MAP[params.workspaceId];
  const groupLabel = WORKSPACE_GROUP_META[groupId].label;

  return [
    { id: 'tenant', label: tenantLabel, kind: 'tenant' },
    { id: 'group', label: groupLabel, kind: 'group', groupId },
    {
      id: `ws-${params.workspaceId}`,
      label: params.workspaceLabel,
      kind: 'workspace',
      current: true,
    },
  ];
}

export interface NetworkStatusPresentation {
  status: 'online' | 'offline' | 'reconnected';
  shortLabel: string;
  ariaLabel: string;
  toast: {
    tone: 'warn' | 'ok';
    title: string;
    message: string;
  } | null;
}

export function resolveNetworkStatusPresentation(input: {
  isOnline: boolean;
  recentlyReconnected: boolean;
  dismissedOfflineToast: boolean;
  queuedCount?: number | undefined;
  replayingQueue?: boolean | undefined;
}): NetworkStatusPresentation {
  const queuedCount = Math.max(0, input.queuedCount ?? 0);
  const actionNoun = queuedCount === 1 ? 'action' : 'actions';

  if (!input.isOnline) {
    return {
      status: 'offline',
      shortLabel: queuedCount > 0 ? `Offline · ${queuedCount} queued` : 'Offline · Queued',
      ariaLabel:
        queuedCount > 0
          ? `Network connection lost. ${queuedCount} ${actionNoun} queued for synchronization.`
          : 'Network connection lost. Changes are queued for synchronization.',
      toast: input.dismissedOfflineToast
        ? null
        : {
            tone: 'warn',
            title:
              queuedCount > 0
                ? `Connection lost — ${queuedCount} ${actionNoun} queued for sync`
                : 'Connection lost — changes queued for sync',
            message:
              queuedCount > 0
                ? `You are currently offline with ${queuedCount} saved ${actionNoun} in local storage. They will replay automatically once connection returns.`
                : 'You are currently offline. New dockside actions are queued locally and will synchronize automatically once connection returns.',
          },
    };
  }

  if (input.replayingQueue) {
    return {
      status: 'reconnected',
      shortLabel: queuedCount > 0 ? `Syncing ${queuedCount}…` : 'Syncing…',
      ariaLabel: 'Replaying queued offline actions.',
      toast: {
        tone: 'ok',
        title: 'Connection restored — replaying queued actions',
        message:
          queuedCount > 0
            ? `Replaying ${queuedCount} queued ${actionNoun} to the harbour ledger now.`
            : 'Replaying queued offline actions now.',
      },
    };
  }

  if (input.recentlyReconnected) {
    return {
      status: 'reconnected',
      shortLabel: 'Back online',
      ariaLabel: 'Network connection restored. Synchronizing changes.',
      toast: {
        tone: 'ok',
        title: 'Connection restored — syncing harbour data',
        message:
          'You are back online. Queued updates and the latest harbour state are synchronizing now.',
      },
    };
  }

  return {
    status: 'online',
    shortLabel: queuedCount > 0 ? `Online · ${queuedCount} queued` : 'Online',
    ariaLabel:
      queuedCount > 0
        ? `Network status: Online with ${queuedCount} queued ${actionNoun} ready to sync`
        : 'Network status: Online',
    toast: null,
  };
}
