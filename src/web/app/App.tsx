import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  BookOpen,
  Plus,
  Search,
  Wifi,
  WifiOff,
} from 'lucide-react';
import {
  AppShell,
  DocksideShell,
  Button,
  Select,
  Modal,
  Toast,
  EmptyState,
  ErrorBoundary,
  WorkspaceSkeleton,
  DockScaleIcon,
  AuctionGavelBellIcon,
  BuyerCrateEscrowIcon,
  FisherVesselPassbookIcon,
  ThermometerFishGradeIcon,
  HarbourLedgerVaultIcon,
  StatutorySealIcon,
  type NavItem,
} from '@web/ui/index.tsx';
import {
  apiRequest,
  formatOperatorInitials,
  getInMemoryAccessToken,
  getRoleDisplayMeta,
  resolveGlobalKeyboardShortcut,
  setInMemoryAccessToken,
  type BootstrapData,
  type CommandPaletteItem,
  type OperatorProfileResponse,
  type OperatorRow,
  type SessionUser,
} from '@web/lib/api.ts';
import type {
  CommandPaletteFilterScope,
  WorkspaceGroup,
} from '@web/lib/command-palette.ts';
import {
  buildWorkspaceBreadcrumbs,
  resolveNetworkStatusPresentation,
} from '@web/lib/workspace-context.ts';
import {
  buildWorkspaceExportDataset,
  serializeDatasetToCsv,
  serializeDatasetToPdfBytes,
  triggerBrowserFileDownload,
  type WorkspaceExportFormat,
} from '@web/lib/workspace-export.ts';
import {
  clearStoredSession,
  extractWorkspaceFromPathname,
  getBrowserLocalStorage,
  isWorkspaceAuthorizedForRole,
  persistStoredJwt,
  persistStoredWorkspace,
  readStoredJwt,
  readStoredWorkspace,
  resolveRehydratedWorkspace,
} from '@web/lib/session-storage.ts';
import { WORKSPACES, type Role, type WorkspaceId } from '@shared/contracts/rbac.ts';
import {
  LedgerInspectorDrawer,
  type GoldenVectorRow,
} from '@web/app/components/LedgerInspectorDrawer.tsx';
import { OperatorProfileDrawer } from '@web/app/components/OperatorProfileDrawer.tsx';
import { LoginPortalScreen } from '@web/app/components/LoginPortalScreen.tsx';
import { CommandPaletteModal } from '@web/app/components/CommandPaletteModal.tsx';
import { TenantOnboardingWizard } from '@web/app/components/TenantOnboardingWizard.tsx';
import { WorkspaceBreadcrumbs } from '@web/app/components/WorkspaceBreadcrumbs.tsx';
import { WorkspaceExportMenu } from '@web/app/components/WorkspaceExportMenu.tsx';
import { useI18n } from '@web/i18n/index.tsx';

const WeighingWorkspace = React.lazy(async () => {
  const m = await import('@web/workspaces/weighing/index.tsx');
  return { default: m.WeighingWorkspace };
});
const PitWorkspace = React.lazy(async () => {
  const m = await import('@web/workspaces/pit/index.tsx');
  return { default: m.PitWorkspace };
});
const BuyerWorkspace = React.lazy(async () => {
  const m = await import('@web/workspaces/buyer/index.tsx');
  return { default: m.BuyerWorkspace };
});
const FisherWorkspace = React.lazy(async () => {
  const m = await import('@web/workspaces/fisher/index.tsx');
  return { default: m.FisherWorkspace };
});
const InspectorWorkspace = React.lazy(async () => {
  const m = await import('@web/workspaces/inspector/index.tsx');
  return { default: m.InspectorWorkspace };
});
const HarbourWorkspace = React.lazy(async () => {
  const m = await import('@web/workspaces/harbour/index.tsx');
  return { default: m.HarbourWorkspace };
});
const PlatformWorkspace = React.lazy(async () => {
  const m = await import('@web/workspaces/platform/index.tsx');
  return { default: m.PlatformWorkspace };
});
const DevDesignSystemGalleryScreen = import.meta.env.DEV
  ? React.lazy(async () => {
      const m = await import('@web/app/components/DesignSystemGalleryScreen.tsx');
      return { default: m.DesignSystemGalleryScreen };
    })
  : null;

const WORKSPACE_ICONS: Record<WorkspaceId, React.ReactNode> = {
  weighing: <DockScaleIcon size={18} />,
  pit: <AuctionGavelBellIcon size={18} />,
  buyer: <BuyerCrateEscrowIcon size={18} />,
  fisher: <FisherVesselPassbookIcon size={18} />,
  inspector: <ThermometerFishGradeIcon size={18} />,
  harbour: <HarbourLedgerVaultIcon size={18} />,
  platform: <StatutorySealIcon size={18} />,
};

const WORKSPACE_GROUPS: Record<WorkspaceId, 'operations' | 'clearing' | 'governance'> = {
  weighing: 'operations',
  inspector: 'operations',
  pit: 'operations',
  buyer: 'clearing',
  fisher: 'clearing',
  harbour: 'governance',
  platform: 'governance',
};

const ROLE_DEFAULT_WORKSPACE: Record<Role, WorkspaceId> = {
  WEIGHING_OPERATOR: 'weighing',
  LICENSED_AUCTIONEER: 'pit',
  WHOLESALE_BUYER: 'buyer',
  FISHERMAN_BOAT_OWNER: 'fisher',
  AUTHORIZED_INSPECTOR: 'inspector',
  HARBOUR_ADMIN: 'harbour',
  ACCOUNTANT: 'harbour',
  SUPER_ADMIN: 'platform',
};

const DEV_DEEP_LINK_ROLE: Record<WorkspaceId, Role> = {
  weighing: 'WEIGHING_OPERATOR',
  pit: 'LICENSED_AUCTIONEER',
  buyer: 'WHOLESALE_BUYER',
  fisher: 'FISHERMAN_BOAT_OWNER',
  inspector: 'AUTHORIZED_INSPECTOR',
  harbour: 'HARBOUR_ADMIN',
  platform: 'SUPER_ADMIN',
};

const LEDGER_ALLOWED_ROLES: ReadonlySet<Role> = new Set([
  'SUPER_ADMIN',
  'HARBOUR_ADMIN',
  'ACCOUNTANT',
]);

