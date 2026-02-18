import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers';

test.describe('Floor Plan Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/floor-plan');
  });

  test('renders floor plan page with SVG canvas', async ({ page }) => {
    // The floor plan should render an SVG element
    const svg = page.locator('svg').first();
    await expect(svg).toBeVisible({ timeout: 10000 });
  });

  test('shows building selector buttons', async ({ page }) => {
    // Lincoln Elementary has Main Building and Annex Building
    await expect(page.getByRole('button', { name: 'Main Building' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Annex Building' })).toBeVisible();
  });

  test('can switch between buildings', async ({ page }) => {
    const mainBtn = page.getByRole('button', { name: 'Main Building' });
    const annexBtn = page.getByRole('button', { name: 'Annex Building' });

    await mainBtn.waitFor({ timeout: 10000 });

    // Main Building should be selected by default (blue bg)
    await expect(mainBtn).toHaveClass(/bg-blue-600/);

    // Click Annex Building
    await annexBtn.click();
    await expect(annexBtn).toHaveClass(/bg-blue-600/);
    await expect(mainBtn).not.toHaveClass(/bg-blue-600/);
  });

  test('shows room names in the SVG', async ({ page }) => {
    // Wait for rooms to render in the SVG
    // Rooms from seed data in Main Building: Main Office, Room 101, Room 102, etc.
    const svgText = page.locator('svg text');
    await expect(svgText.first()).toBeVisible({ timeout: 10000 });

    // Check that at least some room text is rendered
    const textCount = await svgText.count();
    expect(textCount).toBeGreaterThan(0);
  });

  test('shows door status in the All Doors sidebar panel', async ({ page }) => {
    await expect(page.getByText('All Doors')).toBeVisible({ timeout: 10000 });

    // Should show door names from seed data
    await expect(page.getByText('Main Entrance').first()).toBeVisible();
  });

  test('door list shows status indicators', async ({ page }) => {
    await expect(page.getByText('All Doors')).toBeVisible({ timeout: 10000 });

    // Each door should have a status label (LOCKED, UNLOCKED, etc.)
    await expect(page.getByText(/LOCKED|UNLOCKED/).first()).toBeVisible();
  });

  test('clicking a door in the list shows details panel', async ({ page }) => {
    await expect(page.getByText('All Doors')).toBeVisible({ timeout: 10000 });

    // Click on a door in the sidebar list
    const doorButton = page.locator('button').filter({ hasText: 'Main Entrance' }).first();
    await doorButton.click();

    // Should show door detail panel with status and lock/unlock buttons
    await expect(page.getByRole('button', { name: 'Lock' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Unlock' })).toBeVisible();
  });

  test('door detail panel shows door type information', async ({ page }) => {
    await expect(page.getByText('All Doors')).toBeVisible({ timeout: 10000 });

    // Click on a door
    const doorButton = page.locator('button').filter({ hasText: 'Main Entrance' }).first();
    await doorButton.click();

    // Should show Status and Type labels
    await expect(page.getByText('Status')).toBeVisible();
    await expect(page.getByText('Type')).toBeVisible();
    await expect(page.getByText(/Exterior|Interior/)).toBeVisible();
  });

  test('shows hint text when no door is selected', async ({ page }) => {
    await expect(page.getByText('Click a door on the map to view details and controls')).toBeVisible({ timeout: 10000 });
  });

  test('admin users see Edit Layout button', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Edit Layout' })).toBeVisible({ timeout: 10000 });
  });

  test('edit mode shows instruction banner and save/cancel buttons', async ({ page }) => {
    await page.getByRole('button', { name: 'Edit Layout' }).click();

    await expect(page.getByText('Drag rooms and doors to reposition them')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save Layout' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  });

  test('cancel edit mode returns to normal view', async ({ page }) => {
    await page.getByRole('button', { name: 'Edit Layout' }).click();
    await expect(page.getByText('Drag rooms and doors to reposition them')).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Drag rooms and doors to reposition them')).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit Layout' })).toBeVisible();
  });

  test('SVG contains status legend', async ({ page }) => {
    // The SVG legend shows all door status types
    const svg = page.locator('svg').first();
    await expect(svg).toBeVisible({ timeout: 10000 });

    // Check for legend text items within SVG
    await expect(svg.getByText('Locked')).toBeVisible();
    await expect(svg.getByText('Unlocked')).toBeVisible();
  });
});
