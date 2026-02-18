import { test, expect } from '@playwright/test';

test.describe('Login Flow', () => {
  test('shows login page when not authenticated', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('SafeSchool OS')).toBeVisible();
    await expect(page.getByText('Command Center Login')).toBeVisible();
    await expect(page.getByLabel('Email Address')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
  });

  test('shows error with invalid credentials', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email Address').fill('wrong@example.com');
    await page.getByLabel('Password').fill('wrongpassword');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByText(/Invalid credentials|Login failed/)).toBeVisible();
  });

  test('login with valid credentials redirects to dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email Address').fill('admin@lincoln.edu');
    await page.getByLabel('Password').fill('safeschool123');
    await page.getByRole('button', { name: 'Sign In' }).click();

    // Should redirect to command center
    await expect(page).toHaveURL('/');
    await expect(page.getByText('Lincoln Elementary')).toBeVisible({ timeout: 10000 });
  });

  test('quick login buttons work', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Admin' }).click();

    // Should redirect to command center
    await expect(page).toHaveURL('/');
  });

  test('logout returns to login page', async ({ page }) => {
    // Login first
    await page.goto('/login');
    await page.getByLabel('Email Address').fill('admin@lincoln.edu');
    await page.getByLabel('Password').fill('safeschool123');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page).toHaveURL('/');

    // Logout
    await page.getByRole('button', { name: /logout|sign out/i }).click();
    await expect(page).toHaveURL('/login');
  });
});
