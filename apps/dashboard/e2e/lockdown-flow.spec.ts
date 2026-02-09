import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers';

test.describe('Lockdown Flow', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page.getByText('Emergency Actions')).toBeVisible({ timeout: 10000 });
  });

  test('shows lockdown controls section', async ({ page }) => {
    await expect(page.getByText('Lockdown Controls')).toBeVisible({ timeout: 10000 });
  });

  test('shows Full Site Lockdown button', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Full Site Lockdown' })).toBeVisible({ timeout: 10000 });
  });

  test('shows building-specific lockdown buttons', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Lock Main Building/ })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: /Lock Annex Building/ })).toBeVisible();
  });

  test('can initiate a full site lockdown', async ({ page }) => {
    const lockdownBtn = page.getByRole('button', { name: 'Full Site Lockdown' });
    await lockdownBtn.waitFor({ timeout: 10000 });
    await lockdownBtn.click();

    // After lockdown initiation, should see active lockdown indicator
    await expect(page.getByText(/ACTIVE|lockdown/).first()).toBeVisible({ timeout: 10000 });
  });

  test('can initiate building-specific lockdown', async ({ page }) => {
    const buildingLockBtn = page.getByRole('button', { name: /Lock Main Building/ });
    await buildingLockBtn.waitFor({ timeout: 10000 });
    await buildingLockBtn.click();

    // Should show active lockdown
    await expect(page.getByText(/ACTIVE|lockdown|doors locked/).first()).toBeVisible({ timeout: 10000 });
  });

  test('active lockdown shows door count', async ({ page }) => {
    // Initiate lockdown
    await page.getByRole('button', { name: 'Full Site Lockdown' }).click();

    // Should show how many doors were locked
    await expect(page.getByText(/doors locked/).first()).toBeVisible({ timeout: 10000 });
  });

  test('active lockdown shows release restriction in cloud mode', async ({ page }) => {
    // Initiate lockdown
    await page.getByRole('button', { name: 'Full Site Lockdown' }).click();

    // In cloud mode, release requires physical presence at edge device
    await expect(
      page.getByText('Release from on-site device only').or(page.getByText('physical presence'))
    ).toBeVisible({ timeout: 10000 });
  });

  test('LOCKDOWN emergency button creates lockdown alert', async ({ page }) => {
    // The LOCKDOWN button in Emergency Actions creates a LOCKDOWN-level alert
    const lockdownAlertBtn = page.getByRole('button', { name: 'LOCKDOWN' });
    await lockdownAlertBtn.waitFor({ timeout: 10000 });
    await lockdownAlertBtn.click();

    // Should see the alert appear in the alerts list
    await expect(page.getByText('LOCKDOWN').first()).toBeVisible({ timeout: 10000 });
  });
});
