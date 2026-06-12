import { expect, test } from "@playwright/test";

test("redirects / to /en and renders English nav", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.url()).toContain("/en");
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
});

test("/zh-TW renders Chinese nav", async ({ page }) => {
  await page.goto("/zh-TW");
  await expect(page.getByRole("link", { name: "首頁" })).toBeVisible();
});
