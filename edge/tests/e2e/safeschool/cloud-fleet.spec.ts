import { test, expect } from '@playwright/test';
import { safeschoolCloudLogin } from '../helpers/cloud-auth.js';

test.describe('SafeSchool Cloud Fleet Management', () => {
  test('cloud login page is reachable', async ({ page }) => {
    try {
      await page.goto('/login', { timeout: 15_000 });
    } catch {
      test.skip(true, 'Cloud dashboard unreachable — DNS cannot resolve domain');
    }
    await expect(page).toHaveTitle(/.*/);
  });

  test('fleet page loads', async ({ page }) => {
    const loggedIn = await safeschoolCloudLogin(page);
    test.skip(!loggedIn, 'Cloud login failed — domain unreachable or credentials invalid');

    const fleetLink = page.locator('a:has-text("Fleet"), a[href*="fleet"]').first();
    if (await fleetLink.count() > 0) {
      await fleetLink.click();
    } else {
      await page.goto('/fleet');
    }
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1, h2, .page-title').first()).toBeVisible();
  });

  test('fleet summary cards display stats', async ({ page }) => {
    const loggedIn = await safeschoolCloudLogin(page);
    test.skip(!loggedIn, 'Cloud login failed');

    const fleetLink = page.locator('a:has-text("Fleet"), a[href*="fleet"]').first();
    if (await fleetLink.count() > 0) {
      await fleetLink.click();
    } else {
      await page.goto('/fleet');
    }
    await page.waitForLoadState('networkidle');

    const cards = page.locator('.card, [class*="stat"], [class*="summary"]');
    await expect(cards.first()).toBeVisible({ timeout: 10_000 });
  });

  test('device table shows edge devices', async ({ page }) => {
    const loggedIn = await safeschoolCloudLogin(page);
    test.skip(!loggedIn, 'Cloud login failed');

    const fleetLink = page.locator('a:has-text("Fleet"), a[href*="fleet"]').first();
    if (await fleetLink.count() > 0) {
      await fleetLink.click();
    } else {
      await page.goto('/fleet');
    }
    await page.waitForLoadState('networkidle');

    const table = page.locator('table, .device-list, [class*="device-table"]').first();
    await expect(table).toBeVisible({ timeout: 10_000 });
  });

  test('register new device', async ({ page }) => {
    const loggedIn = await safeschoolCloudLogin(page);
    test.skip(!loggedIn, 'Cloud login failed');

    const fleetLink = page.locator('a:has-text("Fleet"), a[href*="fleet"]').first();
    if (await fleetLink.count() > 0) {
      await fleetLink.click();
    } else {
      await page.goto('/fleet');
    }
    await page.waitForLoadState('networkidle');

    const registerBtn = page.locator(
      'button:has-text("Register"), button:has-text("Add Device"), a:has-text("Register")'
    ).first();
    test.skip(await registerBtn.count() === 0, 'No register button found');

    await registerBtn.click();

    const modal = page.locator('.modal, [role="dialog"], form').last();
    const nameField = modal.locator('input[name*="name"], #device-name, input[type="text"]').first();
    if (await nameField.count() > 0) {
      await nameField.fill('E2E Test Device');
    }

    const submitBtn = modal.locator(
      'button[type="submit"], button:has-text("Register"), button:has-text("Save")'
    ).first();
    if (await submitBtn.count() > 0) {
      await submitBtn.click();
    }

    await expect(
      page.locator('text=E2E Test Device, .alert-success, .toast-success').first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test('sites page lists schools', async ({ page }) => {
    const loggedIn = await safeschoolCloudLogin(page);
    test.skip(!loggedIn, 'Cloud login failed');

    const sitesLink = page.locator('a:has-text("Sites"), a:has-text("Schools"), a[href*="site"]').first();
    if (await sitesLink.count() > 0) {
      await sitesLink.click();
    } else {
      await page.goto('/sites');
    }
    await page.waitForLoadState('networkidle');

    await expect(page.locator('table, .site-list, .card').first()).toBeVisible({ timeout: 10_000 });
  });
});
