import { describe, expect, it } from "vitest";
import { routing } from "@/i18n/routing";

describe("routing", () => {
  it("lists en and zh-TW", () => {
    expect(routing.locales).toEqual(["en", "zh-TW"]);
  });
  it("defaults to en", () => {
    expect(routing.defaultLocale).toBe("en");
  });
});
