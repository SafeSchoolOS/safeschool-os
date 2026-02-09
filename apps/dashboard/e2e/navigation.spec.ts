import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers';

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('navigate to Visitors page', async ({ page }) => {
    await page.getByRole('link', { name: 'Visitors' }).click();
    await expect(page).toHaveURL('/visitors');
    await expect(page.getByText('Visitor Management')).toBeVisible();
  });

  test('navigate to Transportation page', async ({ page }) => {
    await page.getByRole('link', { name: 'Transportation' }).click();
    await expect(page).toHaveURL('/transportation');
    await expect(page.getByText('Student Transportation')).toBeVisible();
  });

  test('navigate to Threat Assessment page', async ({ page }) => {
    await page.getByRole('link', { name: 'Threats' }).click();
    await expect(page).toHaveURL('/threat-assessment');
    await expect(page.getByText('Threat Assessment')).toBeVisible();
  });

  test('navigate to Social Media page', async ({ page }) => {
    await page.getByRole('link', { name: 'Social Media' }).click();
    await expect(page).toHaveURL('/social-media');
    await expect(page.getByText('Social Media Monitoring')).toBeVisible();
  });

  test('back to Command Center from Visitors', async ({ page }) => {
    await page.goto('/visitors');
    await expect(page.getByText('Visitor Management')).toBeVisible();
    await page.getByText('Command Center').click();
    await expect(page).toHaveURL('/');
  });

  test('back to Command Center from Transportation', async ({ page }) => {
    await page.goto('/transportation');
    await expect(page.getByText('Student Transportation')).toBeVisible();
    await page.getByText('Command Center').click();
    await expect(page).toHaveURL('/');
  });

  test('back to Command Center from Threat Assessment', async ({ page }) => {
    await page.goto('/threat-assessment');
    await expect(page.getByText('Threat Assessment')).toBeVisible();
    await page.getByText('Command Center').click();
    await expect(page).toHaveURL('/');
  });

  test('back to Command Center from Social Media', async ({ page }) => {
    await page.goto('/social-media');
    await expect(page.getByText('Social Media Monitoring')).toBeVisible();
    await page.getByText('Command Center').click();
    await expect(page).toHaveURL('/');
  });

  test('unauthenticated access redirects to login', async ({ page }) => {
    // Clear auth state
    await page.evaluate(() => localStorage.removeItem('safeschool_token'));
    await page.goto('/visitors');
    await expect(page).toHaveURL('/login');
  });
});
