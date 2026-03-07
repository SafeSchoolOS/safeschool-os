import { test, expect } from '@playwright/test';
import { safeschoolLoginAsAdmin } from '../helpers/auth.js';

test.describe('SafeSchool Visitors', () => {
  test.beforeEach(async ({ page }) => {
    await safeschoolLoginAsAdmin(page);
    await page.goto('/visitors');
  });

  test('loads visitor management page', async ({ page }) => {
    await expect(page.getByText('Visitor Management')).toBeVisible({ timeout: 10_000 });
  });

  test('shows visitor tabs', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Active Visitors' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'All Visitors' })).toBeVisible();
  });

  test('shows check-in form with required fields', async ({ page }) => {
    await expect(page.getByPlaceholder('First Name')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByPlaceholder('Last Name')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Check In Visitor' })).toBeVisible();
  });

  test('check in a visitor', async ({ page }) => {
    await page.getByPlaceholder('First Name').fill('Test');
    await page.getByPlaceholder('Last Name').fill('Visitor');
    await page.getByPlaceholder('Purpose of Visit').fill('Meeting');
    await page.getByPlaceholder('Destination (room or person)').fill('Front Office');
    await page.getByRole('button', { name: 'Check In Visitor' }).click();

    // Visitor should appear in the active list
    await expect(page.getByText('Test Visitor')).toBeVisible({ timeout: 5_000 });
  });
});
