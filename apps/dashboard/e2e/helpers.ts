import { type Page, expect } from '@playwright/test';

/**
 * Login as a specific user. Defaults to admin.
 */
export async function login(
  page: Page,
  email = 'admin@lincoln.edu',
  password = 'safeschool123',
) {
  await page.goto('/login');
  await page.getByLabel('Email Address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page).toHaveURL('/', { timeout: 10000 });
}

export async function loginAsAdmin(page: Page) {
  return login(page, 'admin@lincoln.edu');
}

export async function loginAsOperator(page: Page) {
  return login(page, 'operator@lincoln.edu');
}

export async function loginAsTeacher(page: Page) {
  return login(page, 'teacher1@lincoln.edu');
}

export async function loginAsResponder(page: Page) {
  return login(page, 'responder@lincoln.edu');
}
