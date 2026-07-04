import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));
const privacy = { unlock: vi.fn() };
vi.mock("@/components/privacy-provider", () => ({ usePrivacy: () => privacy }));

import { UnlockDialog } from "@/components/unlock-dialog";

describe("UnlockDialog", () => {
  it("submits the password and closes on success", async () => {
    privacy.unlock = vi.fn().mockResolvedValue(true);
    const onOpenChange = vi.fn();
    render(<UnlockDialog open onOpenChange={onOpenChange} />);
    await userEvent.type(screen.getByLabelText("passwordLabel"), "hunter2");
    await userEvent.click(screen.getByRole("button", { name: "unlock" }));
    expect(privacy.unlock).toHaveBeenCalledWith("hunter2");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows an error and stays open on wrong password", async () => {
    privacy.unlock = vi.fn().mockResolvedValue(false);
    const onOpenChange = vi.fn();
    render(<UnlockDialog open onOpenChange={onOpenChange} />);
    await userEvent.type(screen.getByLabelText("passwordLabel"), "nope");
    await userEvent.click(screen.getByRole("button", { name: "unlock" }));
    expect(await screen.findByTestId("unlock-error")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
