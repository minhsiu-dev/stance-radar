import { expect, test } from "@playwright/test";

test("gear menu hides portfolio amounts", async ({ page }) => {
  await page.goto("/en/portfolio");
  // The portfolio summary always renders three amount cards (market value /
  // cost basis / unrealized P/L), so privacy masking shows •••• even with an
  // empty portfolio. Wait for the summary to load before toggling.
  await expect(page.getByText("Market value")).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: /settings/i }).click();
  await page
    .getByRole("menuitemcheckbox", { name: /hide amounts/i })
    .click();
  // Dismiss the menu so it doesn't overlay the masked content
  await page.keyboard.press("Escape");

  await expect(page.getByText("••••").first()).toBeVisible();
});

test("channel page switches between videos and scorecard tabs", async ({
  page,
}) => {
  // Ensure the fake Alpha channel exists (idempotent — "already exists" is fine)
  await page.goto("/en/channels");
  await page.getByPlaceholder(/channel ID/i).fill("UC_fake_alpha");
  await page.getByRole("button", { name: /^add$/i }).click();
  await expect(page.getByText(/added|already exists/i)).toBeVisible({
    timeout: 10_000,
  });

  await page.goto("/en/channels");
  await page.getByRole("link", { name: /alpha/i }).first().click();
  await expect(page).toHaveURL(/\/en\/channels\/UC_fake_alpha/);

  // Default tab is Videos
  await expect(page.getByRole("tab", { name: /videos/i })).toBeVisible();

  // Switch to Scorecard — its header references the SPY benchmark
  await page.getByRole("tab", { name: /scorecard/i }).click();
  await expect(page.getByText(/benchmark|SPY/i).first()).toBeVisible({
    timeout: 15_000,
  });
});
