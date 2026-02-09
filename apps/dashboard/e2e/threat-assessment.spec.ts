import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers';

test.describe('Threat Assessment Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/threat-assessment');
    await expect(page.getByText('Threat Assessment')).toBeVisible();
  });

  test('shows page header with New Report button', async ({ page }) => {
    await expect(page.getByText('Threat Assessment')).toBeVisible();
    await expect(page.getByRole('button', { name: 'New Report' })).toBeVisible();
  });

  test('shows dashboard statistics', async ({ page }) => {
    await expect(page.getByText('Total Reports')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Active Cases')).toBeVisible();
    await expect(page.getByText('Imminent Risk')).toBeVisible();
    await expect(page.getByText('High Risk')).toBeVisible();
  });

  test('shows status filter dropdown', async ({ page }) => {
    const select = page.locator('select').filter({ hasText: 'All Statuses' });
    await expect(select).toBeVisible({ timeout: 10000 });

    // Should have all status options
    await expect(select.locator('option')).toHaveCount(9); // "All" + 8 statuses
  });

  test('shows empty state when no reports exist', async ({ page }) => {
    await expect(page.getByText('No threat reports found.')).toBeVisible({ timeout: 10000 });
  });

  test('opens new report form', async ({ page }) => {
    await page.getByRole('button', { name: 'New Report' }).click();

    await expect(page.getByText('New Threat Report')).toBeVisible();
    await expect(page.getByPlaceholder('Subject Name')).toBeVisible();
    await expect(page.getByPlaceholder('Grade (optional)')).toBeVisible();
    await expect(page.getByPlaceholder('Describe the concern...')).toBeVisible();
  });

  test('report form shows CSTAG risk factors', async ({ page }) => {
    await page.getByRole('button', { name: 'New Report' }).click();

    await expect(page.getByText('Risk Factors (CSTAG)')).toBeVisible();
    await expect(page.getByText('Specific target identified')).toBeVisible();
    await expect(page.getByText('Access to weapons')).toBeVisible();
    await expect(page.getByText('Prior violent behavior')).toBeVisible();
    await expect(page.getByText('Social isolation')).toBeVisible();
    await expect(page.getByText('Communication of intent')).toBeVisible();
  });

  test('report form has category dropdown', async ({ page }) => {
    await page.getByRole('button', { name: 'New Report' }).click();

    const categorySelect = page.locator('select').filter({ hasText: 'OTHER CONCERN' });
    await expect(categorySelect).toBeVisible();
    await expect(categorySelect.locator('option')).toHaveCount(10);
  });

  test('submit button is disabled without required fields', async ({ page }) => {
    await page.getByRole('button', { name: 'New Report' }).click();

    const submitBtn = page.getByRole('button', { name: 'Submit Report' });
    await expect(submitBtn).toBeDisabled();
  });

  test('cancel closes the report form', async ({ page }) => {
    await page.getByRole('button', { name: 'New Report' }).click();
    await expect(page.getByText('New Threat Report')).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('New Threat Report')).not.toBeVisible();
  });

  test('can toggle risk factor checkboxes', async ({ page }) => {
    await page.getByRole('button', { name: 'New Report' }).click();

    const checkbox = page.getByLabel('Specific target identified');
    await checkbox.check();
    await expect(checkbox).toBeChecked();
    await checkbox.uncheck();
    await expect(checkbox).not.toBeChecked();
  });

  test('back link returns to command center', async ({ page }) => {
    await page.getByText('Command Center').click();
    await expect(page).toHaveURL('/');
  });
});
