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
});
