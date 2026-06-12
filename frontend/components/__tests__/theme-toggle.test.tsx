import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider } from "next-themes";
import { ThemeToggle } from "@/components/theme-toggle";

function wrap(ui: React.ReactElement) {
  return render(
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      {ui}
    </ThemeProvider>,
  );
}

describe("ThemeToggle", () => {
  it("toggles theme on click", async () => {
    wrap(<ThemeToggle />);
    const btn = await screen.findByRole("button", { name: /toggle theme/i });
    fireEvent.click(btn);
    expect(document.documentElement.className).toContain("dark");
    fireEvent.click(btn);
    expect(document.documentElement.className).not.toContain("dark");
  });
});
