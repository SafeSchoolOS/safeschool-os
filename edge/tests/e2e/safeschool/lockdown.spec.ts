import { test, expect } from '@playwright/test';
import { safeschoolLoginAsAdmin } from '../helpers/auth.js';

test.describe('SafeSchool Lockdown', () => {
  test.beforeEach(async ({ page }) => {
    await safeschoolLoginAsAdmin(page);
  });

  test('lockdown controls panel is visible on command center', async ({ page }) => {
    await expect(page.getByText('Lockdown Controls')).toBeVisible();
  });

  test('full site lockdown button is present', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Full Site Lockdown' })).toBeVisible();
  });

  test('initiate and release lockdown', async ({ page }) => {
    // Initiate lockdown
    await page.getByRole('button', { name: 'Full Site Lockdown' }).click();

    // Should show active lockdown indicator
    await expect(page.getByText(/ACTIVE/i)).toBeVisible({ timeout: 5_000 });

    // Release lockdown
    const releaseBtn = page.getByRole('button', { name: 'Release' });
    if (await releaseBtn.isVisible()) {
      await releaseBtn.click();
      // ACTIVE count should change
      await expect(page.getByText(/0 ACTIVE/i)).toBeVisible({ timeout: 5_000 });
    }
  });
});
