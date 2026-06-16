import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useHoldingCategories } from "@/lib/use-holding-categories";

beforeEach(() => localStorage.clear());

describe("useHoldingCategories", () => {
  it("adds a category and assigns a ticker, persisting to localStorage", () => {
    const { result } = renderHook(() => useHoldingCategories());

    let id = "";
    act(() => { id = result.current.addCategory("Long-term"); });
    expect(result.current.categories).toEqual([{ id, name: "Long-term" }]);

    act(() => result.current.assign("AAPL", id));
    expect(result.current.assignments).toEqual({ AAPL: id });

    const stored = JSON.parse(localStorage.getItem("stance-radar-categories")!);
    expect(stored.assignments).toEqual({ AAPL: id });
  });

  it("renames a category", () => {
    const { result } = renderHook(() => useHoldingCategories());
    let id = "";
    act(() => { id = result.current.addCategory("a"); });
    act(() => result.current.renameCategory(id, "b"));
    expect(result.current.categories[0].name).toBe("b");
  });

  it("deleting a category clears its assignments", () => {
    const { result } = renderHook(() => useHoldingCategories());
    let id = "";
    act(() => { id = result.current.addCategory("a"); });
    act(() => result.current.assign("AAPL", id));
    act(() => result.current.deleteCategory(id));
    expect(result.current.categories).toEqual([]);
    expect(result.current.assignments).toEqual({});
  });

  it("assigning null unassigns the ticker", () => {
    const { result } = renderHook(() => useHoldingCategories());
    let id = "";
    act(() => { id = result.current.addCategory("a"); });
    act(() => result.current.assign("AAPL", id));
    act(() => result.current.assign("AAPL", null));
    expect(result.current.assignments).toEqual({});
  });

  it("loads existing state from localStorage on mount", () => {
    localStorage.setItem("stance-radar-categories", JSON.stringify({
      categories: [{ id: "x", name: "Seed" }], assignments: { MSFT: "x" },
    }));
    const { result } = renderHook(() => useHoldingCategories());
    expect(result.current.categories).toEqual([{ id: "x", name: "Seed" }]);
    expect(result.current.assignments).toEqual({ MSFT: "x" });
    // mounting must NOT overwrite the stored data
    expect(JSON.parse(localStorage.getItem("stance-radar-categories")!))
      .toEqual({ categories: [{ id: "x", name: "Seed" }], assignments: { MSFT: "x" } });
  });
});
