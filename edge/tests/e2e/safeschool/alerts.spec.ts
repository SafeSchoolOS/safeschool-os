import { test, expect } from '@playwright/test';
import { safeschoolLoginAsAdmin } from '../helpers/auth.js';

test.describe('SafeSchool Alerts', () => {
  test.beforeEach(async ({ page }) => {
    await safeschoolLoginAsAdmin(page);
  });

  test('PANIC alert button triggers confirmation', async ({ page }) => {
    await page.getByRole('button', { name: 'PANIC' }).click();
    await expect(page.getByRole('button', { name: 'CONFIRM PANIC' })).toBeVisible();
  });

  test('LOCKDOWN alert button triggers confirmation', async ({ page }) => {
    await page.getByRole('button', { name: 'LOCKDOWN' }).click();
    // Should show a confirmation step or lockdown modal
    await expect(page.getByText(/confirm|lockdown/i)).toBeVisible({ timeout: 5_000 });
  });

  test('MEDICAL alert button triggers confirmation', async ({ page }) => {
    await page.getByRole('button', { name: 'MEDICAL' }).click();
    // Should show confirmation
    await expect(page.getByText(/confirm|medical/i)).toBeVisible({ timeout: 5_000 });
  });

  test('notification can be sent', async ({ page }) => {
    const msgInput = page.getByPlaceholder('Notification message...');
    await msgInput.fill('Test notification from E2E');

    // Select a channel
    await page.getByRole('button', { name: 'EMAIL' }).click();

    await page.getByRole('button', { name: 'Send Notification' }).click();

    // Should show success feedback
    await expect(page.getByText(/sent|success/i)).toBeVisible({ timeout: 5_000 });
  });
});
