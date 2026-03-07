import { test, expect } from '@playwright/test';
import { safeschoolLoginAsAdmin } from '../helpers/auth.js';

test.describe('SafeSchool Command Center', () => {
  test.beforeEach(async ({ page }) => {
    await safeschoolLoginAsAdmin(page);
  });

  test('loads command center as default page', async ({ page }) => {
    await expect(page).toHaveURL('/');
    await expect(page.getByText('Command Center')).toBeVisible();
  });

  test('displays emergency action buttons', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'PANIC' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'LOCKDOWN' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'MEDICAL' })).toBeVisible();
  });

  test('PANIC button requires two-step confirmation', async ({ page }) => {
    const panicBtn = page.getByRole('button', { name: 'PANIC' });
    await panicBtn.click();

    // After first click, should show confirm state
    await expect(page.getByRole('button', { name: 'CONFIRM PANIC' })).toBeVisible();

    // Wait for auto-cancel (5s timeout)
    await expect(page.getByRole('button', { name: 'PANIC' })).toBeVisible({ timeout: 7_000 });
  });

  test('displays door status grid', async ({ page }) => {
    // Look for door status indicators
    const doorElements = page.locator('[class*="door"], [class*="Door"]');
    // At minimum, the grid container should be present
    await expect(page.getByText(/doors|Door/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test('displays lockdown controls panel', async ({ page }) => {
    await expect(page.getByText('Lockdown Controls')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Full Site Lockdown' })).toBeVisible();
  });

  test('displays notification form', async ({ page }) => {
    await expect(page.getByText('Send Notification')).toBeVisible();
    await expect(page.getByPlaceholder('Notification message...')).toBeVisible();
  });

  test('training mode toggle is present', async ({ page }) => {
    await expect(page.getByText('Training / Demo Mode')).toBeVisible();
  });
});
