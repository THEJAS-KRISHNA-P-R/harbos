/**
 * Deploy-manifest gate.
 *
 * Why this exists: the Cloud Run manifests once crashed on boot (SMS_PROVIDER defaulted to the
 * production-forbidden `console`; the worker lacked JWT/QR secrets) and nothing in CI noticed because
 * nothing ever started the service from the manifest's own env. This gate does exactly that:
 * it extracts each manifest's env, fills secret references with distinct random values, and imports the
 * real production config loader. If config validation would FATAL in production, this fails in CI.
 *
 * Also enforces Cloud Run-specific rules that Kubernetes habits get wrong.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

interface EnvEntry {
  name: string;
  value?: string;
  secretName?: string;
  secretKey?: string;
}

interface ManifestInfo {
  file: string;
  text: string;
  env: EnvEntry[];
}

const MANIFESTS = ['deploy/cloud-run-web.yaml', 'deploy/cloud-run-worker.yaml'];
let failures = 0;

function fail(file: string, msg: string): void {
  failures += 1;
  console.error(`[check-deploy] FAIL ${file}: ${msg}`);
}
function pass(file: string, msg: string): void {
  console.log(`[check-deploy] PASS ${file}: ${msg}`);
}

function unquote(v: string): string {
  const t = v.trim();
  return t.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}

function parseEnv(text: string): EnvEntry[] {
  const envBlock = text.split(/^\s{10}env:\s*$/m)[1];
  if (!envBlock) return [];
  // The env block ends at the next sibling key of `env:` (probes, resources, ...) at the same indent.
  const body = envBlock.split(/^\s{10}[a-zA-Z]+:\s*/m)[0] ?? '';
  const chunks = body.split(/^\s{12}- name:\s*/m).slice(1);
  return chunks.map((chunk) => {
    const lines = chunk.split('\n');
    const entry: EnvEntry = { name: unquote(lines[0] ?? '') };
    const valueLine = lines.find((l) => /^\s+value:\s*/.test(l));
    if (valueLine) entry.value = unquote(valueLine.replace(/^\s+value:\s*/, ''));
    const secretNameLine = lines.find((l, i) => i > 0 && /^\s+name:\s*/.test(l));
    const secretKeyLine = lines.find((l) => /^\s+key:\s*/.test(l));
    if (secretNameLine) entry.secretName = unquote(secretNameLine.replace(/^\s+name:\s*/, ''));
    if (secretKeyLine) entry.secretKey = unquote(secretKeyLine.replace(/^\s+key:\s*/, ''));
    return entry;
  });
}

function loadManifest(file: string): ManifestInfo {
  const text = readFileSync(file, 'utf8');
  return { file, text, env: parseEnv(text) };
}

function bootEnv(m: ManifestInfo, omit?: string): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '/tmp',
  };
  for (const e of m.env) {
    if (e.name === omit) continue;
    if (e.secretName) {
      env[e.name] = e.name.startsWith('DATABASE')
        ? `postgresql://u:${randomBytes(8).toString('hex')}@127.0.0.1:5432/db`
        : randomBytes(32).toString('hex');
    } else if (e.value !== undefined) {
      env[e.name] = e.value;
    }
  }
  return env;
}

function bootConfig(env: Record<string, string>): { ok: boolean; output: string } {
  const r = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      "await import('./src/server/config.ts'); console.log('CONFIG_OK');",
    ],
    { env, encoding: 'utf8', timeout: 30_000 },
  );
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  return { ok: r.status === 0 && output.includes('CONFIG_OK'), output };
}

const allSecrets = new Set<string>();

for (const file of MANIFESTS) {
  const m = loadManifest(file);

  if (m.env.length === 0) {
    fail(file, 'could not parse any env entries (manifest shape changed? update scripts/check-deploy.ts)');
    continue;
  }

  // Cloud Run rules
  if (m.env.some((e) => e.name === 'PORT')) {
    fail(file, 'env PORT is reserved by Cloud Run; remove it (containerPort is injected as $PORT)');
  } else pass(file, 'does not set reserved PORT');

  const badKeys = m.env.filter((e) => e.secretName && !/^(latest|\d+)$/.test(e.secretKey ?? ''));
  if (badKeys.length > 0) {
    fail(
      file,
      `secretKeyRef.key must be a Secret Manager version ("latest" or a number); bad: ${badKeys
        .map((e) => `${e.name}->${e.secretKey}`)
        .join(', ')}`,
    );
  } else pass(file, 'all secretKeyRef keys are valid Secret Manager versions');

  for (const e of m.env) if (e.secretName) allSecrets.add(e.secretName);

  if (!/image:\s*IMAGE_PLACEHOLDER\s*$/m.test(m.text)) {
    fail(file, 'image must be IMAGE_PLACEHOLDER (deploy workflow injects the SHA-tagged image it built)');
  } else pass(file, 'image is templated');

  if (/--loader/.test(m.text) || !/"--import",\s*"tsx"/.test(m.text)) {
    fail(file, 'command must use `node --import tsx ...` (not the deprecated --loader)');
  } else pass(file, 'uses --import tsx');

  if (!/containerPort:\s*8080/.test(m.text)) fail(file, 'containerPort 8080 missing');
  else pass(file, 'listens on containerPort 8080');

  if (/port:\s*(?!8080\b)\d+/.test(m.text.replace(/containerPort:\s*\d+/g, ''))) {
    fail(file, 'a probe targets a port other than 8080');
  } else pass(file, 'probes target 8080');

  // The real test: would production config accept exactly this env?
  const boot = bootConfig(bootEnv(m));
  if (!boot.ok) {
    fail(file, `production config rejects this manifest's env:\n${boot.output.split('\n').slice(0, 6).join('\n')}`);
  } else pass(file, 'production config boots with exactly this manifest env');

  // Negative control: dropping a required var MUST make boot fail, or this gate is vacuous.
  const control = bootConfig(bootEnv(m, 'JWT_ACCESS_SECRET'));
  if (control.ok) {
    fail(file, 'negative control failed: config booted without JWT_ACCESS_SECRET (gate is not exercising config)');
  } else pass(file, 'negative control (missing JWT_ACCESS_SECRET) correctly fails boot');
}

console.log(
  `[check-deploy] Secret Manager secrets that must exist before deploy (read access for the runtime service account):\n  ${[
    ...allSecrets,
  ]
    .sort()
    .join('\n  ')}`,
);

if (failures > 0) {
  console.error(`[check-deploy] ${failures} failure(s).`);
  process.exit(1);
}
console.log('[check-deploy] All deploy manifest checks passed.');
