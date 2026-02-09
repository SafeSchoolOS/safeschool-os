import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers';

test.describe('Error Handling', () => {
  test.describe('unknown routes for unauthenticated users', () => {
    test('bad route redirects unauthenticated user to login', async ({ page }) => {
      await page.goto('/this-does-not-exist');
      // Unauthenticated users get redirected to /login for any unknown route
      await expect(page).toHaveURL('/login');
      await expect(page.getByText('Command Center Login')).toBeVisible();
    });

    test('deeply nested bad route redirects to login', async ({ page }) => {
      await page.goto('/some/deeply/nested/fake/path');
      await expect(page).toHaveURL('/login');
    });
  });

  test.describe('unknown routes for authenticated users', () => {
    test.beforeEach(async ({ page }) => {
      await loginAsAdmin(page);
    });

    test('bad route for authenticated user renders within dashboard layout', async ({ page }) => {
      await page.goto('/nonexistent-page');

      // The DashboardLayout should still render (sidebar, top bar)
      // Since there is no matching route inside DashboardLayout, the Outlet renders nothing
      // The sidebar should still be visible
      await expect(page.getByRole('link', { name: 'Command Center' })).toBeVisible({ timeout: 10000 });

      // The Sign Out button should still be visible (we are still authenticated)
      await expect(page.getByText('Sign Out')).toBeVisible();
    });

    test('navigating to unknown path keeps sidebar functional', async ({ page }) => {
      await page.goto('/unknown-path-xyz');

      // Should still be able to navigate via sidebar
      await expect(page.getByRole('link', { name: 'Command Center' })).toBeVisible({ timeout: 10000 });
      await page.getByRole('link', { name: 'Command Center' }).click();
      await expect(page).toHaveURL('/');
      await expect(page.getByText('Emergency Actions')).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('auth protection', () => {
    test('clearing token and navigating redirects to login', async ({ page }) => {
      await loginAsAdmin(page);
      await expect(page.getByText('Emergency Actions')).toBeVisible({ timeout: 10000 });

      // Clear the authentication token
      await page.evaluate(() => localStorage.removeItem('safeschool_token'));

      // Navigate to a protected page
      await page.goto('/visitors');
      await expect(page).toHaveURL('/login');
    });

    test('all protected routes redirect when unauthenticated', async ({ page }) => {
      const protectedRoutes = [
        '/',
        '/visitors',
        '/transportation',
        '/threat-assessment',
        '/social-media',
        '/drills',
        '/reunification',
        '/grants',
        '/audit-log',
        '/badgekiosk',
        '/floor-plan',
        '/reports',
      ];

      for (const route of protectedRoutes) {
        await page.goto(route);
        await expect(page).toHaveURL('/login', {
          timeout: 5000,
        });
      }
    });
  });

  test.describe('Sign Out flow', () => {
    test('Sign Out clears session and returns to login', async ({ page }) => {
      await loginAsAdmin(page);
      await expect(page.getByText('Emergency Actions')).toBeVisible({ timeout: 10000 });

      // Click Sign Out
      await page.getByText('Sign Out').click();
      await expect(page).toHaveURL('/login');
      await expect(page.getByText('Command Center Login')).toBeVisible();
    });

    test('after Sign Out, navigating to protected route redirects to login', async ({ page }) => {
      await loginAsAdmin(page);
      await expect(page.getByText('Emergency Actions')).toBeVisible({ timeout: 10000 });

      // Sign out
      await page.getByText('Sign Out').click();
      await expect(page).toHaveURL('/login');

      // Try to access a protected route
      await page.goto('/visitors');
      await expect(page).toHaveURL('/login');
    });
  });
});
