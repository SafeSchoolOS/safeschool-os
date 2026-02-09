import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers';

test.describe('Audit Log Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/audit-log');
  });

  test('shows page title in header bar', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: 'Audit Log' }).or(page.locator('h1', { hasText: 'Audit Log' }))
    ).toBeVisible({ timeout: 10000 });
  });

  test('shows entity filter dropdown', async ({ page }) => {
    const entitySelect = page.locator('select').filter({ hasText: 'All Entities' });
    await expect(entitySelect).toBeVisible({ timeout: 10000 });
  });

  test('shows action filter dropdown', async ({ page }) => {
    const actionSelect = page.locator('select').filter({ hasText: 'All Actions' });
    await expect(actionSelect).toBeVisible({ timeout: 10000 });
  });

  test('shows entry count', async ({ page }) => {
    await expect(page.getByText(/\d+ entries/)).toBeVisible({ timeout: 10000 });
  });

  test('shows audit log table with correct columns', async ({ page }) => {
    // Wait for table to render
    await expect(page.getByText('Timestamp')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Action')).toBeVisible();
    await expect(page.getByText('Entity')).toBeVisible();
    await expect(page.getByText('User')).toBeVisible();
    await expect(page.getByText('Details')).toBeVisible();
  });

  test('shows log entries or empty state', async ({ page }) => {
    // Either shows entries (login events from our login) or empty state
    await expect(
      page.getByText('No audit log entries found.').or(page.locator('tbody tr').first())
    ).toBeVisible({ timeout: 10000 });
  });

  test('can select entity filter', async ({ page }) => {
    const entitySelect = page.locator('select').filter({ hasText: 'All Entities' });
    await entitySelect.waitFor({ timeout: 10000 });

    // Get the available options
    const options = await entitySelect.locator('option').allTextContents();
    expect(options.length).toBeGreaterThanOrEqual(1); // At least "All Entities"

    // If there are specific entities, select one
    if (options.length > 1) {
      await entitySelect.selectOption({ index: 1 });
      // Verify filter was applied (dropdown value changed)
      const value = await entitySelect.inputValue();
      expect(value).not.toBe('');
    }
  });

  test('can select action filter', async ({ page }) => {
    const actionSelect = page.locator('select').filter({ hasText: 'All Actions' });
    await actionSelect.waitFor({ timeout: 10000 });

    const options = await actionSelect.locator('option').allTextContents();
    expect(options.length).toBeGreaterThanOrEqual(1);

    if (options.length > 1) {
      await actionSelect.selectOption({ index: 1 });
      const value = await actionSelect.inputValue();
      expect(value).not.toBe('');
    }
  });
});
