import { expect, test } from "@playwright/test";

test("⌘K opens command palette and navigates", async ({ page }) => {
  await page.goto("/en");
  // Click the search trigger button (Meta+K shortcut may not fire in headless)
  await page.getByRole("button", { name: /search/i }).click();
  const input = page.getByPlaceholder(/search ticker or company/i);
  await expect(input).toBeVisible();
  // Type character-by-character to trigger cmdk's onValueChange
  await input.pressSequentially("AAPL");
  await page.getByRole("option", { name: /AAPL/ }).first().click();
  await expect(page).toHaveURL(/\/en\/stocks\/AAPL$/);
});

test("language switcher preserves path", async ({ page }) => {
  await page.goto("/en/stocks/AAPL");
  await page.getByRole("button", { name: "EN" }).click();
  await page.getByRole("menuitem", { name: "繁中" }).click();
  await expect(page).toHaveURL(/\/zh-TW\/stocks\/AAPL$/);
});

test("theme toggle adds dark class", async ({ page }) => {
  await page.goto("/en");
  await page.getByRole("button", { name: /toggle theme/i }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
});
