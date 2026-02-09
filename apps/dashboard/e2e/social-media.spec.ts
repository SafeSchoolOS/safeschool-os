import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers';

test.describe('Social Media Monitoring Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/social-media');
    await expect(page.getByText('Social Media Monitoring')).toBeVisible();
  });

  test('shows page header', async ({ page }) => {
    await expect(page.getByText('Social Media Monitoring')).toBeVisible();
  });

  test('shows dashboard statistics', async ({ page }) => {
    await expect(page.getByText('Total Alerts')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Unreviewed')).toBeVisible();
    await expect(page.getByText('High Severity')).toBeVisible();
    await expect(page.getByText('Critical')).toBeVisible();
  });

  test('shows status filter dropdown', async ({ page }) => {
    const statusSelect = page.locator('select').filter({ hasText: 'All Statuses' });
    await expect(statusSelect).toBeVisible({ timeout: 10000 });
    await expect(statusSelect.locator('option')).toHaveCount(7); // "All" + 6 statuses
  });

  test('shows severity filter dropdown', async ({ page }) => {
    const severitySelect = page.locator('select').filter({ hasText: 'All Severities' });
    await expect(severitySelect).toBeVisible({ timeout: 10000 });
    await expect(severitySelect.locator('option')).toHaveCount(5); // "All" + 4 severities
  });

  test('can select status filter', async ({ page }) => {
    const statusSelect = page.locator('select').filter({ hasText: 'All Statuses' });
    await statusSelect.selectOption('NEW');
    // Filter is applied (page re-renders with filtered data)
    await expect(statusSelect).toHaveValue('NEW');
  });

  test('can select severity filter', async ({ page }) => {
    const severitySelect = page.locator('select').filter({ hasText: 'All Severities' });
    await severitySelect.selectOption('CRITICAL');
    await expect(severitySelect).toHaveValue('CRITICAL');
  });

  test('shows empty state when no alerts match', async ({ page }) => {
    await expect(page.getByText('No social media alerts found.')).toBeVisible({ timeout: 10000 });
  });

  test('back link returns to command center', async ({ page }) => {
    await page.getByText('Command Center').click();
    await expect(page).toHaveURL('/');
  });
});
