import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers';

test.describe('Transportation Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/transportation');
    await expect(page.getByText('Student Transportation')).toBeVisible();
  });

  test('shows page header', async ({ page }) => {
    await expect(page.getByText('Student Transportation')).toBeVisible();
  });

  test('shows bus status grid with seed data', async ({ page }) => {
    // Bus #42 from seed data
    await expect(page.getByText('42').or(page.getByText('Bus'))).toBeVisible({ timeout: 10000 });
  });

  test('shows bus capabilities badges', async ({ page }) => {
    // Bus #42 has RFID, panic, cameras from seed
    await expect(page.getByText(/RFID|Panic|Camera/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('back link returns to command center', async ({ page }) => {
    await page.getByText('Command Center').click();
    await expect(page).toHaveURL('/');
  });
});
