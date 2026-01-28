import { test, expect } from '@playwright/test';

test('explains a transaction digest', async ({ page }) => {
  await page.goto('/');
  await page.fill('input[type="text"]', '8Skh1mS7QyKc2rQWnGq9TnE6P7bJYmR1s3hYkM9JvYx');
  await page.click('button:has-text("Explain")');

  await expect(page.getByText('Transfer Flow')).toBeVisible();
  await expect(page.getByText('Executed 1 transfer')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Gas' })).toBeVisible();
});
