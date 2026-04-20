import { test, expect } from '@playwright/test';
import { safeschoolQuickLogin } from '../helpers/auth.js';

test.describe('SafeSchool AI Insights Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await safeschoolQuickLogin(page, 'Admin');
  });

  test('AI Insights nav group is visible in sidebar', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    const sidebar = page.locator('.sidebar-group');
    await expect(page.getByText('AI Insights')).toBeVisible();
  });

  test('Anomaly Alerts section loads', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.getByText('Anomaly Alerts').click();
    await page.waitForTimeout(1000);
    // Should load without errors
    await expect(page.locator('.error-banner')).not.toBeVisible();
  });

  test('Visitor Risk section loads', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.getByText('Visitor Risk').click();
    await page.waitForTimeout(1000);
    await expect(page.locator('.error-banner')).not.toBeVisible();
  });

  test('Schedule Optimizer section loads', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.getByText('Schedule Optimizer').click();
    await page.waitForTimeout(1000);
    await expect(page.locator('.error-banner')).not.toBeVisible();
  });

  test('Command Center section loads', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.getByText('Command Center').click();
    await page.waitForTimeout(1000);
    await expect(page.locator('.error-banner')).not.toBeVisible();
  });

  test('AI status endpoint responds', async ({ page, baseURL }) => {
    const response = await page.request.get(`${baseURL}/api/v1/ai/status`);
    expect(response.ok()).toBe(true);
    const data = await response.json();
    expect(data).toHaveProperty('aiEnabled');
    expect(data).toHaveProperty('apiKeyConfigured');
    expect(data).toHaveProperty('adapters');
  });

  test('Anomaly stats endpoint responds', async ({ page, baseURL }) => {
    const response = await page.request.get(`${baseURL}/api/v1/ai/anomalies/stats`);
    expect(response.ok()).toBe(true);
    const data = await response.json();
    expect(data).toHaveProperty('total');
    expect(data).toHaveProperty('bySeverity');
    expect(data).toHaveProperty('byType');
  });

  test('Recent visitor risk scores endpoint responds', async ({ page, baseURL }) => {
    const response = await page.request.get(`${baseURL}/api/v1/ai/visitor-risk/recent`);
    expect(response.ok()).toBe(true);
    const data = await response.json();
    expect(data).toHaveProperty('scores');
    expect(data).toHaveProperty('total');
  });
});

test.describe('SafeSchool Compliance Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await safeschoolQuickLogin(page, 'Admin');
  });

  test('Compliance nav sections are visible', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Compliance Audit')).toBeVisible();
    await expect(page.getByText('NDAA Components')).toBeVisible();
    await expect(page.getByText('Lockdown SLA')).toBeVisible();
  });

  test('Compliance audit endpoint responds', async ({ page, baseURL }) => {
    const response = await page.request.get(`${baseURL}/api/v1/compliance/audit`);
    expect(response.ok()).toBe(true);
    const data = await response.json();
    expect(data).toHaveProperty('entries');
  });

  test('NDAA assessment endpoint responds', async ({ page, baseURL }) => {
    const response = await page.request.get(`${baseURL}/api/v1/compliance/ndaa/assess`);
    expect(response.ok()).toBe(true);
    const data = await response.json();
    expect(data).toHaveProperty('overallStatus');
  });

  test('Lockdown SLA endpoint responds', async ({ page, baseURL }) => {
    const response = await page.request.get(`${baseURL}/api/v1/compliance/lockdown-sla`);
    expect(response.ok()).toBe(true);
    const data = await response.json();
    expect(data).toHaveProperty('metrics');
  });

  test('Frameworks list endpoint responds', async ({ page, baseURL }) => {
    const response = await page.request.get(`${baseURL}/api/v1/compliance/frameworks`);
    expect(response.ok()).toBe(true);
    const data = await response.json();
    expect(data.frameworks.length).toBeGreaterThan(0);
  });
});
