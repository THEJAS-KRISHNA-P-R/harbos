import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const DIST_DIR = path.resolve(process.cwd(), 'dist');

const BUDGET_LIMITS = {
  maxTotalDistBytes: 1_536_000, // 1.5 MB
  maxRasterBytes: 40_960, // 40 KB (.png, .jpg, .jpeg, .webp)
  maxFontsBytes: 256_000, // 250 KB (.woff, .woff2, .ttf)
  maxInitialEntryJsGzipBytes: 153_600, // 150 KB gzip
  maxSingleJsChunkRawBytes: 358_400, // 350 KB raw
} as const;

interface FileStatEntry {
  relPath: string;
  absPath: string;
  bytes: number;
}

function walkFiles(dir: string, baseDir = dir): FileStatEntry[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const results: FileStatEntry[] = [];
  for (const entry of entries) {
    const absPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(absPath, baseDir));
    } else if (entry.isFile()) {
      const stat = fs.statSync(absPath);
      results.push({
        relPath: path.relative(baseDir, absPath).replace(/\\/g, '/'),
        absPath,
        bytes: stat.size,
      });
    }
  }
  return results;
}

function formatKb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function runBudgetAudit(): { passed: boolean; failures: string[] } {
  if (!fs.existsSync(DIST_DIR)) {
    return {
      passed: false,
      failures: [`Missing build directory: ${DIST_DIR}. Run "npm run build" first.`],
    };
  }

  const allFiles = walkFiles(DIST_DIR);
  const failures: string[] = [];

  const totalDistBytes = allFiles.reduce((acc, f) => acc + f.bytes, 0);
  const rasterFiles = allFiles.filter((f) => /\.(png|jpe?g|webp)$/i.test(f.relPath));
  const rasterBytes = rasterFiles.reduce((acc, f) => acc + f.bytes, 0);

  const fontFiles = allFiles.filter((f) => /\.(woff2?|ttf|otf)$/i.test(f.relPath));
  const fontBytes = fontFiles.reduce((acc, f) => acc + f.bytes, 0);

  const jsFiles = allFiles.filter((f) => /\.m?js$/i.test(f.relPath));

  // Locate initial entry JS referenced by dist/index.html
  let initialEntryJsGzipBytes = 0;
  let initialEntryRelPath = 'N/A';
  const indexHtmlPath = path.join(DIST_DIR, 'index.html');
  if (fs.existsSync(indexHtmlPath)) {
    const html = fs.readFileSync(indexHtmlPath, 'utf8');
    const scriptMatch = html.match(/<script[^>]+src=["']\/?([^"']+\.js)["']/i);
    if (scriptMatch?.[1]) {
      initialEntryRelPath = scriptMatch[1].replace(/^\//, '');
      const entryAbs = path.join(DIST_DIR, initialEntryRelPath);
      if (fs.existsSync(entryAbs)) {
        const raw = fs.readFileSync(entryAbs);
        initialEntryJsGzipBytes = zlib.gzipSync(raw).length;
      }
    }
  }

  let largestJsChunk: FileStatEntry | undefined;
  for (const js of jsFiles) {
    if (!largestJsChunk || js.bytes > largestJsChunk.bytes) {
      largestJsChunk = js;
    }
    if (js.bytes > BUDGET_LIMITS.maxSingleJsChunkRawBytes) {
      failures.push(
        `JS chunk "${js.relPath}" is ${formatKb(js.bytes)} raw (limit ${formatKb(BUDGET_LIMITS.maxSingleJsChunkRawBytes)})`
      );
    }
  }

  if (totalDistBytes > BUDGET_LIMITS.maxTotalDistBytes) {
    failures.push(
      `Total dist/ size is ${formatKb(totalDistBytes)} (limit ${formatKb(BUDGET_LIMITS.maxTotalDistBytes)})`
    );
  }
  if (rasterBytes > BUDGET_LIMITS.maxRasterBytes) {
    failures.push(
      `Raster assets total ${formatKb(rasterBytes)} (limit ${formatKb(BUDGET_LIMITS.maxRasterBytes)})`
    );
  }
  if (fontBytes > BUDGET_LIMITS.maxFontsBytes) {
    failures.push(
      `Font assets total ${formatKb(fontBytes)} (limit ${formatKb(BUDGET_LIMITS.maxFontsBytes)})`
    );
  }
  if (initialEntryJsGzipBytes > BUDGET_LIMITS.maxInitialEntryJsGzipBytes) {
    failures.push(
      `Initial entry JS (${initialEntryRelPath}) is ${formatKb(initialEntryJsGzipBytes)} gzip (limit ${formatKb(BUDGET_LIMITS.maxInitialEntryJsGzipBytes)})`
    );
  }

  console.log(`[budget] Total dist/ size      : ${formatKb(totalDistBytes).padStart(9)} / ${formatKb(BUDGET_LIMITS.maxTotalDistBytes)}`);
  console.log(`[budget] Raster images (.jpg/.png): ${formatKb(rasterBytes).padStart(9)} / ${formatKb(BUDGET_LIMITS.maxRasterBytes)} (${rasterFiles.length} files)`);
  console.log(`[budget] Bundled fonts (.woff2): ${formatKb(fontBytes).padStart(9)} / ${formatKb(BUDGET_LIMITS.maxFontsBytes)} (${fontFiles.length} files)`);
  console.log(`[budget] Initial entry JS gzip : ${formatKb(initialEntryJsGzipBytes).padStart(9)} / ${formatKb(BUDGET_LIMITS.maxInitialEntryJsGzipBytes)} (${initialEntryRelPath})`);
  console.log(
    `[budget] Largest JS chunk raw  : ${formatKb(largestJsChunk?.bytes ?? 0).padStart(9)} / ${formatKb(BUDGET_LIMITS.maxSingleJsChunkRawBytes)} (${largestJsChunk?.relPath ?? 'none'})`
  );

  return { passed: failures.length === 0, failures };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(process.cwd(), 'scripts/check-budget.ts');

if (isMain) {
  const result = runBudgetAudit();
  if (!result.passed) {
    console.error('\n[budget] FAILED:', result.failures);
    process.exit(1);
  }
  console.log('\n[budget] All 5 production bundle budget gates passed.');
}
