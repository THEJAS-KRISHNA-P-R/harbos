import React, { useCallback, useEffect, useState } from 'react';
import {
  Globe,
  Layers,
  LogOut,
  CheckCircle2,
  BookOpen,
  Code2,
  Search,
} from 'lucide-react';
import {
  AppShell,
  DocksideShell,
  Button,
  Select,
  Modal,
  EmptyState,
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
  getRoleDisplayMeta,
  resolveGlobalKeyboardShortcut,
  type BootstrapData,
  type CommandPaletteItem,
  type OperatorProfileResponse,
  type OperatorRow,
  type SessionUser,
} from '@web/lib/api.ts';
import { WORKSPACES, type Role, type WorkspaceId } from '@shared/contracts/rbac.ts';
import { WeighingWorkspace } from '@web/workspaces/weighing/index.tsx';
import { PitWorkspace } from '@web/workspaces/pit/index.tsx';
import { BuyerWorkspace } from '@web/workspaces/buyer/index.tsx';
import { FisherWorkspace } from '@web/workspaces/fisher/index.tsx';
import { InspectorWorkspace } from '@web/workspaces/inspector/index.tsx';
import { HarbourWorkspace } from '@web/workspaces/harbour/index.tsx';
import { PlatformWorkspace } from '@web/workspaces/platform/index.tsx';
import {
  LedgerInspectorDrawer,
  type GoldenVectorRow,
} from '@web/app/components/LedgerInspectorDrawer.tsx';
import { OperatorProfileDrawer } from '@web/app/components/OperatorProfileDrawer.tsx';
import { LoginPortalScreen } from '@web/app/components/LoginPortalScreen.tsx';
import { DesignSystemGalleryScreen } from '@web/app/components/DesignSystemGalleryScreen.tsx';
import { CommandPaletteModal } from '@web/app/components/CommandPaletteModal.tsx';

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
  const [lang, setLang] = useState<'en' | 'ml'>('en');
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceId>('harbour');
  const [screenMode, setScreenMode] = useState<'workspace' | 'login' | 'gallery'>(() => {
    if (typeof window !== 'undefined' && window.location.pathname === '/ui') return 'gallery';
    if (typeof window !== 'undefined' && window.location.pathname === '/login') return 'login';
    return 'workspace';
  });
  const [docksideMobileLayout, setDocksideMobileLayout] = useState(false);

  // OTP Login & Operator Registration states
  const [loginTab, setLoginTab] = useState<'otp' | 'register'>('otp');
  const [phoneInput, setPhoneInput] = useState('+919447000006');
  const [otpInput, setOtpInput] = useState('202100');
  const [devEchoOtp, setDevEchoOtp] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSuccess, setAuthSuccess] = useState<string | null>(null);
  const [operatorsList, setOperatorsList] = useState<ReadonlyArray<OperatorRow>>([]);

  // New Operator Registration Form states
  const [regFullName, setRegFullName] = useState('');
  const [regPhone, setRegPhone] = useState('+919447000099');
  const [regRole, setRegRole] = useState<Role>('HARBOUR_ADMIN');
  const [regSubmitting, setRegSubmitting] = useState(false);

  // Drawers & Modals: Ledger Inspector, Operator Profile, Command Palette (⌘K)
  const [ledgerDrawerOpen, setLedgerDrawerOpen] = useState(false);
  const [autoOpenUtrSignal, setAutoOpenUtrSignal] = useState(0);
  const [profileDrawerOpen, setProfileDrawerOpen] = useState(false);
  const [profileTab, setProfileTab] = useState<'identity' | 'switch' | 'session'>('identity');
  const [profileData, setProfileData] = useState<OperatorProfileResponse | null>(null);
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

  const loadBootstrap = useCallback(async (jwt: string): Promise<void> => {
    const data = await apiRequest<BootstrapData>('/api/v1/bootstrap', {
      method: 'GET',
      token: jwt,
    });
    setBootstrap(data);
  }, []);

  const loadOperatorsDirectory = useCallback(async (): Promise<void> => {
    try {
      const res = await apiRequest<{ operators: ReadonlyArray<OperatorRow> }>(
        '/api/v1/auth/operators',
        { method: 'GET' }
      );
      setOperatorsList(res.operators);
    } catch {
      // Fallback to bootstrap.users if available
    }
  }, []);

  const loadOperatorProfile = useCallback(async (jwt: string): Promise<void> => {
    try {
      const res = await apiRequest<OperatorProfileResponse>('/api/v1/auth/profile', {
        method: 'GET',
        token: jwt,
      });
      setProfileData(res);
      setEditFullName(res.profile.full_name);
      setEditPhoneE164(res.profile.phone_e164);
    } catch {
      // Profile endpoint optional fallback
    }
  }, []);

  const handlePersonaSwitch = useCallback(
    async (role: Role): Promise<void> => {
      try {
        const res = await apiRequest<{ accessToken: string; user: SessionUser }>(
          '/api/v1/auth/persona-switch',
          {
            method: 'POST',
            body: { role },
          }
        );
        setToken(res.accessToken);
        setUser(res.user);
        setEditFullName(res.user.fullName);
        setEditPhoneE164(res.user.phoneE164);
        const pathMatch =
          typeof window !== 'undefined'
            ? window.location.pathname.match(/^\/w\/([a-z]+)$/)
            : null;
        if (pathMatch && pathMatch[1]) {
          setActiveWorkspace(pathMatch[1] as WorkspaceId);
        } else {
          setActiveWorkspace(ROLE_DEFAULT_WORKSPACE[res.user.role] ?? 'harbour');
        }
        setScreenMode((prev) => (prev === 'gallery' ? 'gallery' : 'workspace'));
        await Promise.all([
          loadBootstrap(res.accessToken),
          loadOperatorProfile(res.accessToken),
          loadOperatorsDirectory(),
        ]);
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : 'Failed to switch persona');
      }
    },
    [loadBootstrap, loadOperatorProfile, loadOperatorsDirectory]
  );

  useEffect(() => {
    void handlePersonaSwitch('HARBOUR_ADMIN');
  }, [handlePersonaSwitch]);

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
        setCommandPaletteOpen((prev) => !prev);
      } else if (intent.type === 'TOGGLE_LEDGER_DRAWER') {
        e.preventDefault();
        setLedgerDrawerOpen((prev) => !prev);
      } else if (intent.type === 'FOCUS_AUDIT_FILTER') {
        e.preventDefault();
        const filterEl = document.querySelector<HTMLInputElement>(
          '[aria-label="Filter audit logs by action_code or target_id"]'
        );
        filterEl?.focus();
      } else if (intent.type === 'SWITCH_WORKSPACE' && !ledgerDrawerOpen && !commandPaletteOpen && !profileDrawerOpen) {
        const ws = WORKSPACES[intent.workspaceIndex];
        if (ws) {
          e.preventDefault();
          setActiveWorkspace(ws.id);
          setScreenMode('workspace');
          if (typeof window !== 'undefined') {
            window.history.replaceState({}, '', `/w/${ws.id}`);
          }
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [ledgerDrawerOpen, commandPaletteOpen, profileDrawerOpen]);

  const handleRequestOtp = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setAuthError(null);
    setAuthSuccess(null);
    try {
      const res = await apiRequest<{
        status: string;
        phoneE164: string;
        devOtpEcho?: string;
      }>('/api/v1/auth/otp/request', {
        method: 'POST',
        body: { phoneE164: phoneInput },
      });
      if (res.devOtpEcho) {
        setDevEchoOtp(res.devOtpEcho);
        setOtpInput(res.devOtpEcho);
      }
      setAuthSuccess(`6-digit OTP dispatched to ${res.phoneE164}`);
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
      setToken(res.accessToken);
      setUser(res.user);
      setEditFullName(res.user.fullName);
      setEditPhoneE164(res.user.phoneE164);
      setActiveWorkspace(ROLE_DEFAULT_WORKSPACE[res.user.role]);
      setScreenMode('workspace');
      await Promise.all([
        loadBootstrap(res.accessToken),
        loadOperatorProfile(res.accessToken),
        loadOperatorsDirectory(),
      ]);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'OTP verification failed');
    }
  };

  const handleRegisterNewOperator = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setAuthError(null);
    setRegSubmitting(true);
    try {
      const res = await apiRequest<{ accessToken: string; user: SessionUser }>(
        '/api/v1/auth/register-operator',
        {
          method: 'POST',
          body: {
            fullName: regFullName,
            phoneE164: regPhone,
            role: regRole,
            tenantId: bootstrap?.tenant?.tenant_id ?? 'munambam-demo',
          },
        }
      );
      setToken(res.accessToken);
      setUser(res.user);
      setEditFullName(res.user.fullName);
      setEditPhoneE164(res.user.phoneE164);
      setActiveWorkspace(ROLE_DEFAULT_WORKSPACE[res.user.role]);
      setScreenMode('workspace');
      setRegFullName('');
      await Promise.all([
        loadBootstrap(res.accessToken),
        loadOperatorProfile(res.accessToken),
        loadOperatorsDirectory(),
      ]);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Operator registration failed');
    } finally {
      setRegSubmitting(false);
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
      setToken(res.accessToken);
      setUser(res.user);
      await Promise.all([
        loadBootstrap(res.accessToken),
        loadOperatorProfile(res.accessToken),
        loadOperatorsDirectory(),
      ]);
      setProfileFeedback({
        tone: 'ok',
        title: 'Operator Profile Saved to PostgreSQL',
        msg: `Updated core.users record for ${res.user.fullName} (${res.user.phoneE164}) and issued fresh HS256 JWT.`,
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
    if (wsId === 'weighing') return `${bootstrap.lots.length} lots`;
    if (wsId === 'pit') {
      const openCount = bootstrap.lots.filter((l) => l.available_boxes > 0).length;
      return `${openCount} open`;
    }
    if (wsId === 'inspector') return 's.21';
    if (wsId === 'buyer') return '#101';
    if (wsId === 'fisher') return '95%';
    if (wsId === 'harbour') {
      const pendingRev = bootstrap.reversals.filter(
        (r) => r.status === 'PENDING_SECOND_APPROVAL'
      ).length;
      return pendingRev > 0 ? `${pendingRev} key` : 'OK';
    }
    if (wsId === 'platform') return 'Go+PG';
    return undefined;
  };

  const navItems: ReadonlyArray<NavItem> = WORKSPACES.map((w) => ({
    id: w.id,
    labelEn: w.titleEn,
    labelMl: w.titleMl,
    icon: WORKSPACE_ICONS[w.id],
    badge: getWorkspaceBadge(w.id),
    group: WORKSPACE_GROUPS[w.id],
  }));

  const handleSelectWorkspace = (wsId: string): void => {
    const target = wsId as WorkspaceId;
    setActiveWorkspace(target);
    setScreenMode('workspace');
    if (typeof window !== 'undefined') {
      window.history.replaceState({}, '', `/w/${target}`);
    }
  };

  const handleExecuteCommandItem = (item: CommandPaletteItem): void => {
    setCommandPaletteOpen(false);
    if (item.actionType === 'OPEN_WORKSPACE' && item.targetWorkspace) {
      handleSelectWorkspace(item.targetWorkspace);
    } else if (item.actionType === 'OPEN_LEDGER_DRAWER') {
      setLedgerDrawerOpen(true);
    } else if (item.actionType === 'OPEN_UTR_CSV_IMPORT') {
      setLedgerDrawerOpen(true);
      setAutoOpenUtrSignal((n) => n + 1);
    } else if (item.actionType === 'OPEN_PROFILE_DRAWER') {
      setProfileDrawerOpen(true);
      if (token) void loadOperatorProfile(token);
    } else if (item.actionType === 'OPEN_LOGIN') {
      void loadOperatorsDirectory();
      setScreenMode('login');
    } else if (item.actionType === 'OPEN_UI_KIT') {
      setScreenMode('gallery');
    }
  };

  const shortOperatorName = (user?.fullName ?? 'Capt. Mathew Thomas')
    .replace(/\([^)]*\)/g, '')
    .trim();

  const headerControls = (
    <>
      <Button
        variant="outline"
        size="sm"
        icon={<Search className="w-3.5 h-3.5" />}
        onClick={() => setCommandPaletteOpen(true)}
      >
        ⌘K
      </Button>

      <div className="hidden sm:block shrink-0">
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
            { value: 'AUTHORIZED_INSPECTOR', label: 'Role: Inspector s.21' },
            { value: 'SUPER_ADMIN', label: 'Role: Super Admin' },
          ]}
        />
      </div>

      <Button
        variant="primary"
        size="sm"
        icon={<BookOpen className="w-3.5 h-3.5" />}
        onClick={() => setLedgerDrawerOpen(true)}
      >
        Ledger
      </Button>

      <span className="hidden sm:inline-flex shrink-0">
        <Button
          variant="outline"
          size="sm"
          icon={<Globe className="w-3.5 h-3.5" />}
          onClick={() => setLang((prev) => (prev === 'en' ? 'ml' : 'en'))}
        >
          {lang === 'en' ? 'മലയാളം' : 'EN'}
        </Button>
      </span>

      <button
        type="button"
        onClick={() => {
          setProfileFeedback(null);
          setProfileDrawerOpen(true);
          if (token) void loadOperatorProfile(token);
        }}
        title={`${shortOperatorName} (${activeRoleMeta.shortBadge})`}
        aria-label="Open Operator Profile & Session Settings"
        className="h-9 pl-1.5 pr-2.5 rounded-[var(--radius-pill)] bg-[var(--brand-soft)] border border-[var(--navy-200)] hover:border-[var(--brand)] inline-flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
      >
        <span className="w-6 h-6 rounded-[var(--radius-pill)] bg-[var(--brand)] text-[var(--brand-fg)] text-[11px] font-bold font-mono-code inline-flex items-center justify-center shrink-0">
          {activeInitials}
        </span>
        <span className="hidden lg:inline text-xs font-bold text-[var(--brand-soft-fg)] whitespace-nowrap">
          {activeRoleMeta.shortBadge}
        </span>
      </button>
    </>
  );

  const displayedOperators: ReadonlyArray<OperatorRow> =
    operatorsList.length > 0 ? operatorsList : bootstrap?.users ?? [];

  if (screenMode === 'login') {
    return (
      <LoginPortalScreen
        user={user}
        loginTab={loginTab}
        onChangeLoginTab={(tab) => {
          setAuthError(null);
          setAuthSuccess(null);
          setLoginTab(tab);
        }}
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
        regFullName={regFullName}
        onChangeRegFullName={setRegFullName}
        regPhone={regPhone}
        onChangeRegPhone={setRegPhone}
        regRole={regRole}
        onChangeRegRole={setRegRole}
        regSubmitting={regSubmitting}
        onRegisterNewOperator={handleRegisterNewOperator}
        displayedOperators={displayedOperators}
        onPersonaSwitch={handlePersonaSwitch}
        onBackToWorkspace={() => setScreenMode('workspace')}
        onOpenActiveProfile={() => {
          setScreenMode('workspace');
          setProfileDrawerOpen(true);
        }}
      />
    );
  }

  const ShellComponent = docksideMobileLayout ? DocksideShell : AppShell;

  return (
    <ShellComponent
      brandSubtitle={bootstrap?.tenant?.name_en ?? 'Munambam HMS'}
      navItems={navItems}
      activeNavId={activeWorkspace}
      onSelectNav={handleSelectWorkspace}
      lang={lang}
      headerRight={headerControls}
      operatorCard={{
        initials: activeInitials,
        fullName: user?.fullName ?? 'Capt. Mathew Thomas',
        roleBadge: activeRoleMeta.shortBadge,
        phoneE164: user?.phoneE164 ?? '+919447000006',
        onOpenProfile: () => {
          setProfileFeedback(null);
          setProfileDrawerOpen(true);
          if (token) void loadOperatorProfile(token);
        },
      }}
    >
      {screenMode === 'gallery' ? (
        <DesignSystemGalleryScreen
          docksideMobileLayout={docksideMobileLayout}
          onToggleDocksideLayout={() => setDocksideMobileLayout((prev) => !prev)}
          onOpenOverlayModal={() => setGalleryModalOpen(true)}
          onOpenProfileDrawer={() => setProfileDrawerOpen(true)}
          goldenVectorRows={GOLDEN_VECTOR_ROWS}
        />
      ) : !bootstrap || !token ? (
        <EmptyState
          title="Loading HarbourOS Statutory Clearing Engine…"
          description="Initializing Go 1.23 + PostgreSQL 16 and verifying SHA-256 ledger hash chain."
        />
      ) : (
        <>
          {activeWorkspace === 'weighing' && (
            <WeighingWorkspace
              data={bootstrap}
              token={token}
              onRefresh={() => loadBootstrap(token)}
            />
          )}
          {activeWorkspace === 'pit' && (
            <PitWorkspace
              data={bootstrap}
              token={token}
              onRefresh={() => loadBootstrap(token)}
            />
          )}
          {activeWorkspace === 'buyer' && (
            <BuyerWorkspace
              data={bootstrap}
              token={token}
              onRefresh={() => loadBootstrap(token)}
            />
          )}
          {activeWorkspace === 'fisher' && <FisherWorkspace data={bootstrap} />}
          {activeWorkspace === 'inspector' && (
            <InspectorWorkspace
              data={bootstrap}
              token={token}
              onRefresh={() => loadBootstrap(token)}
            />
          )}
          {activeWorkspace === 'harbour' && (
            <HarbourWorkspace
              data={bootstrap}
              token={token}
              onRefresh={() => loadBootstrap(token)}
            />
          )}
          {activeWorkspace === 'platform' && (
            <PlatformWorkspace
              data={bootstrap}
              token={token}
              onRefresh={() => loadBootstrap(token)}
            />
          )}
        </>
      )}

      <OperatorProfileDrawer
        open={profileDrawerOpen}
        onClose={() => setProfileDrawerOpen(false)}
        user={user}
        profileTab={profileTab}
        onChangeTab={setProfileTab}
        profileData={profileData}
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
          void loadOperatorsDirectory();
          setScreenMode('login');
          if (typeof window !== 'undefined') {
            window.history.replaceState({}, '', '/login');
          }
        }}
      />

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

      <CommandPaletteModal
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        bootstrap={bootstrap}
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
    </ShellComponent>
  );
};
