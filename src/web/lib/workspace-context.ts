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
}): NetworkStatusPresentation {
  if (!input.isOnline) {
    return {
      status: 'offline',
      shortLabel: 'Offline · Queued',
      ariaLabel: 'Network connection lost. Changes are queued for synchronization.',
      toast: input.dismissedOfflineToast
        ? null
        : {
            tone: 'warn',
            title: 'Connection lost — changes queued for sync',
            message:
              'You are currently offline. New dockside actions are queued locally and will synchronize automatically once connection returns.',
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
    shortLabel: 'Online',
    ariaLabel: 'Network status: Online',
    toast: null,
  };
}
