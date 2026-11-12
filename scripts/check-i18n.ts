import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  let keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'meta') continue;
    const full = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      keys = keys.concat(flattenKeys(v as Record<string, unknown>, full));
    } else {
      keys.push(full);
    }
  }
  return keys;
}

function checkI18n(): void {
  const enPath = path.resolve(process.cwd(), 'src/web/i18n/en.json');
  const mlPath = path.resolve(process.cwd(), 'src/web/i18n/ml.json');

  assert.ok(fs.existsSync(enPath), 'src/web/i18n/en.json must exist');
  assert.ok(fs.existsSync(mlPath), 'src/web/i18n/ml.json must exist');

  const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));
  const ml = JSON.parse(fs.readFileSync(mlPath, 'utf8'));

  const enKeys = new Set(flattenKeys(en));
  const mlKeys = new Set(flattenKeys(ml));

  const missingInMl = [...enKeys].filter((k) => !mlKeys.has(k));
  const extraInMl = [...mlKeys].filter((k) => !enKeys.has(k));

  if (missingInMl.length > 0 || extraInMl.length > 0) {
    console.error('[check-i18n] FAIL: Key parity mismatch between en.json and ml.json');
    if (missingInMl.length > 0) console.error('  Missing in ml.json:', missingInMl);
    if (extraInMl.length > 0) console.error('  Extra in ml.json:', extraInMl);
    process.exit(1);
  }

  assert.equal(ml.meta?.reviewStatus, '// NEEDS-NATIVE-REVIEW', 'ml.json meta.reviewStatus must be // NEEDS-NATIVE-REVIEW');
  console.log(`[check-i18n] PASS: 100% key parity verified (${enKeys.size} keys between en.json and ml.json).`);
}

checkI18n();
