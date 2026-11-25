import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVE_WORKSPACE_STORAGE_KEY,
  clearStoredSession,
  extractWorkspaceFromPathname,
  isPlausibleJwt,
  isValidWorkspaceId,
  persistStoredJwt,
  persistStoredWorkspace,
  readStoredJwt,
  readStoredWorkspace,
  resolveRehydratedWorkspace,
  SESSION_JWT_STORAGE_KEY,
  type StorageLike,
} from '../../src/web/lib/session-storage.ts';

function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

const SAMPLE_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJVU1ItMDEiLCJyb2xlIjoiU1VQRVJfQURNSU4ifQ.signature_part_12345';

test('JWT persistence validates 3-segment JWT shape and clears on null or malformed input', () => {
  const storage = createMemoryStorage();
  assert.equal(isPlausibleJwt(SAMPLE_JWT), true);
  assert.equal(isPlausibleJwt('not-a-jwt'), false);
  assert.equal(isPlausibleJwt(''), false);

  persistStoredJwt(storage, SAMPLE_JWT);
  assert.equal(readStoredJwt(storage), SAMPLE_JWT);

  persistStoredJwt(storage, null);
  assert.equal(readStoredJwt(storage), null);

  storage.setItem(SESSION_JWT_STORAGE_KEY, 'corrupted-value');
  assert.equal(readStoredJwt(storage), null);
});

test('workspace persistence strictly validates WorkspaceId allowlist', () => {
  const storage = createMemoryStorage();
  assert.equal(isValidWorkspaceId('buyer'), true);
  assert.equal(isValidWorkspaceId('unknown-route'), false);

  persistStoredWorkspace(storage, 'buyer');
  assert.equal(readStoredWorkspace(storage), 'buyer');

  storage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, 'javascript:alert(1)');
  assert.equal(readStoredWorkspace(storage), null);

  persistStoredJwt(storage, SAMPLE_JWT);
  persistStoredWorkspace(storage, 'fisher');
  clearStoredSession(storage, { clearWorkspace: false });
  assert.equal(readStoredJwt(storage), null);
  assert.equal(readStoredWorkspace(storage), 'fisher');

  clearStoredSession(storage, { clearWorkspace: true });
  assert.equal(readStoredWorkspace(storage), null);
});

test('resolveRehydratedWorkspace prioritizes authorized deep link, then authorized stored workspace, then role default', () => {
  assert.equal(extractWorkspaceFromPathname('/w/inspector'), 'inspector');
  assert.equal(extractWorkspaceFromPathname('/w/invalid'), null);
  assert.equal(extractWorkspaceFromPathname('/'), null);

  // Explicit deep link overrides stored workspace when authorized
  assert.equal(
    resolveRehydratedWorkspace({
      pathname: '/w/pit',
      storedWorkspace: 'buyer',
      role: 'SUPER_ADMIN',
      roleDefaultWorkspace: 'platform',
    }),
    'pit'
  );

  // Stored workspace restored on root path when authorized
  assert.equal(
    resolveRehydratedWorkspace({
      pathname: '/',
      storedWorkspace: 'buyer',
      role: 'SUPER_ADMIN',
      roleDefaultWorkspace: 'platform',
    }),
    'buyer'
  );

  // Unauthorized stored workspace safely falls back to role default
  assert.equal(
    resolveRehydratedWorkspace({
      pathname: '/',
      storedWorkspace: 'platform',
      role: 'WEIGHING_OPERATOR',
      roleDefaultWorkspace: 'weighing',
    }),
    'weighing'
  );
});

test('storage helpers never throw when localStorage access throws', () => {
  const brokenStorage: StorageLike = {
    getItem: () => {
      throw new Error('SecurityError');
    },
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
    removeItem: () => {
      throw new Error('SecurityError');
    },
  };

  assert.equal(readStoredJwt(brokenStorage), null);
  assert.equal(readStoredWorkspace(brokenStorage), null);
  assert.doesNotThrow(() => persistStoredJwt(brokenStorage, SAMPLE_JWT));
  assert.doesNotThrow(() => persistStoredWorkspace(brokenStorage, 'harbour'));
  assert.doesNotThrow(() => clearStoredSession(brokenStorage, { clearWorkspace: true }));
});
