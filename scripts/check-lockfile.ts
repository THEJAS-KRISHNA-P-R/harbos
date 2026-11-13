#!/usr/bin/env node
/**
 * scripts/check-lockfile.ts
 *
 * Verifies that package.json and package-lock.json are strictly in sync.
 * Zero external dependencies. Enforced as part of `npm run check`, `npm run ci:local`,
 * and CI workflow before `npm ci`.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface LockfileCheckResult {
  ok: boolean;
  errors: string[];
}

export function verifyLockfileInSync(
  packageJsonPath: string,
  packageLockJsonPath: string
): LockfileCheckResult {
  const errors: string[] = [];

  if (!fs.existsSync(packageJsonPath)) {
    return { ok: false, errors: [`Missing package.json at ${packageJsonPath}`] };
  }
  if (!fs.existsSync(packageLockJsonPath)) {
    return { ok: false, errors: [`Missing package-lock.json at ${packageLockJsonPath}`] };
  }

  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const lock = JSON.parse(fs.readFileSync(packageLockJsonPath, 'utf8')) as {
    packages?: Record<
      string,
      {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      }
    >;
    dependencies?: Record<string, unknown>;
  };

  const rootPkg = lock.packages?.[''];
  if (!rootPkg) {
    errors.push('package-lock.json missing root package entry ("packages[\'\']")');
    return { ok: false, errors };
  }

  const checkBucket = (
    bucketName: 'dependencies' | 'devDependencies',
    pkgRecord: Record<string, string> | undefined,
    lockRecord: Record<string, string> | undefined
  ) => {
    const pkgKeys = Object.keys(pkgRecord || {}).sort();
    const lockKeys = Object.keys(lockRecord || {}).sort();

    for (const key of pkgKeys) {
      const expectedVersion = pkgRecord![key];
      if (!lockRecord || !(key in lockRecord)) {
        errors.push(`[${bucketName}] Package "${key}" declared in package.json (${expectedVersion}) is MISSING from package-lock.json`);
      } else if (lockRecord[key] !== expectedVersion) {
        errors.push(
          `[${bucketName}] Version mismatch for "${key}": package.json has "${expectedVersion}", lockfile root has "${lockRecord[key]}"`
        );
      }
    }

    for (const key of lockKeys) {
      if (!pkgRecord || !(key in pkgRecord)) {
        errors.push(
          `[${bucketName}] Extraneous package "${key}" found in package-lock.json root but not declared in package.json`
        );
      }
    }
  };

  checkBucket('dependencies', pkg.dependencies, rootPkg.dependencies);
  checkBucket('devDependencies', pkg.devDependencies, rootPkg.devDependencies);

  return { ok: errors.length === 0, errors };
}

// CLI execution
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('check-lockfile.ts')) {
  const rootDir = process.cwd();
  const pkgPath = path.resolve(rootDir, 'package.json');
  const lockPath = path.resolve(rootDir, 'package-lock.json');

  const result = verifyLockfileInSync(pkgPath, lockPath);
  if (!result.ok) {
    console.error('❌ [check-lockfile] Lockfile is OUT OF SYNC with package.json:');
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
    console.error('\nRun `npm install --package-lock-only` to synchronize package-lock.json before committing.\n');
    process.exit(1);
  } else {
    console.log('✅ [check-lockfile] package.json and package-lock.json are in sync.');
  }
}
