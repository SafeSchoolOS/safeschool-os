import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers';

test.describe('Reports Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/reports');
  });

  test('shows page title in header bar', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: 'Reports' }).or(page.locator('h1', { hasText: 'Reports' }))
    ).toBeVisible({ timeout: 10000 });
  });

  test('shows report type selector buttons', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Incident Summary' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Drill Compliance' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Visitor Activity' })).toBeVisible();
  });

  test('incident summary is selected by default', async ({ page }) => {
    const incidentBtn = page.getByRole('button', { name: 'Incident Summary' });
    await incidentBtn.waitFor({ timeout: 10000 });
    await expect(incidentBtn).toHaveClass(/bg-blue-600/);
  });

  test('shows date range inputs', async ({ page }) => {
    const dateInputs = page.locator('input[type="date"]');
    await expect(dateInputs.first()).toBeVisible({ timeout: 10000 });
    await expect(dateInputs.nth(1)).toBeVisible();
    await expect(page.getByText('to')).toBeVisible();
  });

  test('shows Export PDF button', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Export PDF' })).toBeVisible({ timeout: 10000 });
  });

  test('incident report shows summary cards', async ({ page }) => {
    await expect(page.getByText('Total Incidents')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Lockdowns/Active Threats')).toBeVisible();
    await expect(page.getByText('Resolved')).toBeVisible();
    await expect(page.getByText('Active/Pending')).toBeVisible();
  });

  test('incident report shows chart sections', async ({ page }) => {
    // Charts may show "No incidents in this period" or actual charts
    await expect(
      page.getByText('By Alert Level').or(page.getByText('No incidents in this period').first())
    ).toBeVisible({ timeout: 10000 });
  });

  test('can switch to Drill Compliance report', async ({ page }) => {
    await page.getByRole('button', { name: 'Drill Compliance' }).click();

    // Should show compliance information
    await expect(page.getByText(/Compliance/).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/COMPLIANT|NOT COMPLIANT/).first()).toBeVisible();
  });

  test('compliance report shows drill completion data', async ({ page }) => {
    await page.getByRole('button', { name: 'Drill Compliance' }).click();

    await expect(page.getByText("Alyssa's Law Compliance")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Total drills completed/)).toBeVisible();
  });

  test('can switch to Visitor Activity report', async ({ page }) => {
    await page.getByRole('button', { name: 'Visitor Activity' }).click();

    // Should show visitor summary cards
    await expect(page.getByText('Total Visitors')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Checked Out')).toBeVisible();
    await expect(page.getByText('Still On Site')).toBeVisible();
    await expect(page.getByText('Screened')).toBeVisible();
  });

  test('visitor report shows chart sections', async ({ page }) => {
    await page.getByRole('button', { name: 'Visitor Activity' }).click();

    await expect(page.getByText('Visitor Status')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('By Purpose')).toBeVisible();
  });

  test('switching report types changes active button state', async ({ page }) => {
    const incidentBtn = page.getByRole('button', { name: 'Incident Summary' });
    const complianceBtn = page.getByRole('button', { name: 'Drill Compliance' });
    const visitorBtn = page.getByRole('button', { name: 'Visitor Activity' });

    await incidentBtn.waitFor({ timeout: 10000 });

    // Incident selected by default
    await expect(incidentBtn).toHaveClass(/bg-blue-600/);
    await expect(complianceBtn).toHaveClass(/bg-gray-800/);

    // Switch to compliance
    await complianceBtn.click();
    await expect(complianceBtn).toHaveClass(/bg-blue-600/);
    await expect(incidentBtn).toHaveClass(/bg-gray-800/);

    // Switch to visitor
    await visitorBtn.click();
    await expect(visitorBtn).toHaveClass(/bg-blue-600/);
    await expect(complianceBtn).toHaveClass(/bg-gray-800/);
  });
});
