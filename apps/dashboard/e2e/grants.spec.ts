import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers';

test.describe('Grants Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/grants');
  });

  test('shows page title in header bar', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: 'Grants' }).or(page.locator('h1', { hasText: 'Grants' }))
    ).toBeVisible({ timeout: 10000 });
  });

  test('shows module selector instructions', async ({ page }) => {
    await expect(page.getByText('Select modules to find matching grants')).toBeVisible({ timeout: 10000 });
  });

  test('shows all available module buttons', async ({ page }) => {
    const modules = [
      'access control', 'panic button', '911 dispatch', 'visitor mgmt',
      'cameras', 'transportation', 'threat assessment', 'social media',
      'environmental', 'notifications', 'drills',
    ];

    for (const mod of modules) {
      await expect(page.getByRole('button', { name: mod })).toBeVisible({ timeout: 10000 });
    }
  });

  test('can toggle module selection', async ({ page }) => {
    const moduleBtn = page.getByRole('button', { name: 'access control' });
    await moduleBtn.waitFor({ timeout: 10000 });

    // Initially unselected (gray background)
    await expect(moduleBtn).toHaveClass(/bg-gray-800/);

    // Click to select
    await moduleBtn.click();
    await expect(moduleBtn).toHaveClass(/bg-blue-600/);

    // Click again to deselect
    await moduleBtn.click();
    await expect(moduleBtn).toHaveClass(/bg-gray-800/);
  });

  test('shows source filter dropdown', async ({ page }) => {
    const sourceSelect = page.locator('select').filter({ hasText: 'All Sources' });
    await expect(sourceSelect).toBeVisible({ timeout: 10000 });

    // "All Sources" + Federal, State, Private Foundation
    await expect(sourceSelect.locator('option')).toHaveCount(4);
  });

  test('can select source filter', async ({ page }) => {
    const sourceSelect = page.locator('select').filter({ hasText: 'All Sources' });
    await sourceSelect.waitFor({ timeout: 10000 });

    await sourceSelect.selectOption('FEDERAL');
    await expect(sourceSelect).toHaveValue('FEDERAL');

    await sourceSelect.selectOption('STATE');
    await expect(sourceSelect).toHaveValue('STATE');
  });

  test('shows initial empty state prompting module selection', async ({ page }) => {
    // Without modules selected, should show prompt
    await expect(page.getByText('Select modules above to find matching grants.')).toBeVisible({ timeout: 10000 });
  });

  test('selecting modules triggers grant search', async ({ page }) => {
    // Select a module to trigger search
    await page.getByRole('button', { name: 'access control' }).click();

    // Should show either grants or a "no grants found" message
    await expect(
      page.getByText('Estimated Available Funding').or(page.getByText('No grants found for selected modules.'))
    ).toBeVisible({ timeout: 10000 });
  });

  test('selecting modules shows funding estimate', async ({ page }) => {
    await page.getByRole('button', { name: 'panic button' }).click();

    // Wait for the estimate to load
    await expect(page.getByText('Estimated Available Funding')).toBeVisible({ timeout: 10000 });

    // Should show dollar amounts
    await expect(page.getByText(/\$/)).toBeVisible();
  });

  test('budget template toggle works', async ({ page }) => {
    // Select a module first
    await page.getByRole('button', { name: 'panic button' }).click();

    // Wait for estimate to appear with budget button
    await expect(page.getByText('Estimated Available Funding')).toBeVisible({ timeout: 10000 });

    // Click Show Budget Template
    await page.getByRole('button', { name: 'Show Budget Template' }).click();

    // Budget template table should appear
    await expect(page.getByText('Budget Template')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Category')).toBeVisible();
    await expect(page.getByText('Unit Cost')).toBeVisible();

    // Click Hide Budget Template
    await page.getByRole('button', { name: 'Hide Budget Template' }).click();
    await expect(page.getByText('Budget Template')).not.toBeVisible();
  });

  test('can select multiple modules', async ({ page }) => {
    const accessBtn = page.getByRole('button', { name: 'access control' });
    const panicBtn = page.getByRole('button', { name: 'panic button' });

    await accessBtn.waitFor({ timeout: 10000 });

    await accessBtn.click();
    await panicBtn.click();

    // Both should be selected
    await expect(accessBtn).toHaveClass(/bg-blue-600/);
    await expect(panicBtn).toHaveClass(/bg-blue-600/);
  });
});
