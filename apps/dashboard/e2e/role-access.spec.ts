import { test, expect } from '@playwright/test';
import { loginAsAdmin, loginAsOperator, loginAsTeacher, loginAsResponder } from './helpers';

test.describe('Role-Based Access', () => {
  test.describe('Admin user', () => {
    test('can access command center', async ({ page }) => {
      await loginAsAdmin(page);
      await expect(page.getByText('Emergency Actions')).toBeVisible({ timeout: 10000 });
      await expect(page.getByText('SITE_ADMIN')).toBeVisible();
    });

    test('can access all navigation links', async ({ page }) => {
      await loginAsAdmin(page);
      await expect(page.getByRole('link', { name: 'Visitors' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Transportation' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Threats' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Social Media' })).toBeVisible();
    });
  });

  test.describe('Operator user', () => {
    test('can access command center', async ({ page }) => {
      await loginAsOperator(page);
      await expect(page.getByText('Emergency Actions')).toBeVisible({ timeout: 10000 });
      await expect(page.getByText('OPERATOR')).toBeVisible();
    });

    test('shows operator name', async ({ page }) => {
      await loginAsOperator(page);
      await expect(page.getByText('James Rodriguez')).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Teacher user', () => {
    test('can access command center', async ({ page }) => {
      await loginAsTeacher(page);
      await expect(page.getByText('Emergency Actions')).toBeVisible({ timeout: 10000 });
      await expect(page.getByText('TEACHER')).toBeVisible();
    });

    test('shows teacher name', async ({ page }) => {
      await loginAsTeacher(page);
      await expect(page.getByText('Emily Chen')).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('First Responder user', () => {
    test('can access command center', async ({ page }) => {
      await loginAsResponder(page);
      await expect(page.getByText('Emergency Actions')).toBeVisible({ timeout: 10000 });
      await expect(page.getByText('FIRST_RESPONDER')).toBeVisible();
    });

    test('shows responder name', async ({ page }) => {
      await loginAsResponder(page);
      await expect(page.getByText('Officer David Park')).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Quick login buttons', () => {
    test('Admin quick login works', async ({ page }) => {
      await page.goto('/login');
      await page.getByRole('button', { name: 'Admin' }).click();
      await expect(page).toHaveURL('/');
      await expect(page.getByText('Dr. Sarah Mitchell')).toBeVisible({ timeout: 10000 });
    });

    test('Operator quick login works', async ({ page }) => {
      await page.goto('/login');
      await page.getByRole('button', { name: 'Operator' }).click();
      await expect(page).toHaveURL('/');
      await expect(page.getByText('James Rodriguez')).toBeVisible({ timeout: 10000 });
    });

    test('Teacher 1 quick login works', async ({ page }) => {
      await page.goto('/login');
      await page.getByRole('button', { name: 'Teacher 1' }).click();
      await expect(page).toHaveURL('/');
      await expect(page.getByText('Emily Chen')).toBeVisible({ timeout: 10000 });
    });

    test('Responder quick login works', async ({ page }) => {
      await page.goto('/login');
      await page.getByRole('button', { name: 'Responder' }).click();
      await expect(page).toHaveURL('/');
      await expect(page.getByText('Officer David Park')).toBeVisible({ timeout: 10000 });
    });
  });
});
