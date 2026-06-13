import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChannelAvatar } from "@/components/channel-avatar";

describe("ChannelAvatar", () => {
  it("renders the thumbnail image when given a url", () => {
    render(<ChannelAvatar title="My Channel" thumbnail="http://x/a.jpg" />);
    const img = screen.getByRole("img", { name: "My Channel" });
    expect(img.getAttribute("src")).toBe("http://x/a.jpg");
  });

  it("falls back to the first letter when no thumbnail", () => {
    render(<ChannelAvatar title="Zeta" thumbnail="" />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByTitle("Zeta").textContent).toBe("Z");
  });
});
