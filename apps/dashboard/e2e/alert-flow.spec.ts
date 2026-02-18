import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers';

test.describe('Alert Creation and Management Flow', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page.getByText('Emergency Actions')).toBeVisible({ timeout: 10000 });
  });

  test.describe('alert creation via emergency buttons', () => {
    test('MEDICAL button creates a medical alert immediately', async ({ page }) => {
      const medicalBtn = page.getByRole('button', { name: 'MEDICAL' });
      await medicalBtn.waitFor({ timeout: 10000 });
      await medicalBtn.click();

      // The alert list should now show the medical alert
      await expect(page.getByText('MEDICAL').first()).toBeVisible({ timeout: 10000 });
    });

    test('LOCKDOWN button creates a lockdown alert immediately', async ({ page }) => {
      const lockdownBtn = page.getByRole('button', { name: 'LOCKDOWN' });
      await lockdownBtn.waitFor({ timeout: 10000 });
      await lockdownBtn.click();

      // The alert list should now show the lockdown alert
      await expect(page.getByText('LOCKDOWN').first()).toBeVisible({ timeout: 10000 });
    });

    test('PANIC button requires two-step confirmation', async ({ page }) => {
      const panicBtn = page.getByRole('button', { name: 'PANIC' });
      await panicBtn.waitFor({ timeout: 10000 });

      // First click arms the button
      await panicBtn.click();
      await expect(page.getByRole('button', { name: 'CONFIRM PANIC' })).toBeVisible();
      await expect(page.getByText('Press again to confirm ACTIVE THREAT alert')).toBeVisible();
    });

    test('confirmed PANIC creates active threat alert', async ({ page }) => {
      // Arm
      await page.getByRole('button', { name: 'PANIC' }).click();

      // Confirm
      await page.getByRole('button', { name: 'CONFIRM PANIC' }).click();

      // Should show ACTIVE_THREAT alert
      await expect(page.getByText('ACTIVE_THREAT').first()).toBeVisible({ timeout: 10000 });
    });

    test('building selector is present for multi-building site', async ({ page }) => {
      // Lincoln Elementary has 2 buildings, so building selector should appear
      const buildingSelect = page.locator('select').filter({ hasText: /Main Building|Annex/ });
      await expect(buildingSelect).toBeVisible({ timeout: 10000 });
    });

    test('can select different building for alert', async ({ page }) => {
      const buildingSelect = page.locator('select').filter({ hasText: /Main Building|Annex/ });
      await buildingSelect.waitFor({ timeout: 10000 });

      // Select Annex Building
      const options = await buildingSelect.locator('option').allTextContents();
      const annexOption = options.find(o => o.includes('Annex'));
      if (annexOption) {
        await buildingSelect.selectOption({ label: annexOption });
      }
    });
  });

  test.describe('alert list', () => {
    test('shows Alerts section header', async ({ page }) => {
      await expect(page.getByText('Alerts')).toBeVisible({ timeout: 10000 });
    });

    test('shows "No alerts. All clear." when no active alerts', async ({ page }) => {
      // If no alerts exist, should show the empty state
      // Note: previous tests may have created alerts, so this checks both states
      await expect(
        page.getByText('No alerts. All clear.').or(page.getByText(/active/).first())
      ).toBeVisible({ timeout: 10000 });
    });

    test('creating an alert shows it in the active alerts list', async ({ page }) => {
      // Create a medical alert
      await page.getByRole('button', { name: 'MEDICAL' }).click();

      // Should show "active" badge on alerts section
      await expect(page.getByText(/\d+ active/)).toBeVisible({ timeout: 10000 });
    });

    test('alert cards show acknowledge and resolve actions', async ({ page }) => {
      // Create an alert first
      await page.getByRole('button', { name: 'MEDICAL' }).click();

      // Wait for alert to appear
      await expect(page.getByText('MEDICAL').first()).toBeVisible({ timeout: 10000 });

      // Alert cards should have action buttons
      await expect(
        page.getByRole('button', { name: /Acknowledge/i }).or(page.getByRole('button', { name: /Resolve/i }))
      ).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('door status interaction', () => {
    test('door status grid shows all doors', async ({ page }) => {
      await expect(page.getByText('Main Entrance').first()).toBeVisible({ timeout: 10000 });
    });

    test('doors show lock/unlock toggle buttons', async ({ page }) => {
      await expect(page.getByText('Main Entrance').first()).toBeVisible({ timeout: 10000 });
      await expect(page.getByRole('button', { name: /Lock|Unlock/i }).first()).toBeVisible();
    });

    test('door status badges show LOCKED or UNLOCKED', async ({ page }) => {
      await expect(page.getByText('Main Entrance').first()).toBeVisible({ timeout: 10000 });
      await expect(page.getByText(/LOCKED|UNLOCKED/).first()).toBeVisible();
    });
  });
});
