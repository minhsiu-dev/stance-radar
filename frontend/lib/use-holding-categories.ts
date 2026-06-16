"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "stance-radar-categories";

export interface Category {
  id: string;
  name: string;
}

interface CategoriesState {
  categories: Category[];
  assignments: Record<string, string>; // ticker -> category id
}

export interface UseHoldingCategories extends CategoriesState {
  addCategory: (name: string) => string; // returns the new id
  renameCategory: (id: string, name: string) => void;
  deleteCategory: (id: string) => void;
  assign: (ticker: string, categoryId: string | null) => void;
}

const EMPTY: CategoriesState = { categories: [], assignments: {} };

export function useHoldingCategories(): UseHoldingCategories {
  const [state, setState] = useState<CategoriesState>(EMPTY);

  // SSR has no localStorage -> read only after mount (avoids hydration mismatch).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setState(JSON.parse(raw) as CategoriesState);
    } catch {
      /* ignore malformed storage */
    }
  }, []);

  // Persist inside the updater (same idiom as privacy-provider) so the
  // after-mount hydration read never writes EMPTY back over stored data.
  const update = useCallback(
    (fn: (s: CategoriesState) => CategoriesState) => {
      setState((s) => {
        const next = fn(s);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    },
    [],
  );

  const addCategory = useCallback(
    (name: string) => {
      const id = crypto.randomUUID();
      update((s) => ({ ...s, categories: [...s.categories, { id, name }] }));
      return id;
    },
    [update],
  );

  const renameCategory = useCallback(
    (id: string, name: string) => {
      update((s) => ({
        ...s,
        categories: s.categories.map((c) => (c.id === id ? { ...c, name } : c)),
      }));
    },
    [update],
  );

  const deleteCategory = useCallback(
    (id: string) => {
      update((s) => ({
        categories: s.categories.filter((c) => c.id !== id),
        assignments: Object.fromEntries(
          Object.entries(s.assignments).filter(([, v]) => v !== id),
        ),
      }));
    },
    [update],
  );

  const assign = useCallback(
    (ticker: string, categoryId: string | null) => {
      update((s) => {
        const assignments = { ...s.assignments };
        if (categoryId === null) delete assignments[ticker];
        else assignments[ticker] = categoryId;
        return { ...s, assignments };
      });
    },
    [update],
  );

  return { ...state, addCategory, renameCategory, deleteCategory, assign };
}
