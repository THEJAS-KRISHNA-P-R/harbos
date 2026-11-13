import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { verifyLockfileInSync } from '../../scripts/check-lockfile.ts';

describe('Lockfile Synchronicity Guard (scripts/check-lockfile.ts)', () => {
  it('passes when package.json and package-lock.json match perfectly', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-test-sync-'));
    try {
      const pkgPath = path.join(tmpDir, 'package.json');
      const lockPath = path.join(tmpDir, 'package-lock.json');

      fs.writeFileSync(
        pkgPath,
        JSON.stringify({
          dependencies: { compression: '^1.8.2', express: '^4.21.2' },
          devDependencies: { tsx: '^4.21.0' },
        })
      );

      fs.writeFileSync(
        lockPath,
        JSON.stringify({
          packages: {
            '': {
              dependencies: { compression: '^1.8.2', express: '^4.21.2' },
              devDependencies: { tsx: '^4.21.0' },
            },
          },
        })
      );

      const res = verifyLockfileInSync(pkgPath, lockPath);
      assert.equal(res.ok, true);
      assert.equal(res.errors.length, 0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('fails with specific error when package is missing from lockfile', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-test-missing-'));
    try {
      const pkgPath = path.join(tmpDir, 'package.json');
      const lockPath = path.join(tmpDir, 'package-lock.json');

      fs.writeFileSync(
        pkgPath,
        JSON.stringify({
          dependencies: { compression: '^1.8.2', express: '^4.21.2' },
        })
      );

      fs.writeFileSync(
        lockPath,
        JSON.stringify({
          packages: {
            '': {
              dependencies: { express: '^4.21.2' },
            },
          },
        })
      );

      const res = verifyLockfileInSync(pkgPath, lockPath);
      assert.equal(res.ok, false);
      assert.ok(res.errors.some((e) => e.includes('Package "compression"') && e.includes('MISSING')));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('fails when range or version mismatches', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-test-mismatch-'));
    try {
      const pkgPath = path.join(tmpDir, 'package.json');
      const lockPath = path.join(tmpDir, 'package-lock.json');

      fs.writeFileSync(
        pkgPath,
        JSON.stringify({
          dependencies: { express: '^4.21.2' },
        })
      );

      fs.writeFileSync(
        lockPath,
        JSON.stringify({
          packages: {
            '': {
              dependencies: { express: '^4.20.0' },
            },
          },
        })
      );

      const res = verifyLockfileInSync(pkgPath, lockPath);
      assert.equal(res.ok, false);
      assert.ok(res.errors.some((e) => e.includes('Version mismatch for "express"')));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('fails when lockfile contains extraneous packages not in package.json', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-test-extra-'));
    try {
      const pkgPath = path.join(tmpDir, 'package.json');
      const lockPath = path.join(tmpDir, 'package-lock.json');

      fs.writeFileSync(
        pkgPath,
        JSON.stringify({
          dependencies: { express: '^4.21.2' },
        })
      );

      fs.writeFileSync(
        lockPath,
        JSON.stringify({
          packages: {
            '': {
              dependencies: { express: '^4.21.2', phantom: '^1.0.0' },
            },
          },
        })
      );

      const res = verifyLockfileInSync(pkgPath, lockPath);
      assert.equal(res.ok, false);
      assert.ok(res.errors.some((e) => e.includes('Extraneous package "phantom"')));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
