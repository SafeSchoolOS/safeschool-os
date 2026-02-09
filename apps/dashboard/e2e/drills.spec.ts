import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers';

test.describe('Drills Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/drills');
  });

  test('shows page title in header bar', async ({ page }) => {
    // DashboardLayout renders the page title in the top bar
    await expect(page.getByRole('heading', { name: 'Drills' }).or(page.locator('h1', { hasText: 'Drills' }))).toBeVisible({ timeout: 10000 });
  });

  test('shows Schedule Drill button', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Schedule Drill' })).toBeVisible({ timeout: 10000 });
  });

  test('shows drill type filter dropdown', async ({ page }) => {
    const typeSelect = page.locator('select').filter({ hasText: 'All Types' });
    await expect(typeSelect).toBeVisible({ timeout: 10000 });

    // Should have All Types + 4 drill types (Lockdown, Fire, Evacuation, Active Threat)
    await expect(typeSelect.locator('option')).toHaveCount(5);
  });

  test('can select drill type filter', async ({ page }) => {
    const typeSelect = page.locator('select').filter({ hasText: 'All Types' });
    await typeSelect.waitFor({ timeout: 10000 });

    await typeSelect.selectOption('LOCKDOWN');
    await expect(typeSelect).toHaveValue('LOCKDOWN');

    await typeSelect.selectOption('FIRE');
    await expect(typeSelect).toHaveValue('FIRE');
  });

  test('shows compliance report section', async ({ page }) => {
    // The compliance report shows year and compliance status
    await expect(page.getByText('Compliance').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/COMPLIANT|NOT COMPLIANT/).first()).toBeVisible();
  });

  test('compliance report shows drill type requirements', async ({ page }) => {
    // Each drill type should have a completion count
    await expect(page.getByText('Lockdown').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Fire').first()).toBeVisible();
    await expect(page.getByText('Evacuation').first()).toBeVisible();
    await expect(page.getByText('Active Threat').first()).toBeVisible();
  });

  test('clicking Schedule Drill opens the form', async ({ page }) => {
    await page.getByRole('button', { name: 'Schedule Drill' }).click();

    await expect(page.getByText('Schedule New Drill')).toBeVisible();
  });

  test('schedule form has type selector with all drill types', async ({ page }) => {
    await page.getByRole('button', { name: 'Schedule Drill' }).click();

    // Form type selector (different from the filter dropdown)
    const formSelect = page.locator('.bg-gray-700').locator('select').first();
    await expect(formSelect).toBeVisible();
    await expect(formSelect.locator('option')).toHaveCount(4); // Lockdown, Fire, Evacuation, Active Threat
  });

  test('schedule form has datetime and notes inputs', async ({ page }) => {
    await page.getByRole('button', { name: 'Schedule Drill' }).click();

    await expect(page.locator('input[type="datetime-local"]')).toBeVisible();
    await expect(page.getByPlaceholder('Notes (optional)')).toBeVisible();
  });

  test('schedule button is disabled without date', async ({ page }) => {
    await page.getByRole('button', { name: 'Schedule Drill' }).click();

    // The Schedule (submit) button should be disabled when scheduledAt is empty
    const scheduleBtn = page.locator('button').filter({ hasText: /^Schedule$/ });
    await expect(scheduleBtn).toBeDisabled();
  });

  test('cancel button closes the schedule form', async ({ page }) => {
    await page.getByRole('button', { name: 'Schedule Drill' }).click();
    await expect(page.getByText('Schedule New Drill')).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Schedule New Drill')).not.toBeVisible();
  });

  test('shows empty state when no drills exist', async ({ page }) => {
    // With fresh seed data, there may be no drills
    await expect(
      page.getByText('No drills found').or(page.locator('[class*="bg-gray-800"]').filter({ hasText: /SCHEDULED|IN_PROGRESS|COMPLETED/ }).first())
    ).toBeVisible({ timeout: 10000 });
  });
});
