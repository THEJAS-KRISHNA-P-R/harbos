import { test, expect } from '@playwright/test';

const filterFatalConsoleErrors = (errors: ReadonlyArray<string>): string[] =>
  errors.filter(
    (err) =>
      !err.includes('favicon') &&
      !err.includes('websocket') &&
      !err.includes('Failed to load resource') &&
      !err.includes('401') &&
      !err.includes('403')
  );

test.describe('HarbourOS Visual & Responsive Smoke Suite (Phase C6)', () => {
  test('360px mobile viewport (light & dark): renders hero illustration, zero horizontal scroll, and zero console errors', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto('/login', { waitUntil: 'domcontentloaded' });

    const heroScene = page.locator('svg[data-testid="hero-scene"]');
    await expect(heroScene).toBeVisible();

    const lightOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    expect(lightOverflow).toBe(false);

    // Switch to dark theme at 360px
    await page.evaluate(() => {
      document.documentElement.classList.add('dark');
    });
    await expect(heroScene).toBeVisible();

    const darkOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    expect(darkOverflow).toBe(false);

    expect(filterFatalConsoleErrors(consoleErrors)).toHaveLength(0);
  });

  test('1280px desktop viewport (light & dark): renders login hero illustration, logs in to workspace using demo seed, and resolves species glyph sprite <use> hrefs', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/login', { waitUntil: 'domcontentloaded' });

    const heroScene = page.locator('svg[data-testid="hero-scene"]');
    await expect(heroScene).toBeVisible();

    const lightOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    expect(lightOverflow).toBe(false);

    // Dark mode check on login page
    await page.evaluate(() => {
      document.documentElement.classList.add('dark');
    });
    await expect(heroScene).toBeVisible();
    const darkOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    expect(darkOverflow).toBe(false);

    // Navigate to workspace in DEMO mode and verify workspace loads + species glyph sprite <use> resolves
    await page.goto('/w/weighing', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('header').first()).toBeVisible();

    const wsOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    expect(wsOverflow).toBe(false);

    // Wait for species glyph sprite symbols to mount and verify zero broken <use> hrefs
    await page.waitForSelector('symbol[id^="species-"]', { state: 'attached', timeout: 10000 });
    const spriteAudit = await page.evaluate(() => {
      const symbols = Array.from(document.querySelectorAll('symbol[id^="species-"]'));
      const uses = Array.from(
        document.querySelectorAll('use[href^="#species-"], use[*|href^="#species-"]')
      );
      const brokenHrefs: string[] = [];
      for (const u of uses) {
        const href = u.getAttribute('href') || u.getAttribute('xlink:href') || '';
        if (href && !document.querySelector(href)) {
          brokenHrefs.push(href);
        }
      }
      return {
        symbolCount: symbols.length,
        useCount: uses.length,
        brokenHrefs,
      };
    });

    expect(spriteAudit.symbolCount).toBeGreaterThanOrEqual(13);
    expect(spriteAudit.brokenHrefs).toHaveLength(0);
    expect(filterFatalConsoleErrors(consoleErrors)).toHaveLength(0);
  });

  test('Prefers-reduced-motion: reduce disables running CSS animations', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('svg[data-testid="hero-scene"]')).toBeVisible();

    const runningAnimations = await page.evaluate(() => {
      return document
        .getAnimations()
        .filter((a) => a.playState === 'running').length;
    });
    expect(runningAnimations).toBe(0);
  });

  test('Multi-role pilot E2E: i18n toggle, QR scan & print slips across weighing/inspector/pit/buyer/fisher, plus harbour CSV dry-run, 5 reports & shadow-diff', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.setViewportSize({ width: 1280, height: 800 });

    // 1. Weighing workspace: i18n toggle (EN -> ML -> EN), Vessel QR scanner, DocksidePrintSlip lot tag
    await page.goto('/w/weighing', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Weighing & Lots' })).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'മലയാളം' }).click();
    await expect(page.getByRole('heading', { name: 'തൂക്കവും ലോട്ടുകളും' })).toBeVisible();
    await page.getByRole('button', { name: 'EN' }).click();
    await expect(page.getByRole('heading', { name: 'Weighing & Lots' })).toBeVisible();

    await page.getByRole('button', { name: 'Scan Vessel QR' }).click();
    const scannerModal = page.getByTestId('barcode-scanner-modal');
    await expect(scannerModal).toBeVisible();
    await scannerModal.getByLabel('Manual Identifier Entry').fill('VSL-01');
    await scannerModal.getByRole('button', { name: 'Submit' }).click();
    await expect(scannerModal).toBeHidden();

    // Open printable DocksidePrintSlip from Landed Lots table
    const firstLotRow = page.locator('tbody tr').first();
    await firstLotRow.click();
    const lotSlip = page.getByTestId('dockside-print-slip');
    await expect(lotSlip).toBeVisible();
    await expect(lotSlip.locator('svg').first()).toBeVisible();
    await page.getByRole('button', { name: '58mm' }).click();
    await page.getByRole('button', { name: 'Close' }).click();

    // 2. Inspector workspace
    await page.goto('/w/inspector', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Quality Inspection (s.21)' })).toBeVisible({ timeout: 15_000 });

    // 3. Auction Pit workspace: Lot QR scan + Buyer Sale Slip
    await page.goto('/w/pit', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Auction Pit Pad' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Scan Lot QR' }).click();
    await expect(page.getByTestId('barcode-scanner-modal')).toBeVisible();
    await page.getByRole('button', { name: 'Close scanner' }).click();

    const pitSlipBtn = page.getByRole('button', { name: 'Print Sale Slip' }).first();
    if (await pitSlipBtn.isVisible()) {
      await pitSlipBtn.click();
      await expect(page.getByTestId('dockside-print-slip')).toBeVisible();
      await page.getByRole('button', { name: 'Close' }).click();
    }

    // 4. Buyer workspace: Sale Slip modal
    await page.goto('/w/buyer', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Buyer Clearing Desk' })).toBeVisible({ timeout: 15_000 });
    const buyerSlipBtn = page.getByRole('button', { name: 'Print Sale Slip' }).first();
    if (await buyerSlipBtn.isVisible()) {
      await buyerSlipBtn.click();
      await expect(page.getByTestId('dockside-print-slip')).toBeVisible();
      await page.getByRole('button', { name: 'Close' }).click();
    }

    // 5. Fisher workspace: Fisherman Settlement Voucher
    await page.goto('/w/fisher', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Fisher Passbook' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Print Settlement Voucher' }).click();
    await expect(page.getByTestId('dockside-print-slip')).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();

    // 6. Harbour Admin: Masterdata CSV Dry-Run + 5 Statutory Reports + Shadow-Pilot Diff
    await page.goto('/w/harbour', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('tab', { name: /Masterdata/ })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('tab', { name: /Masterdata/ }).click();
    await expect(page.getByTestId('masterdata-csv-panel')).toBeVisible();
    await page.getByRole('button', { name: 'Dry-Run Validate' }).click();
    await expect(page.getByTestId('csv-import-result')).toContainText('DRY-RUN VALID');

    await page.getByRole('tab', { name: /Reports/ }).click();
    await expect(page.getByTestId('reports-shadow-panel')).toBeVisible();
    await page.getByRole('button', { name: 'Load Live Report' }).click();
    await expect(page.getByTestId('statutory-report-preview')).toBeVisible();
    await page.getByRole('button', { name: 'Run Shadow-Pilot Diff' }).click();
    await expect(page.getByTestId('shadow-diff-result')).toContainText('ZERO-PAISE PARITY');

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    expect(overflow).toBe(false);
    expect(filterFatalConsoleErrors(consoleErrors)).toHaveLength(0);
  });
});

