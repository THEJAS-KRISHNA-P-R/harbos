import fs from 'node:fs';
import path from 'node:path';

const TOKENS_PATH = path.resolve(process.cwd(), 'src/web/ui/tokens.css');

export function parseTokensCss(cssContent: string): Record<string, string> {
  const rawVars: Record<string, string> = {};
  const varRegex = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let match: RegExpExecArray | null;
  while ((match = varRegex.exec(cssContent)) !== null) {
    const key = match[1]?.trim();
    const val = match[2]?.trim();
    if (key && val) {
      rawVars[key] = val;
    }
  }

  const resolved: Record<string, string> = {};
  for (const [key, val] of Object.entries(rawVars)) {
    let current = val;
    let depth = 0;
    while (current.startsWith('var(') && depth < 10) {
      const refName = current.slice(4, -1).trim();
      const target = rawVars[refName];
      if (!target) break;
      current = target;
      depth++;
    }
    resolved[key] = current;
  }
  return resolved;
}

export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace(/^#/, '').trim();
  if (!/^[0-9A-Fa-f]{6}$/.test(clean)) {
    throw new Error(`Invalid 6-digit hex color: ${hex}`);
  }
  const num = parseInt(clean, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

export function relativeLuminance([r, g, b]: [number, number, number]): number {
  const toLinear = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function contrastRatio(hexA: string, hexB: string): number {
  const lumA = relativeLuminance(hexToRgb(hexA));
  const lumB = relativeLuminance(hexToRgb(hexB));
  const brightest = Math.max(lumA, lumB);
  const darkest = Math.min(lumA, lumB);
  return (brightest + 0.05) / (darkest + 0.05);
}

interface ContrastPairCheck {
  label: string;
  fgToken: string;
  bgToken: string;
  minRatio: number;
  standard: 'WCAG AA Text (4.5:1)' | 'WCAG Non-Text (3.0:1)';
}

const REQUIRED_CHECKS: ContrastPairCheck[] = [
  { label: 'text-primary on bg-app', fgToken: '--text-primary', bgToken: '--bg-app', minRatio: 4.5, standard: 'WCAG AA Text (4.5:1)' },
  { label: 'text-primary on bg-surface', fgToken: '--text-primary', bgToken: '--bg-surface', minRatio: 4.5, standard: 'WCAG AA Text (4.5:1)' },
  { label: 'text-primary on bg-sunken', fgToken: '--text-primary', bgToken: '--bg-sunken', minRatio: 4.5, standard: 'WCAG AA Text (4.5:1)' },
  { label: 'text-secondary on bg-app', fgToken: '--text-secondary', bgToken: '--bg-app', minRatio: 4.5, standard: 'WCAG AA Text (4.5:1)' },
  { label: 'text-secondary on bg-surface', fgToken: '--text-secondary', bgToken: '--bg-surface', minRatio: 4.5, standard: 'WCAG AA Text (4.5:1)' },
  { label: 'text-muted on bg-app', fgToken: '--text-muted', bgToken: '--bg-app', minRatio: 4.5, standard: 'WCAG AA Text (4.5:1)' },
  { label: 'text-muted on bg-surface', fgToken: '--text-muted', bgToken: '--bg-surface', minRatio: 4.5, standard: 'WCAG AA Text (4.5:1)' },
  { label: 'brand-fg on brand', fgToken: '--brand-fg', bgToken: '--brand', minRatio: 4.5, standard: 'WCAG AA Text (4.5:1)' },
  { label: 'brand-fg on brand-hover', fgToken: '--brand-fg', bgToken: '--brand-hover', minRatio: 4.5, standard: 'WCAG AA Text (4.5:1)' },
  { label: 'brand-soft-fg on brand-soft', fgToken: '--brand-soft-fg', bgToken: '--brand-soft', minRatio: 4.5, standard: 'WCAG AA Text (4.5:1)' },
  { label: 'danger-fg on danger-bg', fgToken: '--danger-fg', bgToken: '--danger-bg', minRatio: 4.5, standard: 'WCAG AA Text (4.5:1)' },
  { label: 'danger on danger-bg', fgToken: '--danger', bgToken: '--danger-bg', minRatio: 4.5, standard: 'WCAG AA Text (4.5:1)' },
  { label: 'warning on warning-bg', fgToken: '--warning', bgToken: '--warning-bg', minRatio: 4.5, standard: 'WCAG AA Text (4.5:1)' },
  { label: 'info on info-bg', fgToken: '--info', bgToken: '--info-bg', minRatio: 4.5, standard: 'WCAG AA Text (4.5:1)' },
  { label: 'border-strong on bg-app', fgToken: '--border-strong', bgToken: '--bg-app', minRatio: 3.0, standard: 'WCAG Non-Text (3.0:1)' },
  { label: 'border-strong on bg-surface', fgToken: '--border-strong', bgToken: '--bg-surface', minRatio: 3.0, standard: 'WCAG Non-Text (3.0:1)' },
  { label: 'focus on bg-app', fgToken: '--focus', bgToken: '--bg-app', minRatio: 3.0, standard: 'WCAG Non-Text (3.0:1)' },
];

export function runContrastAudit(): { passed: boolean; failures: string[] } {
  if (!fs.existsSync(TOKENS_PATH)) {
    return { passed: false, failures: [`Missing token file: ${TOKENS_PATH}`] };
  }
  const css = fs.readFileSync(TOKENS_PATH, 'utf8');
  const tokens = parseTokensCss(css);
  const failures: string[] = [];

  for (const check of REQUIRED_CHECKS) {
    const fg = tokens[check.fgToken];
    const bg = tokens[check.bgToken];
    if (!fg || !bg) {
      failures.push(`Missing token for check "${check.label}": ${check.fgToken}=${String(fg)}, ${check.bgToken}=${String(bg)}`);
      continue;
    }
    const ratio = contrastRatio(fg, bg);
    const rounded = ratio.toFixed(2);
    const ok = ratio >= check.minRatio;
    console.log(
      `[contrast] ${ok ? 'PASS' : 'FAIL'} | ${check.label.padEnd(28)} | ${fg} on ${bg} | ${rounded}:1 (min ${check.minRatio.toFixed(1)}:1 - ${check.standard})`
    );
    if (!ok) {
      failures.push(`${check.label} (${fg} on ${bg}) achieved ${rounded}:1, below required ${check.minRatio}:1`);
    }
  }

  return { passed: failures.length === 0, failures };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(process.cwd(), 'scripts/check-contrast.ts');
if (isMain) {
  const result = runContrastAudit();
  if (!result.passed) {
    console.error('\n[contrast] FAILED:', result.failures);
    process.exit(1);
  }
  console.log('\n[contrast] All 17 WCAG 2.1 token contrast checks passed.');
}