const GOLDEN_VECTOR_ROWS: ReadonlyArray<GoldenVectorRow> = [
  {
    mode: 'A: FIXED_SAAS_ONLY',
    fisherman: '₹95,000.00 (9,500,000 p)',
    bonus: '₹2,000.00 (200,000 p)',
    auctioneer: '₹1,000.00 (100,000 p)',
    hms: '₹1,000.00 (100,000 p)',
    coop: '₹1,000.00 (100,000 p)',
    hos: '₹0.00 (0 p)',
    payable: '₹1,00,000.00 (10,000,000 p)',
  },
  {
    mode: 'B: INSTITUTIONAL_TECH_SHARE',
    fisherman: '₹95,000.00 (9,500,000 p)',
    bonus: '₹2,000.00 (200,000 p)',
    auctioneer: '₹1,000.00 (100,000 p)',
    hms: '₹800.00 (80,000 p)',
    coop: '₹800.00 (80,000 p)',
    hos: '₹400.00 (40,000 p)',
    payable: '₹1,00,000.00 (10,000,000 p)',
  },
  {
    mode: 'C: HYBRID (B + 100 bps + GST)',
    fisherman: '₹95,000.00 (9,500,000 p)',
    bonus: '₹2,000.00 (200,000 p)',
    auctioneer: '₹1,000.00 (100,000 p)',
    hms: '₹800.00 (80,000 p)',
    coop: '₹800.00 (80,000 p)',
    hos: '₹1,400.00 + ₹180 GST',
    payable: '₹1,01,180.00 (10,118,000 p)',
  },
];

