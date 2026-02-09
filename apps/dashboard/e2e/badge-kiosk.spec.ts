import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers';

test.describe('Badge Kiosk Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/badgekiosk');
  });

  test('shows page title in header bar', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: 'BadgeKiosk' }).or(page.locator('h1', { hasText: 'BadgeKiosk' }))
    ).toBeVisible({ timeout: 10000 });
  });

  test('shows Current License section', async ({ page }) => {
    await expect(page.getByText('Current License')).toBeVisible({ timeout: 10000 });
  });

  test('shows license tier badge', async ({ page }) => {
    // Should show one of: FREE, PROFESSIONAL, ENTERPRISE
    await expect(page.getByText(/FREE|PROFESSIONAL|ENTERPRISE/).first()).toBeVisible({ timeout: 10000 });
  });

  test('shows max kiosks information', async ({ page }) => {
    await expect(page.getByText(/Max Kiosks:/)).toBeVisible({ timeout: 10000 });
  });

  test('shows three pricing tiers', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Free' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'Professional' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Enterprise' })).toBeVisible();
  });

  test('Free tier shows $0 price', async ({ page }) => {
    await expect(page.getByText('$0')).toBeVisible({ timeout: 10000 });
  });

  test('Professional and Enterprise tiers show Contact Sales', async ({ page }) => {
    const contactSales = page.getByText('Contact Sales');
    await expect(contactSales.first()).toBeVisible({ timeout: 10000 });
    expect(await contactSales.count()).toBe(2);
  });

  test('Free tier lists included features', async ({ page }) => {
    await expect(page.getByText('Visitor Check-In/Out')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('ID Screening (NSOPW)')).toBeVisible();
    await expect(page.getByText('Visitor Logs')).toBeVisible();
    await expect(page.getByText('Browser Badge Print')).toBeVisible();
  });

  test('Enterprise tier lists guard console feature', async ({ page }) => {
    await expect(page.getByText('Guard Console').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Manual Check-In/Out')).toBeVisible();
    await expect(page.getByText('Real-Time Monitoring')).toBeVisible();
  });

  test('shows License Administration section', async ({ page }) => {
    await expect(page.getByText('License Administration')).toBeVisible({ timeout: 10000 });
  });

  test('shows badge printing and guard console toggles', async ({ page }) => {
    await expect(page.getByText('Badge Printing')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Guard Console').first()).toBeVisible();

    // Should have checkboxes
    const checkboxes = page.locator('input[type="checkbox"]');
    expect(await checkboxes.count()).toBeGreaterThanOrEqual(2);
  });

  test('shows super admin note', async ({ page }) => {
    await expect(page.getByText('Only SUPER_ADMIN users can toggle these features.')).toBeVisible({ timeout: 10000 });
  });
});
