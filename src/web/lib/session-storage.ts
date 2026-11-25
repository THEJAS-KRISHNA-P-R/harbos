import { WORKSPACES, type Role, type WorkspaceId } from '@shared/contracts/rbac.ts';

export const SESSION_JWT_STORAGE_KEY = 'harbouros.auth.jwt';
export const ACTIVE_WORKSPACE_STORAGE_KEY = 'harbouros.ui.activeWorkspace';

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const VALID_WORKSPACE_IDS: ReadonlySet<string> = new Set(WORKSPACES.map((w) => w.id));

const JWT_SHAPE_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export function isValidWorkspaceId(value: unknown): value is WorkspaceId {
  return typeof value === 'string' && VALID_WORKSPACE_IDS.has(value);
}

export function isPlausibleJwt(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return trimmed.length >= 20 && trimmed.length <= 4096 && JWT_SHAPE_RE.test(trimmed);
}

export function getBrowserLocalStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readStoredJwt(storage: StorageLike | null | undefined): string | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(SESSION_JWT_STORAGE_KEY);
    if (!isPlausibleJwt(raw)) return null;
    return raw.trim();
  } catch {
    return null;
  }
}

export function persistStoredJwt(
  storage: StorageLike | null | undefined,
  token: string | null
): boolean {
  if (!storage) return false;
  try {
    if (token && isPlausibleJwt(token)) {
      storage.setItem(SESSION_JWT_STORAGE_KEY, token.trim());
    } else {
      storage.removeItem(SESSION_JWT_STORAGE_KEY);
    }
    return true;
  } catch {
    return false;
  }
}

export function readStoredWorkspace(
  storage: StorageLike | null | undefined
): WorkspaceId | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY);
    return isValidWorkspaceId(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function persistStoredWorkspace(
  storage: StorageLike | null | undefined,
  workspace: WorkspaceId
): boolean {
  if (!storage || !isValidWorkspaceId(workspace)) return false;
  try {
    storage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, workspace);
    return true;
  } catch {
    return false;
  }
}

export function clearStoredSession(
  storage: StorageLike | null | undefined,
  options?: { clearWorkspace?: boolean }
): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(SESSION_JWT_STORAGE_KEY);
    if (options?.clearWorkspace) {
      storage.removeItem(ACTIVE_WORKSPACE_STORAGE_KEY);
    }
    return true;
  } catch {
    return false;
  }
}

export function extractWorkspaceFromPathname(pathname: string): WorkspaceId | null {
  const match = pathname.match(/^\/w\/([a-z]+)$/);
  const candidate = match?.[1];
  return isValidWorkspaceId(candidate) ? candidate : null;
}

export function isWorkspaceAuthorizedForRole(
  workspaceId: WorkspaceId,
  role: Role
): boolean {
  const def = WORKSPACES.find((w) => w.id === workspaceId);
  return Boolean(def && def.allowedRoles.includes(role));
}

export function resolveRehydratedWorkspace(params: {
  pathname: string;
  storedWorkspace: WorkspaceId | null;
  role: Role;
  roleDefaultWorkspace: WorkspaceId;
}): WorkspaceId {
  const pathWs = extractWorkspaceFromPathname(params.pathname);
  if (pathWs && isWorkspaceAuthorizedForRole(pathWs, params.role)) {
    return pathWs;
  }
  if (
    params.storedWorkspace &&
    isWorkspaceAuthorizedForRole(params.storedWorkspace, params.role)
  ) {
    return params.storedWorkspace;
  }
  return params.roleDefaultWorkspace;
}
