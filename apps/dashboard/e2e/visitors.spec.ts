import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers';

test.describe('Visitor Management', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/visitors');
    await expect(page.getByText('Visitor Management')).toBeVisible();
  });

  test('shows page header with visitor count', async ({ page }) => {
    await expect(page.getByText(/\d+ visitor records/)).toBeVisible({ timeout: 10000 });
  });

  test('shows visitor check-in form', async ({ page }) => {
    // The form should be in the right column
    await expect(page.getByPlaceholder('First name').or(page.getByText('First Name').first())).toBeVisible({ timeout: 10000 });
  });

  test('shows pre-registered visitor from seed data', async ({ page }) => {
    // Robert Wilson is the pre-registered visitor
    await expect(page.getByText('Robert').or(page.getByText('Wilson'))).toBeVisible({ timeout: 10000 });
  });

  test('back link returns to command center', async ({ page }) => {
    await page.getByText('Command Center').click();
    await expect(page).toHaveURL('/');
    await expect(page.getByText('SafeSchool OS')).toBeVisible();
  });
});
