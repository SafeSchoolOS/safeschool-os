import { test, expect } from '@playwright/test';
import { safeschoolLogin, safeschoolLoginAsAdmin, safeschoolQuickLogin } from '../helpers/auth.js';

test.describe('SafeSchool Login', () => {
  test('shows login page with email and password fields', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel('Email Address')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
  });

  test('shows demo quick-login buttons', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Admin' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Operator' })).toBeVisible();
  });

  test('login with valid admin credentials redirects to dashboard', async ({ page }) => {
    await safeschoolLoginAsAdmin(page);
    await expect(page).toHaveURL('/');
    await expect(page.getByText('Command Center')).toBeVisible();
  });

  test('login with invalid credentials shows error', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email Address').fill('bad@example.com');
    await page.getByLabel('Password').fill('wrongpassword');
    await page.getByRole('button', { name: 'Sign In' }).click();
    // Should stay on login page or show error
    await expect(page).toHaveURL(/\/login/);
  });

  test('quick-login as Admin works', async ({ page }) => {
    await safeschoolQuickLogin(page, 'Admin');
    await expect(page).toHaveURL('/');
  });

  test('logout returns to login page', async ({ page }) => {
    await safeschoolLoginAsAdmin(page);
    await page.getByRole('button', { name: 'Sign Out' }).click();
    await expect(page).toHaveURL(/\/login/);
  });
});