export const App: React.FC = () => {
  const { locale: lang, t } = useI18n();
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
  const [bootstrapRefreshing, setBootstrapRefreshing] = useState(false);
  const [personaSwitching, setPersonaSwitching] = useState(false);
  const [tenantSwitching, setTenantSwitching] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const activeTenantIdRef = useRef<string | undefined>(undefined);
  activeTenantIdRef.current = user?.tenantId;
  const didMountBootstrapRef = useRef(false);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceId>(() => {
    if (typeof window !== 'undefined') {
      const pathWs = extractWorkspaceFromPathname(window.location.pathname);
      if (pathWs) return pathWs;
      const storedWs = readStoredWorkspace(getBrowserLocalStorage());
      if (storedWs) return storedWs;
    }
    return 'harbour';
  });
  const [screenMode, setScreenMode] = useState<'workspace' | 'login' | 'gallery'>(() => {
    if (typeof window !== 'undefined' && window.location.pathname === '/ui') return 'gallery';
    if (typeof window !== 'undefined' && window.location.pathname === '/login') return 'login';
    return 'workspace';
  });
  const [docksideMobileLayout, setDocksideMobileLayout] = useState(false);

  // OTP Login states
  const [phoneInput, setPhoneInput] = useState('');
  const [otpInput, setOtpInput] = useState('');
  const [devEchoOtp, setDevEchoOtp] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSuccess, setAuthSuccess] = useState<string | null>(null);

  // Drawers & Modals: Ledger Inspector, Operator Profile, Command Palette (⌘K)
  const [ledgerDrawerOpen, setLedgerDrawerOpen] = useState(false);
  const [autoOpenUtrSignal, setAutoOpenUtrSignal] = useState(0);
  const [profileDrawerOpen, setProfileDrawerOpen] = useState(false);
  const [profileTab, setProfileTab] = useState<'identity' | 'switch' | 'session'>('identity');
  const [profileData, setProfileData] = useState<OperatorProfileResponse | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [editFullName, setEditFullName] = useState('');
  const [editPhoneE164, setEditPhoneE164] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileFeedback, setProfileFeedback] = useState<{
    tone: 'ok' | 'warn' | 'danger' | 'info';
    title: string;
    msg: string;
  } | null>(null);
  const [galleryModalOpen, setGalleryModalOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandPaletteInitialScope, setCommandPaletteInitialScope] =
    useState<CommandPaletteFilterScope>('all');

  // Real-time browser network status monitoring
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [recentlyReconnected, setRecentlyReconnected] = useState(false);
  const [dismissedOfflineToast, setDismissedOfflineToast] = useState(false);
  const [exportFeedback, setExportFeedback] = useState<{
    title: string;
    message: string;
  } | null>(null);
  const exportToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tokenRef = useRef<string | null>(null);
  tokenRef.current = token;

  useEffect(() => {
    return () => {
      if (exportToastTimerRef.current) {
        clearTimeout(exportToastTimerRef.current);
      }
    };
  }, []);

  const loadBootstrap = useCallback(async (jwt: string): Promise<void> => {
    setBootstrapRefreshing(true);
    try {
      const data = await apiRequest<BootstrapData>('/api/v1/bootstrap', {
        method: 'GET',
        token: jwt,
      });
      setBootstrap(data);
    } finally {
      setBootstrapRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const handleOffline = (): void => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      setIsOnline(false);
      setRecentlyReconnected(false);
      setDismissedOfflineToast(false);
    };

    const handleOnline = (): void => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      setIsOnline(true);
      setRecentlyReconnected(true);
      setDismissedOfflineToast(false);
      if (tokenRef.current) {
        void loadBootstrap(tokenRef.current).catch(() => {
          setBootstrapRefreshing(false);
        });
      }
      reconnectTimer = setTimeout(() => {
        setRecentlyReconnected(false);
        reconnectTimer = null;
      }, 5000);
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, [loadBootstrap]);

  const loadOperatorProfile = useCallback(async (jwt: string): Promise<void> => {
    setProfileLoading(true);
    try {
      const res = await apiRequest<OperatorProfileResponse>('/api/v1/auth/profile', {
        method: 'GET',
        token: jwt,
      });
      setProfileData(res);
      setEditFullName(res.profile.full_name);
      setEditPhoneE164(res.profile.phone_e164);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('401')) {
        setProfileData(null);
      }
    } finally {
      setProfileLoading(false);
    }
  }, []);

  const commitAccessToken = useCallback((nextToken: string | null): void => {
    setToken(nextToken);
    persistStoredJwt(getBrowserLocalStorage(), nextToken);
    setInMemoryAccessToken(nextToken, (refreshedToken) => {
      setToken(refreshedToken);
      persistStoredJwt(getBrowserLocalStorage(), refreshedToken);
    });
  }, []);

  const commitActiveWorkspace = useCallback((nextWorkspace: WorkspaceId): void => {
    setActiveWorkspace(nextWorkspace);
    persistStoredWorkspace(getBrowserLocalStorage(), nextWorkspace);
  }, []);

  const handlePersonaSwitch = useCallback(
    async (
      role: Role,
      options?: {
        silentFallbackToLogin?: boolean;
        preservePathIfAllowed?: boolean;
        preferredWorkspace?: WorkspaceId | null;
        tenantId?: string;
      }
    ): Promise<void> => {
      setPersonaSwitching(true);
      try {
        const targetTenantId = options?.tenantId ?? activeTenantIdRef.current;
        const res = await apiRequest<{ accessToken: string; user: SessionUser }>(
          '/api/v1/auth/persona-switch',
          {
            method: 'POST',
            body: targetTenantId ? { role, tenantId: targetTenantId } : { role },
          }
        );
        commitAccessToken(res.accessToken);
        setUser(res.user);
        setPhoneInput(res.user.phoneE164);
        setEditFullName(res.user.fullName);
        setEditPhoneE164(res.user.phoneE164);
        if (!LEDGER_ALLOWED_ROLES.has(res.user.role)) {
          setLedgerDrawerOpen(false);
        }
        const pathWs =
          typeof window !== 'undefined'
            ? extractWorkspaceFromPathname(window.location.pathname)
            : null;
        const candidateWs = options?.preservePathIfAllowed
          ? (pathWs ?? options?.preferredWorkspace ?? null)
          : null;
        const targetWorkspace =
          candidateWs && isWorkspaceAuthorizedForRole(candidateWs, res.user.role)
            ? candidateWs
            : (ROLE_DEFAULT_WORKSPACE[res.user.role] ?? 'harbour');
        commitActiveWorkspace(targetWorkspace);
        if (typeof window !== 'undefined' && window.location.pathname !== '/ui') {
          window.history.replaceState({}, '', `/w/${targetWorkspace}`);
        }
        setScreenMode((prev) => (prev === 'gallery' ? 'gallery' : 'workspace'));
        await Promise.all([
          loadBootstrap(res.accessToken),
          loadOperatorProfile(res.accessToken),
        ]);
      } catch (err) {
        if (options?.silentFallbackToLogin) {
          setScreenMode((prev) => (prev === 'gallery' ? 'gallery' : 'login'));
          return;
        }
        setAuthError(err instanceof Error ? err.message : 'Failed to switch persona');
      } finally {
        setPersonaSwitching(false);
      }
    },
    [commitAccessToken, commitActiveWorkspace, loadBootstrap, loadOperatorProfile]
  );

  const handleSwitchTenant = useCallback(
    async (tenantId: string, targetWorkspace?: WorkspaceId): Promise<void> => {
      if (!tenantId) return;
      setTenantSwitching(true);
      try {
        let nextToken: string;
        let nextUser: SessionUser;
        if (user?.role === 'SUPER_ADMIN' && token) {
          const res = await apiRequest<{ accessToken: string; user: SessionUser }>(
            '/api/v1/auth/tenant-switch',
            {
              method: 'POST',
              token,
              body: { tenantId },
            }
          );
          nextToken = res.accessToken;
          nextUser = res.user;
        } else {
          const res = await apiRequest<{ accessToken: string; user: SessionUser }>(
            '/api/v1/auth/persona-switch',
            {
              method: 'POST',
              body: { role: user?.role ?? 'SUPER_ADMIN', tenantId },
            }
          );
          nextToken = res.accessToken;
          nextUser = res.user;
        }
        commitAccessToken(nextToken);
        setUser(nextUser);
        setPhoneInput(nextUser.phoneE164);
        setEditFullName(nextUser.fullName);
        setEditPhoneE164(nextUser.phoneE164);
        if (targetWorkspace) {
          commitActiveWorkspace(targetWorkspace);
          if (typeof window !== 'undefined' && window.location.pathname !== '/ui') {
            window.history.replaceState({}, '', `/w/${targetWorkspace}`);
          }
        }
        setScreenMode((prev) => (prev === 'gallery' ? 'gallery' : 'workspace'));
        await Promise.all([
          loadBootstrap(nextToken),
          loadOperatorProfile(nextToken),
        ]);
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : 'Failed to switch tenant');
      } finally {
        setTenantSwitching(false);
      }
    },
    [
      user?.role,
      token,
      commitAccessToken,
      commitActiveWorkspace,
      loadBootstrap,
      loadOperatorProfile,
    ]
  );

  const handleOnboardingComplete = useCallback(
    async (result: {
      accessToken: string;
      user: SessionUser;
      tenantId: string;
      tenantName: string;
      targetWorkspace: WorkspaceId;
    }): Promise<void> => {
      setOnboardingOpen(false);
      commitAccessToken(result.accessToken);
      setUser(result.user);
      setPhoneInput(result.user.phoneE164);
      setEditFullName(result.user.fullName);
      setEditPhoneE164(result.user.phoneE164);
      commitActiveWorkspace(result.targetWorkspace);
      setScreenMode('workspace');
      if (typeof window !== 'undefined') {
        window.history.replaceState({}, '', `/w/${result.targetWorkspace}`);
      }
      await Promise.all([
        loadBootstrap(result.accessToken),
        loadOperatorProfile(result.accessToken),
      ]);
    },
    [commitAccessToken, commitActiveWorkspace, loadBootstrap, loadOperatorProfile]
  );

  useEffect(() => {
    if (didMountBootstrapRef.current) return;
    didMountBootstrapRef.current = true;

    const pathname = typeof window !== 'undefined' ? window.location.pathname : '/';
    if (pathname === '/login') {
      setScreenMode('login');
      return;
    }

    const storage = getBrowserLocalStorage();
    const storedJwt = readStoredJwt(storage);
    const storedWorkspace = readStoredWorkspace(storage);
    const pathWorkspace = extractWorkspaceFromPathname(pathname);

    const runInitialBootstrap = async (): Promise<void> => {
      if (storedJwt) {
        setBootstrapRefreshing(true);
        try {
          setInMemoryAccessToken(storedJwt, (refreshedToken) => {
            setToken(refreshedToken);
            persistStoredJwt(storage, refreshedToken);
          });
          const [profileRes, bootstrapRes] = await Promise.all([
            apiRequest<OperatorProfileResponse>('/api/v1/auth/profile', {
              method: 'GET',
              token: storedJwt,
            }),
            apiRequest<BootstrapData>('/api/v1/bootstrap', {
              method: 'GET',
              token: storedJwt,
            }),
          ]);

          const restoredUser: SessionUser = {
            userId: profileRes.profile.user_id,
            tenantId: bootstrapRes.tenant?.tenant_id ?? profileRes.profile.tenant_id,
            phoneE164: profileRes.profile.phone_e164,
            fullName: profileRes.profile.full_name,
            role: profileRes.profile.role,
            entityRefId: profileRes.profile.entity_ref_id,
          };

          const shouldUseDevDeepLinkInstead =
            !import.meta.env.PROD &&
            Boolean(pathWorkspace) &&
            !isWorkspaceAuthorizedForRole(pathWorkspace!, restoredUser.role);

          if (!shouldUseDevDeepLinkInstead) {
            const effectiveJwt = getInMemoryAccessToken() ?? storedJwt;
            const targetWorkspace = resolveRehydratedWorkspace({
              pathname,
              storedWorkspace,
              role: restoredUser.role,
              roleDefaultWorkspace: ROLE_DEFAULT_WORKSPACE[restoredUser.role] ?? 'harbour',
            });
            commitAccessToken(effectiveJwt);
            setUser(restoredUser);
            setPhoneInput(restoredUser.phoneE164);
            setEditFullName(restoredUser.fullName);
            setEditPhoneE164(restoredUser.phoneE164);
            setProfileData(profileRes);
            setBootstrap(bootstrapRes);
            commitActiveWorkspace(targetWorkspace);
            if (!LEDGER_ALLOWED_ROLES.has(restoredUser.role)) {
              setLedgerDrawerOpen(false);
            }
            if (typeof window !== 'undefined' && pathname !== '/ui') {
              window.history.replaceState({}, '', `/w/${targetWorkspace}`);
            }
            setScreenMode((prev) => (prev === 'gallery' ? 'gallery' : 'workspace'));
            return;
          }
        } catch {
          clearStoredSession(storage, { clearWorkspace: false });
          setInMemoryAccessToken(null);
        } finally {
          setBootstrapRefreshing(false);
        }
      }

      if (!import.meta.env.PROD) {
        const preferredWs = pathWorkspace ?? storedWorkspace;
        const initialRole: Role =
          preferredWs && preferredWs in DEV_DEEP_LINK_ROLE
            ? DEV_DEEP_LINK_ROLE[preferredWs]
            : 'HARBOUR_ADMIN';
        await handlePersonaSwitch(initialRole, {
          silentFallbackToLogin: true,
          preservePathIfAllowed: true,
          preferredWorkspace: preferredWs,
        });
      } else {
        setScreenMode('login');
      }
    };

    void runInitialBootstrap();
  }, [commitAccessToken, commitActiveWorkspace, handlePersonaSwitch]);

  const allowedWorkspaces = useMemo(
    () => (user ? WORKSPACES.filter((w) => w.allowedRoles.includes(user.role)) : []),
    [user]
  );
  const allowedWorkspaceIds = useMemo(
    () => new Set<WorkspaceId>(allowedWorkspaces.map((w) => w.id)),
    [allowedWorkspaces]
  );
  const canAccessLedger = Boolean(user && LEDGER_ALLOWED_ROLES.has(user.role));
  const isActiveWorkspaceAuthorized = Boolean(
    user && allowedWorkspaceIds.has(activeWorkspace)
  );

  // Global keyboard shortcuts: ⌘K (Command Palette), L (Ledger Drawer), / or F (Focus Audit Filter), 1-7 (Switch Workspace)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase() ?? '';
      const isEditableTarget =
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        Boolean(target?.isContentEditable);

      const intent = resolveGlobalKeyboardShortcut({
        key: e.key,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        isEditableTarget,
        ledgerDrawerOpen,
      });

      if (intent.type === 'TOGGLE_COMMAND_PALETTE') {
        e.preventDefault();
        setCommandPaletteInitialScope('all');
        setCommandPaletteOpen((prev) => !prev);
      } else if (intent.type === 'TOGGLE_LEDGER_DRAWER' && canAccessLedger) {
        e.preventDefault();
        setLedgerDrawerOpen((prev) => !prev);
      } else if (intent.type === 'FOCUS_AUDIT_FILTER') {
        e.preventDefault();
        const filterEl = document.querySelector<HTMLInputElement>(
          '[aria-label="Filter audit logs by action_code or target_id"]'
        );
        filterEl?.focus();
      } else if (
        intent.type === 'SWITCH_WORKSPACE' &&
        !ledgerDrawerOpen &&
        !commandPaletteOpen &&
        !profileDrawerOpen
      ) {
        const ws = allowedWorkspaces[intent.workspaceIndex];
        if (ws) {
          e.preventDefault();
          commitActiveWorkspace(ws.id);
          setScreenMode('workspace');
          if (typeof window !== 'undefined') {
            window.history.replaceState({}, '', `/w/${ws.id}`);
          }
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    ledgerDrawerOpen,
    commandPaletteOpen,
    profileDrawerOpen,
    allowedWorkspaces,
    canAccessLedger,
    commitActiveWorkspace,
  ]);

  const handleRequestOtp = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setAuthError(null);
    setAuthSuccess(null);
    try {
      const res = await apiRequest<{
        status: string;
        message: string;
        devOtpEcho?: string;
      }>('/api/v1/auth/otp/request', {
        method: 'POST',
        body: { phoneE164: phoneInput },
      });
      if (res.devOtpEcho) {
        setDevEchoOtp(res.devOtpEcho);
        setOtpInput(res.devOtpEcho);
      }
      setAuthSuccess(res.message || 'If this phone number is registered, a 6-digit OTP has been dispatched.');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'OTP request failed');
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setAuthError(null);
    try {
      const res = await apiRequest<{ accessToken: string; user: SessionUser }>(
        '/api/v1/auth/otp/verify',
        {
          method: 'POST',
          body: { phoneE164: phoneInput, otpCode: otpInput },
        }
      );
      commitAccessToken(res.accessToken);
      setUser(res.user);
      setEditFullName(res.user.fullName);
      setEditPhoneE164(res.user.phoneE164);
      const nextWs = resolveRehydratedWorkspace({
        pathname: typeof window !== 'undefined' ? window.location.pathname : '/',
        storedWorkspace: readStoredWorkspace(getBrowserLocalStorage()),
        role: res.user.role,
        roleDefaultWorkspace: ROLE_DEFAULT_WORKSPACE[res.user.role],
      });
      commitActiveWorkspace(nextWs);
      if (typeof window !== 'undefined') {
        window.history.replaceState({}, '', `/w/${nextWs}`);
      }
      setScreenMode('workspace');
      await Promise.all([
        loadBootstrap(res.accessToken),
        loadOperatorProfile(res.accessToken),
      ]);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'OTP verification failed');
    }
  };

  const handleSaveProfile = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!token) return;
    setProfileSaving(true);
    setProfileFeedback(null);
    try {
      const res = await apiRequest<{ accessToken: string; user: SessionUser }>(
        '/api/v1/auth/profile',
        {
          method: 'POST',
          token,
          body: {
            fullName: editFullName,
            phoneE164: editPhoneE164,
          },
        }
      );
      commitAccessToken(res.accessToken);
      setUser(res.user);
      await Promise.all([
        loadBootstrap(res.accessToken),
        loadOperatorProfile(res.accessToken),
      ]);
      setProfileFeedback({
        tone: 'ok',
        title: 'Profile saved',
        msg: `Updated details for ${res.user.fullName} (${res.user.phoneE164}).`,
      });
    } catch (err) {
      setProfileFeedback({
        tone: 'danger',
        title: 'Profile Update Failed',
        msg: err instanceof Error ? err.message : 'Error updating profile',
      });
    } finally {
      setProfileSaving(false);
    }
  };

  const activeRoleMeta = getRoleDisplayMeta(user?.role ?? 'HARBOUR_ADMIN');
  const activeInitials = formatOperatorInitials(user?.fullName ?? 'Capt. Mathew Thomas');

  const getWorkspaceBadge = (wsId: WorkspaceId): string | undefined => {
    if (!bootstrap) return undefined;
    const lots = Array.isArray(bootstrap.lots) ? bootstrap.lots : [];
    const reversals = Array.isArray(bootstrap.reversals) ? bootstrap.reversals : [];
    if (wsId === 'weighing') return `${lots.length} lots`;
    if (wsId === 'pit') {
      const openCount = lots.filter((l) => l.available_boxes > 0).length;
      return `${openCount} open`;
    }
    if (wsId === 'inspector') return 'QC';
    if (wsId === 'buyer') return '#101';
    if (wsId === 'fisher') return '95%';
    if (wsId === 'harbour') {
      const pendingRev = reversals.filter(
        (r) => r.status === 'PENDING_SECOND_APPROVAL'
      ).length;
      return pendingRev > 0 ? `${pendingRev} key` : 'OK';
    }
    if (wsId === 'platform') return 'Admin';
    return undefined;
  };

  const SHORT_NAV_LABELS: Record<WorkspaceId, { en: string; ml: string }> = {
    weighing: { en: 'Weighing', ml: 'തൂക്കം' },
    pit: { en: 'Pit Pad', ml: 'ലേലം' },
    inspector: { en: 'Quality', ml: 'ഗുണനിലവാരം' },
    buyer: { en: 'Buyer', ml: 'വാങ്ങൽ' },
    fisher: { en: 'Passbook', ml: 'പാസ്ബുക്ക്' },
    harbour: { en: 'Harbour', ml: 'ഹാർബർ' },
    platform: { en: 'Platform', ml: 'പ്ലാറ്റ്‌ഫോം' },
  };

  const navItems: ReadonlyArray<NavItem> = useMemo(
    () =>
      allowedWorkspaces.map((w) => ({
        id: w.id,
        labelEn: w.id === 'inspector' ? 'Quality Inspection' : w.titleEn,
        labelMl: w.titleMl,
        shortLabelEn: SHORT_NAV_LABELS[w.id].en,
        shortLabelMl: SHORT_NAV_LABELS[w.id].ml,
        icon: WORKSPACE_ICONS[w.id],
        badge: getWorkspaceBadge(w.id),
        group: WORKSPACE_GROUPS[w.id],
      })),
    [allowedWorkspaces, bootstrap]
  );

  const handleSelectWorkspace = (wsId: string): void => {
    const target = wsId as WorkspaceId;
    if (user && !allowedWorkspaceIds.has(target)) {
      return;
    }
    commitActiveWorkspace(target);
    setScreenMode('workspace');
    if (typeof window !== 'undefined') {
      window.history.replaceState({}, '', `/w/${target}`);
    }
  };

  const handleExecuteCommandItem = (item: CommandPaletteItem): void => {
    setCommandPaletteOpen(false);
    if (item.actionType === 'OPEN_WORKSPACE' && item.targetWorkspace) {
      handleSelectWorkspace(item.targetWorkspace);
    } else if (item.actionType === 'OPEN_LEDGER_DRAWER' && canAccessLedger) {
      setLedgerDrawerOpen(true);
    } else if (item.actionType === 'OPEN_UTR_CSV_IMPORT' && canAccessLedger) {
      setLedgerDrawerOpen(true);
      setAutoOpenUtrSignal((n) => n + 1);
    } else if (item.actionType === 'OPEN_PROFILE_DRAWER') {
      setProfileDrawerOpen(true);
      if (token) void loadOperatorProfile(token);
    } else if (item.actionType === 'OPEN_LOGIN') {
      setScreenMode('login');
    } else if (item.actionType === 'OPEN_UI_KIT' && !import.meta.env.PROD) {
      setScreenMode('gallery');
    }
  };

  const networkStatus = useMemo(
    () =>
      resolveNetworkStatusPresentation({
        isOnline,
        recentlyReconnected,
        dismissedOfflineToast,
      }),
    [isOnline, recentlyReconnected, dismissedOfflineToast]
  );

  const activeNavLabel = useMemo(() => {
    const item = navItems.find((n) => n.id === activeWorkspace);
    if (!item) return activeWorkspace;
    return item.labelEn;
  }, [navItems, activeWorkspace]);

  const breadcrumbSegments = useMemo(
    () =>
      buildWorkspaceBreadcrumbs({
        tenantName: bootstrap?.tenant?.name_en,
        workspaceId: activeWorkspace,
        workspaceLabel: activeNavLabel,
        screenMode,
      }),
    [bootstrap?.tenant?.name_en, activeWorkspace, activeNavLabel, screenMode]
  );

  const currentExportDataset = useMemo(
    () =>
      buildWorkspaceExportDataset({
        workspaceId: activeWorkspace,
        workspaceLabel: activeNavLabel,
        bootstrap,
      }),
    [activeWorkspace, activeNavLabel, bootstrap]
  );

  const handleExportWorkspace = useCallback(
    (format: WorkspaceExportFormat): void => {
      const dataset = buildWorkspaceExportDataset({
        workspaceId: activeWorkspace,
        workspaceLabel: activeNavLabel,
        bootstrap,
      });
      const filename = `${dataset.filenameBase}.${format}`;
      if (format === 'csv') {
        const csvContent = serializeDatasetToCsv(dataset);
        triggerBrowserFileDownload({
          filename,
          mimeType: 'text/csv;charset=utf-8',
          data: csvContent,
        });
      } else {
        const pdfBytes = serializeDatasetToPdfBytes(dataset);
        triggerBrowserFileDownload({
          filename,
          mimeType: 'application/pdf',
          data: pdfBytes,
        });
      }

      if (exportToastTimerRef.current) {
        clearTimeout(exportToastTimerRef.current);
      }
      setExportFeedback({
        title: `Exported ${activeNavLabel} (${format.toUpperCase()})`,
        message: `Downloaded ${filename} (${dataset.rows.length} ${
          dataset.rows.length === 1 ? 'row' : 'rows'
        }).`,
      });
      exportToastTimerRef.current = setTimeout(() => {
        setExportFeedback(null);
        exportToastTimerRef.current = null;
      }, 4500);
    },
    [activeWorkspace, activeNavLabel, bootstrap]
  );

  const shortOperatorName = (user?.fullName ?? 'Capt. Mathew Thomas')
    .replace(/\([^)]*\)/g, '')
    .trim();

  const headerControls = (
    <>
      {networkStatus.status === 'offline' ? (
        <button
          type="button"
          data-testid="header-network-status"
          data-network-status="offline"
          onClick={() => setDismissedOfflineToast(false)}
          aria-label={networkStatus.ariaLabel}
          title={networkStatus.ariaLabel}
          className="h-8 sm:h-9 px-2.5 sm:px-3 rounded-[var(--radius-pill)] bg-[var(--warning-bg)] text-[var(--warning)] border border-[var(--warning)]/50 hover:border-[var(--warning)] inline-flex items-center justify-center gap-1.5 text-xs font-semibold cursor-pointer shrink-0 transition-colors"
        >
          <WifiOff className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="hidden sm:inline">{networkStatus.shortLabel}</span>
          <span className="sm:hidden">Offline</span>
        </button>
      ) : networkStatus.status === 'reconnected' ? (
        <span
          role="status"
          aria-live="polite"
          data-testid="header-network-status"
          data-network-status="reconnected"
          aria-label={networkStatus.ariaLabel}
          title={networkStatus.ariaLabel}
          className="h-8 sm:h-9 px-2.5 sm:px-3 rounded-[var(--radius-pill)] bg-[var(--brand-soft)] text-[var(--brand-soft-fg)] border border-[var(--navy-200)] inline-flex items-center justify-center gap-1.5 text-xs font-semibold shrink-0"
        >
          <Wifi className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="hidden sm:inline">{networkStatus.shortLabel}</span>
        </span>
      ) : (
        <span
          role="status"
          data-testid="header-network-status"
          data-network-status="online"
          aria-label={networkStatus.ariaLabel}
          title={networkStatus.ariaLabel}
          className="h-8 w-8 lg:w-auto sm:h-9 lg:px-2.5 rounded-[var(--radius-pill)] bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-hair)] inline-flex items-center justify-center gap-1.5 text-xs font-medium shrink-0"
        >
          <Wifi className="w-3.5 h-3.5 shrink-0 text-[var(--brand)]" aria-hidden="true" />
          <span className="hidden lg:inline">{networkStatus.shortLabel}</span>
        </span>
      )}

      {screenMode === 'workspace' && (
        <WorkspaceExportMenu
          workspaceLabel={activeNavLabel}
          rowCount={currentExportDataset.rows.length}
          disabled={!bootstrap || !isActiveWorkspaceAuthorized}
          onExport={handleExportWorkspace}
        />
      )}

      <button
        type="button"
        onClick={() => {
          setCommandPaletteInitialScope('all');
          setCommandPaletteOpen(true);
        }}
        aria-label="Open Command Palette"
        title="Command Palette (⌘K)"
        className="hidden sm:inline-flex sm:h-9 sm:px-3 rounded-[var(--radius-pill)] bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-strong)] hover:bg-[var(--bg-tint)] items-center justify-center gap-1.5 text-xs font-semibold cursor-pointer shrink-0"
      >
        <Search className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">⌘K</span>
      </button>

      {!import.meta.env.PROD && (
        <div className="hidden md:block shrink-0">
          <Select
            label=""
            pill
            aria-label="Switch Role Persona (Demo Mode)"
            value={user?.role ?? 'HARBOUR_ADMIN'}
            onChange={(e) => {
              const nextRole = e.target.value as Role;
              void handlePersonaSwitch(nextRole);
            }}
            options={[
              { value: 'HARBOUR_ADMIN', label: 'Role: HMS Admin' },
              { value: 'ACCOUNTANT', label: 'Role: Accountant' },
              { value: 'WEIGHING_OPERATOR', label: 'Role: Weighing' },
              { value: 'LICENSED_AUCTIONEER', label: 'Role: Auctioneer' },
              { value: 'WHOLESALE_BUYER', label: 'Role: Buyer #101' },
              { value: 'FISHERMAN_BOAT_OWNER', label: 'Role: Vessel Owner' },
              { value: 'AUTHORIZED_INSPECTOR', label: 'Role: Quality Inspector' },
              { value: 'SUPER_ADMIN', label: 'Role: Super Admin' },
            ]}
          />
        </div>
      )}

      {canAccessLedger && (
        <button
          type="button"
          onClick={() => setLedgerDrawerOpen(true)}
          aria-label="Open Ledger Inspector"
          className="h-8 w-8 sm:w-auto sm:h-9 sm:px-3.5 rounded-[var(--radius-pill)] bg-[var(--brand)] hover:bg-[var(--brand-hover)] text-[var(--brand-fg)] inline-flex items-center justify-center gap-1.5 text-xs font-semibold transition-colors cursor-pointer shrink-0"
        >
          <BookOpen className="w-4 h-4 shrink-0" />
          <span className="hidden sm:inline">Ledger</span>
        </button>
      )}

      <button
        type="button"
        onClick={() => {
          setProfileFeedback(null);
          setProfileDrawerOpen(true);
          if (token) void loadOperatorProfile(token);
        }}
        title={`${shortOperatorName} (${activeRoleMeta.shortBadge})`}
        aria-label="Open Operator Profile & Session Settings"
        className="h-8 w-8 sm:w-auto sm:h-9 sm:pl-1.5 sm:pr-2.5 rounded-[var(--radius-pill)] bg-[var(--brand-soft)] border border-[var(--navy-200)] hover:border-[var(--brand)] inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer shrink-0"
      >
        <span className="w-6 h-6 rounded-[var(--radius-pill)] bg-[var(--brand)] text-[var(--brand-fg)] text-[10px] sm:text-[11px] font-bold font-mono-code inline-flex items-center justify-center shrink-0">
          {activeInitials}
        </span>
        <span className="hidden lg:inline text-xs font-bold text-[var(--brand-soft-fg)] whitespace-nowrap">
          {activeRoleMeta.shortBadge}
        </span>
      </button>
    </>
  );

  const displayedOperators: ReadonlyArray<OperatorRow> = bootstrap?.users ?? [];
  const allTenants = bootstrap?.allTenants ?? [];
  const canOnboardTenant = user?.role === 'SUPER_ADMIN' || !import.meta.env.PROD;

  const sidebarTenantSwitcher = (
    <div className="px-2 flex flex-col gap-2">
      <div className="p-2.5 rounded-[var(--radius-card)] bg-[var(--bg-surface)] border border-[var(--border-hair)] flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--text-muted)]">
            <Building2 className="w-3 h-3" />
            Active Harbour
          </span>
          {allTenants.length > 1 && (
            <span className="text-[10px] font-mono-code text-[var(--text-muted)]">
              {allTenants.length} sites
            </span>
          )}
        </div>

        {allTenants.length > 1 ? (
          <select
            aria-label="Switch active harbour tenant"
            disabled={tenantSwitching}
            value={bootstrap?.tenant?.tenant_id ?? user?.tenantId ?? ''}
            onChange={(e) => {
              const nextId = e.target.value;
              if (nextId && nextId !== bootstrap?.tenant?.tenant_id) {
                void handleSwitchTenant(nextId);
              }
            }}
            className="w-full h-8 px-2 rounded-[var(--radius-control)] bg-[var(--bg-sunken)] border border-[var(--border-strong)]/60 text-xs font-semibold text-[var(--text-primary)] cursor-pointer focus:outline-none focus:border-[var(--brand)]"
          >
            {allTenants.map((ten) => (
              <option key={ten.tenant_id} value={ten.tenant_id}>
                {ten.name_en}
              </option>
            ))}
          </select>
        ) : (
          <div className="text-xs font-semibold text-[var(--text-primary)] truncate">
            {bootstrap?.tenant?.name_en ?? 'Munambam Fishing Harbour'}
          </div>
        )}

        {canOnboardTenant && (
          <button
            type="button"
            data-testid="sidebar-onboard-harbour-btn"
            onClick={() => setOnboardingOpen(true)}
            className="w-full h-7 px-2.5 rounded-[var(--radius-pill)] bg-[var(--brand-soft)] hover:bg-[var(--brand)] text-[var(--brand-soft-fg)] hover:text-[var(--brand-fg)] text-[11px] font-semibold inline-flex items-center justify-center gap-1 transition-colors cursor-pointer"
          >
            <Plus className="w-3 h-3" />
            Onboard New Harbour
          </button>
        )}
      </div>
    </div>
  );

  if (screenMode === 'login') {
    return (
      <>
        <LoginPortalScreen
          user={user}
          phoneInput={phoneInput}
          onChangePhoneInput={setPhoneInput}
          otpInput={otpInput}
          onChangeOtpInput={setOtpInput}
          devEchoOtp={devEchoOtp}
          authError={authError}
          onDismissAuthError={() => setAuthError(null)}
          authSuccess={authSuccess}
          onDismissAuthSuccess={() => setAuthSuccess(null)}
          onRequestOtp={handleRequestOtp}
          onVerifyOtp={handleVerifyOtp}
          displayedOperators={displayedOperators}
          onPersonaSwitch={handlePersonaSwitch}
          onBackToWorkspace={() => setScreenMode('workspace')}
          onOpenActiveProfile={() => {
            setScreenMode('workspace');
            setProfileDrawerOpen(true);
          }}
          {...(canOnboardTenant
            ? { onOpenOnboarding: () => setOnboardingOpen(true) }
            : {})}
        />
        <TenantOnboardingWizard
          open={onboardingOpen}
          onClose={() => setOnboardingOpen(false)}
          token={token}
          currentUserRole={user?.role ?? null}
          existingTenants={allTenants}
          onProvisionComplete={handleOnboardingComplete}
        />
      </>
    );
  }

  const ShellComponent = docksideMobileLayout ? DocksideShell : AppShell;

  const handleBreadcrumbTenantClick: (() => void) | undefined = allowedWorkspaceIds.has('platform')
    ? () => handleSelectWorkspace('platform')
    : allowedWorkspaceIds.has('harbour')
      ? () => handleSelectWorkspace('harbour')
      : undefined;

  const handleBreadcrumbGroupClick = (groupId: WorkspaceGroup): void => {
    setCommandPaletteInitialScope(groupId);
    setCommandPaletteOpen(true);
  };

  const workspaceTopBar = (
    <div className="flex flex-col gap-3 no-print">
      <WorkspaceBreadcrumbs
        segments={breadcrumbSegments}
        onClickTenant={handleBreadcrumbTenantClick}
        onClickGroup={handleBreadcrumbGroupClick}
      />
      {networkStatus.toast && (
        <div data-testid="network-status-toast">
          <Toast
            tone={networkStatus.toast.tone}
            title={networkStatus.toast.title}
            message={networkStatus.toast.message}
            onDismiss={() => {
              if (networkStatus.status === 'offline') {
                setDismissedOfflineToast(true);
              } else {
                setRecentlyReconnected(false);
              }
            }}
          />
        </div>
      )}
      {exportFeedback && (
        <div data-testid="workspace-export-toast">
          <Toast
            tone="ok"
            title={exportFeedback.title}
            message={exportFeedback.message}
            onDismiss={() => setExportFeedback(null)}
          />
        </div>
      )}
    </div>
  );

  return (
    <ShellComponent
      brandSubtitle={bootstrap?.tenant?.name_en ?? 'Munambam HMS'}
      navItems={navItems}
      activeNavId={activeWorkspace}
      onSelectNav={handleSelectWorkspace}
      lang={lang}
      headerRight={headerControls}
      sidebarHeaderExtra={sidebarTenantSwitcher}
      workspaceTopBar={workspaceTopBar}
      refreshing={bootstrapRefreshing || tenantSwitching}
      refreshingLabel={t('workspaces.syncingData')}
      operatorCard={{
        initials: activeInitials,
        fullName: user?.fullName ?? 'Capt. Mathew Thomas',
        roleBadge: activeRoleMeta.shortBadge,
        phoneE164: user?.phoneE164 ?? '—',
        onOpenProfile: () => {
          setProfileFeedback(null);
          setProfileDrawerOpen(true);
          if (token) void loadOperatorProfile(token);
        },
      }}
    >
      {screenMode === 'gallery' && DevDesignSystemGalleryScreen ? (
        <React.Suspense
          fallback={
            <EmptyState
              title="Loading HarbourOS UI Kit…"
              description="Initializing design system tokens and component gallery."
            />
          }
        >
          <DevDesignSystemGalleryScreen
            docksideMobileLayout={docksideMobileLayout}
            onToggleDocksideLayout={() => setDocksideMobileLayout((prev) => !prev)}
            onOpenOverlayModal={() => setGalleryModalOpen(true)}
            onOpenProfileDrawer={() => setProfileDrawerOpen(true)}
            goldenVectorRows={GOLDEN_VECTOR_ROWS}
          />
        </React.Suspense>
      ) : !bootstrap || !token ? (
        <WorkspaceSkeleton workspace={activeWorkspace} label={t('workspaces.loadingHarbour')} />
      ) : !isActiveWorkspaceAuthorized && user ? (
        <div data-testid="rbac-access-restricted">
          <EmptyState
            title="Access Restricted by Role Policy"
            description={`Your signed-in role (${activeRoleMeta.titleEn}) does not have permission to open the "${activeWorkspace}" workspace.`}
            action={
              <Button
                variant="primary"
                size="sm"
                onClick={() => handleSelectWorkspace(ROLE_DEFAULT_WORKSPACE[user.role])}
              >
                Return to {activeRoleMeta.defaultWorkspace} workspace
              </Button>
            }
          />
        </div>
      ) : (
        <ErrorBoundary
          contextLabel={activeNavLabel}
          title={t('errors.workspaceTitle')}
          description={t('errors.workspaceDescription')}
          retryLabel={t('errors.tryAgain')}
          reloadLabel={t('errors.reloadPage')}
          detailsLabel={t('errors.technicalDetails')}
          resetKeys={[activeWorkspace, user?.userId, screenMode, bootstrap]}
          testId="workspace-error-boundary"
          onReset={() => (token ? loadBootstrap(token) : undefined)}
          secondaryAction={
            user && activeWorkspace !== ROLE_DEFAULT_WORKSPACE[user.role]
              ? {
                  label: t('errors.returnToDefaultWorkspace'),
                  onClick: () => handleSelectWorkspace(ROLE_DEFAULT_WORKSPACE[user.role]),
                }
              : undefined
          }
        >
          <React.Suspense
            fallback={
              <WorkspaceSkeleton workspace={activeWorkspace} label={t('workspaces.loadingWorkspace')} />
            }
          >
            {activeWorkspace === 'weighing' && (
              <WeighingWorkspace
                data={bootstrap}
                token={token}
                loading={personaSwitching}
                refreshing={bootstrapRefreshing}
                browserOnline={isOnline}
                onRefresh={() => loadBootstrap(token)}
              />
            )}
            {activeWorkspace === 'pit' && (
              <PitWorkspace
                data={bootstrap}
                token={token}
                loading={personaSwitching}
                refreshing={bootstrapRefreshing}
                onRefresh={() => loadBootstrap(token)}
              />
            )}
            {activeWorkspace === 'buyer' && (
              <BuyerWorkspace
                data={bootstrap}
                token={token}
                loading={personaSwitching}
                refreshing={bootstrapRefreshing}
                onRefresh={() => loadBootstrap(token)}
              />
            )}
            {activeWorkspace === 'fisher' && (
              <FisherWorkspace
                data={bootstrap}
                loading={personaSwitching}
                refreshing={bootstrapRefreshing}
              />
            )}
            {activeWorkspace === 'inspector' && (
              <InspectorWorkspace
                data={bootstrap}
                token={token}
                loading={personaSwitching}
                refreshing={bootstrapRefreshing}
                onRefresh={() => loadBootstrap(token)}
              />
            )}
            {activeWorkspace === 'harbour' && (
              <HarbourWorkspace
                data={bootstrap}
                token={token}
                loading={personaSwitching}
                refreshing={bootstrapRefreshing}
                onRefresh={() => loadBootstrap(token)}
              />
            )}
            {activeWorkspace === 'platform' && (
              <PlatformWorkspace
                data={bootstrap}
                token={token}
                loading={personaSwitching || tenantSwitching}
                onRefresh={() => loadBootstrap(token)}
                onSwitchTenant={handleSwitchTenant}
                onSwitchRoleDashboard={(role) => handlePersonaSwitch(role)}
                onOpenOnboarding={() => setOnboardingOpen(true)}
              />
            )}
          </React.Suspense>
        </ErrorBoundary>
      )}

      <OperatorProfileDrawer
        open={profileDrawerOpen}
        onClose={() => setProfileDrawerOpen(false)}
        user={user}
        profileTab={profileTab}
        onChangeTab={setProfileTab}
        profileData={profileData}
        profileLoading={profileLoading}
        editFullName={editFullName}
        onChangeFullName={setEditFullName}
        editPhoneE164={editPhoneE164}
        onChangePhoneE164={setEditPhoneE164}
        profileSaving={profileSaving}
        profileFeedback={profileFeedback}
        onDismissFeedback={() => setProfileFeedback(null)}
        onSaveProfile={handleSaveProfile}
        onPersonaSwitch={handlePersonaSwitch}
        onSelectWorkspace={handleSelectWorkspace}
        onOpenFullLoginPortal={() => {
          setProfileDrawerOpen(false);
          setScreenMode('login');
          if (typeof window !== 'undefined') {
            window.history.replaceState({}, '', '/login');
          }
        }}
      />

      {canAccessLedger && (
        <LedgerInspectorDrawer
          open={ledgerDrawerOpen}
          onClose={() => setLedgerDrawerOpen(false)}
          bootstrap={bootstrap}
          token={token}
          goldenVectorRows={GOLDEN_VECTOR_ROWS}
          autoOpenUtrMapperSignal={autoOpenUtrSignal}
          onRefresh={async () => {
            if (token) {
              await Promise.all([
                loadBootstrap(token),
                loadOperatorProfile(token),
              ]);
            }
          }}
        />
      )}

      <CommandPaletteModal
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        bootstrap={bootstrap}
        allowedWorkspaceIds={allowedWorkspaceIds}
        activeWorkspace={activeWorkspace}
        canAccessLedger={canAccessLedger}
        initialScope={commandPaletteInitialScope}
        onExecuteItem={handleExecuteCommandItem}
      />

      <Modal
        open={galleryModalOpen}
        onClose={() => setGalleryModalOpen(false)}
        title="HarbourOS Design System Overlay"
        description="16px radius card surface with --shadow-overlay and pill actions"
        footer={
          <Button variant="primary" onClick={() => setGalleryModalOpen(false)}>
            Done
          </Button>
        }
      >
        <div className="flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-[var(--brand)] shrink-0 mt-0.5" />
          <p className="text-sm text-[var(--text-secondary)]">
            Every interactive control in HarbourOS uses high-contrast <code>var(--border-strong)</code> (3.57:1 on <code>var(--bg-app)</code>) and pill geometry (<code>--radius-pill: 9999px</code>) with zero green tokens anywhere in the codebase.
          </p>
        </div>
      </Modal>
      <TenantOnboardingWizard
        open={onboardingOpen}
        onClose={() => setOnboardingOpen(false)}
        token={token}
        currentUserRole={user?.role ?? null}
        existingTenants={allTenants}
        onProvisionComplete={handleOnboardingComplete}
      />
    </ShellComponent>
  );
};
