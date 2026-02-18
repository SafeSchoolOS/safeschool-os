import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers';

test.describe('Reunification Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/reunification');
  });

  test('shows page title in header bar', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: 'Reunification' }).or(page.locator('h1', { hasText: 'Reunification' }))
    ).toBeVisible({ timeout: 10000 });
  });

  test('shows Start Reunification button', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Start Reunification' })).toBeVisible({ timeout: 10000 });
  });

  test('clicking Start Reunification opens the create form', async ({ page }) => {
    await page.getByRole('button', { name: 'Start Reunification' }).click();

    await expect(page.getByText('New Reunification Event')).toBeVisible();
    await expect(page.getByPlaceholder('Location (e.g., Football Field)')).toBeVisible();
    await expect(page.getByPlaceholder('Expected student count')).toBeVisible();
  });

  test('create form has Start and Cancel buttons', async ({ page }) => {
    await page.getByRole('button', { name: 'Start Reunification' }).click();

    await expect(page.locator('button').filter({ hasText: /^Start$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  });

  test('Start button is disabled without location', async ({ page }) => {
    await page.getByRole('button', { name: 'Start Reunification' }).click();

    const startBtn = page.locator('button').filter({ hasText: /^Start$/ });
    await expect(startBtn).toBeDisabled();
  });

  test('cancel button closes the create form', async ({ page }) => {
    await page.getByRole('button', { name: 'Start Reunification' }).click();
    await expect(page.getByText('New Reunification Event')).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('New Reunification Event')).not.toBeVisible();
  });

  test('shows empty state when no events exist', async ({ page }) => {
    await expect(
      page.getByText('No reunification events.').or(page.locator('button').filter({ hasText: /ACTIVE|COMPLETED/ }).first())
    ).toBeVisible({ timeout: 10000 });
  });

  test('shows detail panel placeholder when no event selected', async ({ page }) => {
    await expect(page.getByText('Select an event to view details, or start a new reunification.')).toBeVisible({ timeout: 10000 });
  });

  test('can fill in the create form', async ({ page }) => {
    await page.getByRole('button', { name: 'Start Reunification' }).click();

    await page.getByPlaceholder('Location (e.g., Football Field)').fill('Football Field');
    await page.getByPlaceholder('Expected student count').fill('200');

    // Start button should now be enabled
    const startBtn = page.locator('button').filter({ hasText: /^Start$/ });
    await expect(startBtn).toBeEnabled();
  });
});
