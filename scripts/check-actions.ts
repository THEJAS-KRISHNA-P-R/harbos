import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export interface ActionPin {
  readonly file: string;
  readonly line: number;
  readonly raw: string;
  readonly repo: string;
  readonly ref: string;
  readonly versionComment: string | null;
}

const SHA40_RE = /^[0-9a-f]{40}$/;
const USES_RE = /^\s*(?:-\s*)?uses:\s*([^\s#]+)(?:\s*#\s*(\S+))?/;

export function collectWorkflowActionPins(workflowsDir: string): ActionPin[] {
  if (!fs.existsSync(workflowsDir)) {
    throw new Error(`Workflows directory not found: ${workflowsDir}`);
  }
  const files = fs
    .readdirSync(workflowsDir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort();

  const pins: ActionPin[] = [];
  for (const fileName of files) {
    const absPath = path.join(workflowsDir, fileName);
    const relPath = path.relative(process.cwd(), absPath).split(path.sep).join('/');
    const lines = fs.readFileSync(absPath, 'utf8').split('\n');

    for (let idx = 0; idx < lines.length; idx++) {
      const lineText = lines[idx] ?? '';
      if (lineText.trimStart().startsWith('#')) continue;
      const match = USES_RE.exec(lineText);
      if (!match) continue;

      const rawTarget = (match[1] ?? '').replace(/^['"]|['"]$/g, '');
      if (rawTarget.startsWith('./') || rawTarget.startsWith('docker://')) continue;

      const atIdx = rawTarget.indexOf('@');
      if (atIdx === -1) {
        pins.push({
          file: relPath,
          line: idx + 1,
          raw: rawTarget,
          repo: rawTarget,
          ref: '',
          versionComment: match[2] ?? null,
        });
        continue;
      }

      const fullSpec = rawTarget.slice(0, atIdx);
      const ref = rawTarget.slice(atIdx + 1);
      const parts = fullSpec.split('/');
      const repo = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : fullSpec;

      pins.push({
        file: relPath,
        line: idx + 1,
        raw: rawTarget,
        repo,
        ref,
        versionComment: match[2] ?? null,
      });
    }
  }
  return pins;
}

function resolveRemoteTagCommitSha(repo: string, tag: string): string | null {
  const url = `https://github.com/${repo}.git`;
  const output = execFileSync(
    'git',
    ['ls-remote', '--tags', url, `refs/tags/${tag}`, `refs/tags/${tag}^{}`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );

  let directSha: string | null = null;
  let peeledSha: string | null = null;
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [sha, refName] = trimmed.split(/\s+/);
    if (!sha || !refName) continue;
    if (refName === `refs/tags/${tag}^{}`) {
      peeledSha = sha;
    } else if (refName === `refs/tags/${tag}`) {
      directSha = sha;
    }
  }
  return peeledSha ?? directSha;
}

export function verifyActionPins(options?: { offline?: boolean }): {
  passed: boolean;
  checkedCount: number;
  errors: string[];
  details: string[];
} {
  const workflowsDir = path.resolve(process.cwd(), '.github/workflows');
  const pins = collectWorkflowActionPins(workflowsDir);
  const errors: string[] = [];
  const details: string[] = [];
  const remoteCache = new Map<string, string | null>();

  for (const pin of pins) {
    const loc = `${pin.file}:${pin.line}`;
    if (!SHA40_RE.test(pin.ref)) {
      errors.push(`${loc} -> "${pin.raw}" is not pinned to a 40-char commit SHA`);
      continue;
    }
    if (!pin.versionComment || !/^v\d+(?:\.\d+){0,2}$/.test(pin.versionComment)) {
      errors.push(
        `${loc} -> "${pin.raw}" is missing an inline "# vX.Y.Z" version comment`
      );
      continue;
    }

    if (options?.offline) {
      details.push(`OK (syntax) ${loc} ${pin.repo}@${pin.ref} # ${pin.versionComment}`);
      continue;
    }

    const cacheKey = `${pin.repo}@${pin.versionComment}`;
    let expectedSha = remoteCache.get(cacheKey);
    if (expectedSha === undefined) {
      try {
        expectedSha = resolveRemoteTagCommitSha(pin.repo, pin.versionComment);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${loc} -> failed to query ${pin.repo} tag ${pin.versionComment}: ${msg}`);
        continue;
      }
      remoteCache.set(cacheKey, expectedSha);
    }

    if (!expectedSha) {
      errors.push(
        `${loc} -> tag "${pin.versionComment}" not found on https://github.com/${pin.repo}`
      );
      continue;
    }

    if (expectedSha !== pin.ref) {
      errors.push(
        `${loc} -> SHA mismatch for ${pin.repo} ${pin.versionComment}: pinned ${pin.ref}, actual commit is ${expectedSha}`
      );
      continue;
    }

    details.push(`PASS ${loc} ${pin.repo}@${pin.ref} (${pin.versionComment})`);
  }

  return {
    passed: errors.length === 0,
    checkedCount: pins.length,
    errors,
    details,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const offline = process.argv.includes('--offline');
  const res = verifyActionPins({ offline });
  for (const line of res.details) {
    console.log(`[check-actions] ${line}`);
  }
  if (!res.passed) {
    for (const err of res.errors) {
      console.error(`[check-actions] FAIL ${err}`);
    }
    process.exit(1);
  }
  console.log(
    `[check-actions] Verified ${res.checkedCount}/${res.checkedCount} workflow action pins cleanly.`
  );
}
