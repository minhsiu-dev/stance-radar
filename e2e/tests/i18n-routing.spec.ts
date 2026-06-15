import { expect, test } from "@playwright/test";

test("redirects / to /en and renders English nav", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.url()).toContain("/en");
  await expect(
    page.getByRole("link", { name: "Portfolio", exact: true }),
  ).toBeVisible();
});

test("/zh-TW renders Chinese nav", async ({ page }) => {
  await page.goto("/zh-TW");
  await expect(
    page.getByRole("link", { name: "持股", exact: true }),
  ).toBeVisible();
});

test("gear language switch routes to /zh-TW and back to /en", async ({
  page,
}) => {
  await page.goto("/en");
  // Open the settings gear and pick the Traditional Chinese locale
  await page.getByRole("button", { name: /settings/i }).click();
  await page.getByRole("menuitemcheckbox", { name: "繁中" }).click();
  await expect(page).toHaveURL(/\/zh-TW\/?$/);
  await expect(
    page.getByRole("link", { name: "持股", exact: true }),
  ).toBeVisible();

  // Switch back to EN via the gear (its aria-label is the Chinese word for "settings")
  await page.getByRole("button", { name: /設定|settings/i }).click();
  await page.getByRole("menuitemcheckbox", { name: "EN" }).click();
  await expect(page).toHaveURL(/\/en\/?$/);
  await expect(
    page.getByRole("link", { name: "Portfolio", exact: true }),
  ).toBeVisible();
});
