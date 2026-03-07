import { test, expect } from '@playwright/test';
import { safeschoolLoginAsAdmin } from '../helpers/auth.js';

test.describe('SafeSchool Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await safeschoolLoginAsAdmin(page);
  });

  test('sidebar shows section headers', async ({ page }) => {
    await expect(page.getByText('Operations')).toBeVisible();
    await expect(page.getByText('Safety')).toBeVisible();
    await expect(page.getByText('Management')).toBeVisible();
  });

  test('navigate to Visitors', async ({ page }) => {
    await page.getByRole('link', { name: 'Visitors' }).click();
    await expect(page).toHaveURL('/visitors');
  });

  test('navigate to Cameras', async ({ page }) => {
    await page.getByRole('link', { name: 'Cameras' }).click();
    await expect(page).toHaveURL('/cameras');
  });

  test('navigate to Door Health', async ({ page }) => {
    await page.getByRole('link', { name: 'Door Health' }).click();
    await expect(page).toHaveURL('/door-health');
  });

  test('navigate to Drills', async ({ page }) => {
    await page.getByRole('link', { name: 'Drills' }).click();
    await expect(page).toHaveURL('/drills');
  });

  test('navigate to Zones', async ({ page }) => {
    await page.getByRole('link', { name: 'Zones' }).click();
    await expect(page).toHaveURL('/zones');
  });

  test('navigate to Settings', async ({ page }) => {
    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page).toHaveURL('/settings');
  });

  test('sidebar shows user email and role', async ({ page }) => {
    await expect(page.getByText('admin@lincoln.edu')).toBeVisible();
    await expect(page.getByText('SITE_ADMIN')).toBeVisible();
  });
});
