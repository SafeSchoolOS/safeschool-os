import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers';

test.describe('Command Center', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('shows site name and user info in header', async ({ page }) => {
    await expect(page.getByText('SafeSchool OS')).toBeVisible();
    await expect(page.getByText('Lincoln Elementary')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Dr. Sarah Mitchell')).toBeVisible();
    await expect(page.getByText('SITE_ADMIN')).toBeVisible();
  });

  test('has navigation links to all pages', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Visitors' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Transportation' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Threats' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Social Media' })).toBeVisible();
  });

  test('shows status bar with visitor and bus counts', async ({ page }) => {
    await expect(page.getByText(/Visitors:.*active/)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Buses:.*active/)).toBeVisible();
  });

  test('shows emergency actions panel', async ({ page }) => {
    await expect(page.getByText('Emergency Actions')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'PANIC' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'LOCKDOWN' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'MEDICAL' })).toBeVisible();
  });

  test('panic button requires two-step confirmation', async ({ page }) => {
    const panicBtn = page.getByRole('button', { name: 'PANIC' });
    await panicBtn.click();

    // After first click, should show confirmation state
    await expect(page.getByRole('button', { name: 'CONFIRM PANIC' })).toBeVisible();
    await expect(page.getByText('Press again to confirm ACTIVE THREAT alert')).toBeVisible();

    // Wait for auto-cancel (5s)
    await expect(page.getByRole('button', { name: 'PANIC' })).toBeVisible({ timeout: 7000 });
  });

  test('shows lockdown controls section', async ({ page }) => {
    await expect(page.getByText('Lockdown Controls')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Full Site Lockdown' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Lock Main Building/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Lock Annex Building/ })).toBeVisible();
  });

  test('shows door status grid with all doors', async ({ page }) => {
    // Wait for doors to load
    await expect(page.getByText('Main Entrance').first()).toBeVisible({ timeout: 10000 });
    // Check for door status badges
    await expect(page.getByText(/LOCKED|UNLOCKED/).first()).toBeVisible();
  });

  test('shows send notification form', async ({ page }) => {
    await expect(page.getByText('Send Notification')).toBeVisible({ timeout: 10000 });
    await expect(page.getByPlaceholder('Notification message...')).toBeVisible();
    await expect(page.getByText('Recipients')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send Notification' })).toBeVisible();
  });

  test('notification form has channel toggles', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'SMS' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'EMAIL' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'PUSH' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'PA' })).toBeVisible();
  });

  test('can toggle notification channels', async ({ page }) => {
    // PUSH should start un-selected, click to toggle
    const pushBtn = page.getByRole('button', { name: 'PUSH' });
    await pushBtn.waitFor({ timeout: 10000 });

    // Click PUSH to select it
    await pushBtn.click();
    // Click again to deselect
    await pushBtn.click();
  });

  test('notification recipient dropdown has options', async ({ page }) => {
    const select = page.locator('select').filter({ hasText: 'All Staff' });
    await select.waitFor({ timeout: 10000 });
    await expect(select.locator('option')).toHaveCount(2); // All Staff, All Parents
  });
});
