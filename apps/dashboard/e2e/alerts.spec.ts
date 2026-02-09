import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers';

test.describe('Alert Management', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page.getByText('Emergency Actions')).toBeVisible({ timeout: 10000 });
  });

  test('shows all emergency action buttons', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'PANIC' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'LOCKDOWN' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'MEDICAL' })).toBeVisible();
  });

  test('panic button has two-step confirmation', async ({ page }) => {
    await page.getByRole('button', { name: 'PANIC' }).click();

    // Should show confirmation state with pulse animation text
    await expect(page.getByRole('button', { name: 'CONFIRM PANIC' })).toBeVisible();
    await expect(page.getByText('Auto-cancels in 5s')).toBeVisible();
  });

  test('panic auto-cancels after 5 seconds', async ({ page }) => {
    await page.getByRole('button', { name: 'PANIC' }).click();
    await expect(page.getByRole('button', { name: 'CONFIRM PANIC' })).toBeVisible();

    // Wait for auto-cancel
    await expect(page.getByRole('button', { name: 'PANIC' })).toBeVisible({ timeout: 7000 });
    await expect(page.getByRole('button', { name: 'CONFIRM PANIC' })).not.toBeVisible();
  });

  test('shows building selector when multiple buildings exist', async ({ page }) => {
    // Lincoln Elementary has Main Building and Annex Building
    const buildingSelect = page.locator('select').filter({ hasText: /Main Building|Annex/ });
    await expect(buildingSelect).toBeVisible({ timeout: 10000 });
  });

  test('shows lockdown controls with building buttons', async ({ page }) => {
    await expect(page.getByText('Lockdown Controls')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Full Site Lockdown' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Lock Main Building/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Lock Annex Building/ })).toBeVisible();
  });

  test('door status shows lock/unlock controls', async ({ page }) => {
    // Wait for door data to load
    await expect(page.getByText('Main Entrance').first()).toBeVisible({ timeout: 10000 });

    // Should show lock/unlock buttons
    await expect(page.getByRole('button', { name: /Lock|Unlock/i }).first()).toBeVisible();
  });

  test('shows door status badges', async ({ page }) => {
    await expect(page.getByText('Main Entrance').first()).toBeVisible({ timeout: 10000 });
    // Doors should show LOCKED or UNLOCKED status
    await expect(page.getByText(/LOCKED|UNLOCKED/).first()).toBeVisible();
  });

  test('door list includes exterior and emergency exit markers', async ({ page }) => {
    // Gym External Door is marked as exterior + emergency exit
    await expect(page.getByText('Gym External Door').or(page.getByText('Main Emergency Exit'))).toBeVisible({ timeout: 10000 });
  });
});
