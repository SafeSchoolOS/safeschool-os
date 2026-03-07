import { test, expect } from '@playwright/test';
import { safeschoolLoginAsAdmin } from '../helpers/auth.js';

test.describe('SafeSchool Door Health', () => {
  test.beforeEach(async ({ page }) => {
    await safeschoolLoginAsAdmin(page);
  });

  test('door status grid is visible on command center', async ({ page }) => {
    // Door status should be part of the command center
    await expect(page.getByText(/door/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test('navigate to door health page', async ({ page }) => {
    await page.getByRole('link', { name: 'Door Health' }).click();
    await expect(page).toHaveURL('/door-health');
    await expect(page.getByText(/door/i).first()).toBeVisible();
  });

  test('door health page shows door statuses', async ({ page }) => {
    await page.goto('/door-health');
    // Should display door entries with status indicators
    await expect(page.locator('text=/LOCKED|UNLOCKED|Online|Offline/i').first()).toBeVisible({ timeout: 10_000 });
  });
});
