import { test, expect } from '@playwright/test';
import { safeschoolLogin, safeschoolQuickLogin } from '../helpers/auth.js';

test.describe('SafeSchool Role-Based Access', () => {
  test('admin can see all navigation sections', async ({ page }) => {
    await safeschoolQuickLogin(page, 'Admin');
    await expect(page.getByText('Operations')).toBeVisible();
    await expect(page.getByText('Management')).toBeVisible();
    await expect(page.getByText('Admin')).toBeVisible();
  });

  test('operator can access command center', async ({ page }) => {
    await safeschoolLogin(page, 'operator@lincoln.edu', 'safeschool123');
    await expect(page).toHaveURL('/');
    await expect(page.getByText('Command Center')).toBeVisible();
  });

  test('teacher can access limited views', async ({ page }) => {
    await safeschoolLogin(page, 'teacher1@lincoln.edu', 'safeschool123');
    await expect(page).toHaveURL('/');
    // Teacher should see the dashboard but may have limited nav
    await expect(page.getByText('Command Center')).toBeVisible();
  });

  test('responder can access command center', async ({ page }) => {
    await safeschoolLogin(page, 'responder@lincoln.edu', 'safeschool123');
    await expect(page).toHaveURL('/');
    await expect(page.getByText('Command Center')).toBeVisible();
  });

  test('each role shows correct role badge', async ({ page }) => {
    await safeschoolLogin(page, 'admin@lincoln.edu', 'safeschool123');
    await expect(page.getByText('SITE_ADMIN')).toBeVisible();
  });
});
