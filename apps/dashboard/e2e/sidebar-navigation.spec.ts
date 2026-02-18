import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers';

test.describe('Sidebar Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test.describe('sidebar structure', () => {
    test('shows section headers', async ({ page }) => {
      await expect(page.getByText('Operations')).toBeVisible({ timeout: 10000 });
      await expect(page.getByText('Safety')).toBeVisible();
      await expect(page.getByText('Management')).toBeVisible();
      await expect(page.getByText('Admin')).toBeVisible();
    });

    test('shows all navigation links', async ({ page }) => {
      await expect(page.getByRole('link', { name: 'Command Center' })).toBeVisible({ timeout: 10000 });
      await expect(page.getByRole('link', { name: 'Floor Plan' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Drills' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Reunification' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Threats' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Social Media' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Visitors' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Transportation' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Reports' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Audit Log' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Grants' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Compliance' })).toBeVisible();
    });

    test('shows SafeSchool brand in sidebar header', async ({ page }) => {
      await expect(page.getByRole('link', { name: 'SafeSchool' })).toBeVisible({ timeout: 10000 });
    });

    test('shows user email and role in sidebar footer', async ({ page }) => {
      await expect(page.getByText('admin@lincoln.edu')).toBeVisible({ timeout: 10000 });
      await expect(page.getByText('SITE_ADMIN')).toBeVisible();
    });
  });

  test.describe('active state highlighting', () => {
    test('Command Center link is active on root path', async ({ page }) => {
      const link = page.getByRole('link', { name: 'Command Center' });
      await link.waitFor({ timeout: 10000 });
      await expect(link).toHaveClass(/text-blue-400/);
    });

    test('Floor Plan link is active on /floor-plan', async ({ page }) => {
      await page.goto('/floor-plan');
      const link = page.getByRole('link', { name: 'Floor Plan' });
      await link.waitFor({ timeout: 10000 });
      await expect(link).toHaveClass(/text-blue-400/);
    });

    test('Drills link is active on /drills', async ({ page }) => {
      await page.goto('/drills');
      const link = page.getByRole('link', { name: 'Drills' });
      await link.waitFor({ timeout: 10000 });
      await expect(link).toHaveClass(/text-blue-400/);
    });

    test('Visitors link is active on /visitors', async ({ page }) => {
      await page.goto('/visitors');
      const link = page.getByRole('link', { name: 'Visitors' });
      await link.waitFor({ timeout: 10000 });
      await expect(link).toHaveClass(/text-blue-400/);
    });

    test('Reports link is active on /reports', async ({ page }) => {
      await page.goto('/reports');
      const link = page.getByRole('link', { name: 'Reports' });
      await link.waitFor({ timeout: 10000 });
      await expect(link).toHaveClass(/text-blue-400/);
    });

    test('previously active link becomes inactive after navigation', async ({ page }) => {
      // On root, Command Center should be active
      const ccLink = page.getByRole('link', { name: 'Command Center' });
      await ccLink.waitFor({ timeout: 10000 });
      await expect(ccLink).toHaveClass(/text-blue-400/);

      // Navigate to Visitors
      await page.getByRole('link', { name: 'Visitors' }).click();
      await expect(page).toHaveURL('/visitors');

      // Command Center should no longer be active
      await expect(ccLink).not.toHaveClass(/text-blue-400/);
      // Visitors should be active
      await expect(page.getByRole('link', { name: 'Visitors' })).toHaveClass(/text-blue-400/);
    });
  });

  test.describe('sidebar collapse', () => {
    test('sidebar can be collapsed', async ({ page }) => {
      // Find collapse button by its title
      const collapseBtn = page.getByTitle('Collapse sidebar');
      await collapseBtn.waitFor({ timeout: 10000 });

      await collapseBtn.click();

      // After collapse, the section headers should be hidden
      await expect(page.getByText('Operations')).not.toBeVisible();
      await expect(page.getByText('Safety')).not.toBeVisible();

      // Expand button should appear
      await expect(page.getByTitle('Expand sidebar')).toBeVisible();
    });

    test('collapsed sidebar can be expanded again', async ({ page }) => {
      // Collapse
      const collapseBtn = page.getByTitle('Collapse sidebar');
      await collapseBtn.waitFor({ timeout: 10000 });
      await collapseBtn.click();

      // Expand
      await page.getByTitle('Expand sidebar').click();

      // Section headers visible again
      await expect(page.getByText('Operations')).toBeVisible();
      await expect(page.getByText('Safety')).toBeVisible();
    });
  });

  test.describe('top bar', () => {
    test('shows page title that matches current page', async ({ page }) => {
      // On root, should show "Command Center"
      await expect(page.locator('h1', { hasText: 'Command Center' })).toBeVisible({ timeout: 10000 });
    });

    test('shows site name in top bar', async ({ page }) => {
      await expect(page.getByText('Lincoln Elementary')).toBeVisible({ timeout: 10000 });
    });

    test('shows visitor count in status indicators', async ({ page }) => {
      await expect(page.getByText('Visitors:')).toBeVisible({ timeout: 10000 });
    });

    test('shows bus count in status indicators', async ({ page }) => {
      await expect(page.getByText('Buses:')).toBeVisible({ timeout: 10000 });
    });

    test('shows user name', async ({ page }) => {
      await expect(page.getByText('Dr. Sarah Mitchell')).toBeVisible({ timeout: 10000 });
    });

    test('shows Sign Out button', async ({ page }) => {
      await expect(page.getByText('Sign Out')).toBeVisible({ timeout: 10000 });
    });

    test('page title changes when navigating', async ({ page }) => {
      await expect(page.locator('h1', { hasText: 'Command Center' })).toBeVisible({ timeout: 10000 });

      await page.getByRole('link', { name: 'Floor Plan' }).click();
      await expect(page.locator('h1', { hasText: 'Floor Plan' })).toBeVisible();

      await page.getByRole('link', { name: 'Drills' }).click();
      await expect(page.locator('h1', { hasText: 'Drills' })).toBeVisible();
    });
  });

  test.describe('navigate to all pages via sidebar', () => {
    test('navigate to Floor Plan', async ({ page }) => {
      await page.getByRole('link', { name: 'Floor Plan' }).click();
      await expect(page).toHaveURL('/floor-plan');
    });

    test('navigate to Drills', async ({ page }) => {
      await page.getByRole('link', { name: 'Drills' }).click();
      await expect(page).toHaveURL('/drills');
    });

    test('navigate to Reunification', async ({ page }) => {
      await page.getByRole('link', { name: 'Reunification' }).click();
      await expect(page).toHaveURL('/reunification');
    });

    test('navigate to Reports', async ({ page }) => {
      await page.getByRole('link', { name: 'Reports' }).click();
      await expect(page).toHaveURL('/reports');
    });

    test('navigate to Audit Log', async ({ page }) => {
      await page.getByRole('link', { name: 'Audit Log' }).click();
      await expect(page).toHaveURL('/audit-log');
    });

    test('navigate to Grants', async ({ page }) => {
      await page.getByRole('link', { name: 'Grants' }).click();
      await expect(page).toHaveURL('/grants');
    });
  });
});
