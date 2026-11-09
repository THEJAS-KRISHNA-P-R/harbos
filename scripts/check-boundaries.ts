import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = process.cwd();
const SRC_DIR = path.join(ROOT_DIR, 'src');

function walkFiles(dir: string, exts: string[]): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(fullPath, exts));
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}

function extractImports(content: string): string[] {
  const imports: string[] = [];
  const regex = /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|import\(['"]([^'"]+)['"]\)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const spec = match[1] ?? match[2];
    if (spec) imports.push(spec);
  }
  return imports;
}

function resolveImportToRelPath(fromFileRel: string, spec: string): string {
  if (spec.startsWith('@shared/')) return path.posix.join('src/shared', spec.slice('@shared/'.length));
  if (spec.startsWith('@server/')) return path.posix.join('src/server', spec.slice('@server/'.length));
  if (spec.startsWith('@web/')) return path.posix.join('src/web', spec.slice('@web/'.length));
  if (spec.startsWith('@/')) return spec.slice('@/'.length);
  if (spec.startsWith('.')) {
    const dir = path.posix.dirname(fromFileRel);
    return path.posix.normalize(path.posix.join(dir, spec));
  }
  return spec;
}

export function checkBoundaries(): { passed: boolean; violations: string[] } {
  const violations: string[] = [];
  const codeFiles = walkFiles(SRC_DIR, ['.ts', '.tsx', '.css']);

  const greenBanRegex = /#(9FE870|8EE05B|163300|E8F8DE|DCF4CF|15803D|F0FDF4|BBF7D0)\b|\b(green|emerald|lime|teal)-[0-9]+/i;
  const hardcodedHexRegex = /#[0-9A-Fa-f]{6}\b/;

  for (const absPath of codeFiles) {
    const relPath = path.relative(ROOT_DIR, absPath).split(path.sep).join('/');
    const content = fs.readFileSync(absPath, 'utf8');

    // §11.3 Rule: Zero green hexes or Tailwind green/emerald/lime/teal classes anywhere in src/
    const greenMatch = greenBanRegex.exec(content);
    if (greenMatch) {
      violations.push(`[§11.3 No-Green Rule] ${relPath} contains banned green token "${greenMatch[0]}"`);
    }

    // §11.3 Rule: Zero hardcoded 6-digit hex colors in src/web/**/*.tsx
    if (relPath.startsWith('src/web/') && relPath.endsWith('.tsx')) {
      const hexMatch = hardcodedHexRegex.exec(content);
      if (hexMatch) {
        violations.push(`[§11.2 Rule 7] ${relPath} contains hardcoded hex "${hexMatch[0]}" (use CSS variables from tokens.css)`);
      }
    }

    if (relPath.endsWith('.css')) continue;

    // §6 Rule 5: process.env is read ONLY in src/server/config.ts
    if (relPath !== 'src/server/config.ts' && /\bprocess\.env\b/.test(content)) {
      violations.push(`[§6 Rule 5] ${relPath} reads process.env directly (allowed only in src/server/config.ts)`);
    }

    // §6 Rule 7: No Math.random in src/shared/domain/** or src/server/modules/**
    if (
      (relPath.startsWith('src/shared/domain/') || relPath.startsWith('src/server/modules/')) &&
      /\bMath\.random\b/.test(content)
    ) {
      violations.push(`[§6 Rule 7] ${relPath} uses Math.random (forbidden in domain and server modules)`);
    }

    const imports = extractImports(content);
    for (const spec of imports) {
      const targetRel = resolveImportToRelPath(relPath, spec);

      // §6 Rule 6: Zero firebase* imports anywhere
      if (spec.startsWith('firebase') || spec.includes('/firebase')) {
        violations.push(`[§6 Rule 6] ${relPath} imports banned firebase dependency "${spec}"`);
      }

      // §6 Rule 6: @google/genai is imported ONLY inside src/server/adapters/llm-gemini.ts
      if (spec === '@google/genai' && relPath !== 'src/server/adapters/llm-gemini.ts') {
        violations.push(`[§6 Rule 6] ${relPath} imports @google/genai outside src/server/adapters/llm-gemini.ts`);
      }

      // §6 Rule 1: @shared/* imports nothing outside @shared/*
      if (relPath.startsWith('src/shared/')) {
        const isInsideShared = targetRel.startsWith('src/shared/');
        if (!isInsideShared) {
          violations.push(`[§6 Rule 1] ${relPath} imports "${spec}" outside src/shared/`);
        }
      }

      // §6 Rule 2: @server/* never imports @web/*; @web/* never imports @server/*
      if (relPath.startsWith('src/server/') && targetRel.startsWith('src/web/')) {
        violations.push(`[§6 Rule 2] Server file ${relPath} imports web module "${spec}"`);
      }
      if (relPath.startsWith('src/web/') && targetRel.startsWith('src/server/')) {
        violations.push(`[§6 Rule 2] Web file ${relPath} imports server module "${spec}"`);
      }

      // §6 Rule 3: src/server/modules/<m>/ may only be imported from outside <m> via its index.ts,
      // and never imports from src/server/adapters/*
      if (relPath.startsWith('src/server/modules/') && targetRel.startsWith('src/server/adapters/')) {
        violations.push(`[§6 Rule 3] Module ${relPath} directly imports adapter "${spec}" (use platform/ports.ts)`);
      }

      if (targetRel.startsWith('src/server/modules/')) {
        const parts = targetRel.split('/');
        const targetModule = parts[3];
        const targetSubpath = parts.slice(4).join('/');
        const callerModule = relPath.startsWith('src/server/modules/') ? relPath.split('/')[3] : null;
        if (targetModule && callerModule !== targetModule) {
          const allowedSubpaths = ['', 'index', 'index.ts', 'index.js'];
          if (!allowedSubpaths.includes(targetSubpath)) {
            violations.push(
              `[§6 Rule 3] ${relPath} imports deep module path "${spec}" of module "${targetModule}" (must import via index.ts)`
            );
          }
        }
      }

      // §6 Rule 4: src/web/workspaces/<w>/ never imports from another workspace <w2>
      if (relPath.startsWith('src/web/workspaces/') && targetRel.startsWith('src/web/workspaces/')) {
        const callerWorkspace = relPath.split('/')[3];
        const targetWorkspace = targetRel.split('/')[3];
        if (callerWorkspace && targetWorkspace && callerWorkspace !== targetWorkspace) {
          violations.push(
            `[§6 Rule 4] Workspace "${callerWorkspace}" (${relPath}) imports from sibling workspace "${targetWorkspace}" ("${spec}")`
          );
        }
      }
    }
  }

  return { passed: violations.length === 0, violations };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(ROOT_DIR, 'scripts/check-boundaries.ts');
if (isMain) {
  const result = checkBoundaries();
  if (!result.passed) {
    console.error('[boundaries] FAILED with violations:');
    for (const v of result.violations) {
      console.error(`  - ${v}`);
    }
    process.exit(1);
  }
  console.log('[boundaries] All §6 architectural boundary and §11.3 visual hygiene rules passed.');
}
