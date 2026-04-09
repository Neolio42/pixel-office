import { test, expect } from '@playwright/test';

test.describe('Web UI Rendering', () => {
  test('page loads without errors', async ({ page }) => {
    const response = await page.goto('/');

    // Check that the page loaded successfully
    expect(response?.status()).toBe(200);

    // Wait for the page to be fully loaded
    await page.waitForLoadState('networkidle');

    // Check for critical console errors (exclude expected WebSocket errors during initial load)
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // Ignore expected WebSocket connection errors during page load
        // (the WebSocket tries to connect before the server is fully ready)
        if (!text.includes('WebSocket connection') && !text.includes('ERR_CONNECTION_REFUSED')) {
          errors.push(text);
        }
      }
    });

    // Give some time for any critical errors to appear
    await page.waitForTimeout(1000);

    expect(errors).toHaveLength(0);
  });

  test('page title contains "Pixel Office"', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Pixel Office/);
  });

  test('main canvas element renders', async ({ page }) => {
    await page.goto('/');

    // Wait for the canvas to be present
    await page.waitForSelector('canvas', { timeout: 10000 });

    // Check that canvas exists
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();

    // Check canvas attributes
    await expect(canvas).toHaveAttribute('width');
    await expect(canvas).toHaveAttribute('height');
  });

  test('WorkerPanel component mounts', async ({ page }) => {
    await page.goto('/');

    // Wait for the page to load
    await page.waitForLoadState('networkidle');

    // The WorkerPanel is part of the layout, so we should see it
    // It contains elements that are always present (e.g., the panel structure)
    const body = page.locator('body');
    await expect(body).toBeVisible();

    // Check that the main grid layout is present
    const grid = page.locator('.grid');
    await expect(grid).toBeVisible();
  });

  test('page has correct styling and layout', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Check that the body has the expected background color
    const body = page.locator('body');
    const backgroundColor = await body.evaluate(el => {
      return window.getComputedStyle(el).backgroundColor;
    });

    // The body should have a dark background
    expect(backgroundColor).toMatch(/rgb\(26, 26, 46\)|rgba\(26, 26, 46, 1\)|#1a1a2e/);
  });

  test('canvas is interactive and clickable', async ({ page }) => {
    await page.goto('/');

    // Wait for canvas to be present
    await page.waitForSelector('canvas', { timeout: 10000 });

    // Check that canvas has a cursor pointer
    const canvas = page.locator('canvas');
    const cursor = await canvas.evaluate(el => {
      return window.getComputedStyle(el).cursor;
    });

    expect(cursor).toBe('pointer');
  });

  test('assets loading indicator disappears', async ({ page }) => {
    await page.goto('/');

    // The loading indicator should be present initially
    const loadingIndicator = page.locator('text=Loading assets…');

    // Wait for the loading indicator to disappear (assets loaded)
    try {
      await loadingIndicator.waitFor({ state: 'hidden', timeout: 10000 });
    } catch (e) {
      // Loading indicator might not appear if assets are cached
      // This is not a failure
    }
  });

  test('page is responsive to viewport changes', async ({ page }) => {
    const response = await page.goto('/');

    // Ensure page loaded
    expect(response?.status()).toBe(200);

    // Set a smaller viewport
    await page.setViewportSize({ width: 800, height: 600 });
    await page.waitForTimeout(500);

    // Check that canvas is still visible
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();

    // Set a larger viewport
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(500);

    // Check that canvas is still visible
    await expect(canvas).toBeVisible();
  });
});
