"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
  const hydrated = useRef(false);

  // SSR has no localStorage -> read only after mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setState(JSON.parse(raw) as CategoriesState);
    } catch {
      /* ignore malformed storage */
    }
    hydrated.current = true;
  }, []);

  // Persist after hydration so we never overwrite storage with the initial EMPTY.
  useEffect(() => {
    if (hydrated.current) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
  }, [state]);

  const addCategory = useCallback((name: string) => {
    const id = crypto.randomUUID();
    setState((s) => ({ ...s, categories: [...s.categories, { id, name }] }));
    return id;
  }, []);

  const renameCategory = useCallback((id: string, name: string) => {
    setState((s) => ({
      ...s,
      categories: s.categories.map((c) => (c.id === id ? { ...c, name } : c)),
    }));
  }, []);

  const deleteCategory = useCallback((id: string) => {
    setState((s) => ({
      categories: s.categories.filter((c) => c.id !== id),
      assignments: Object.fromEntries(
        Object.entries(s.assignments).filter(([, v]) => v !== id),
      ),
    }));
  }, []);

  const assign = useCallback((ticker: string, categoryId: string | null) => {
    setState((s) => {
      const assignments = { ...s.assignments };
      if (categoryId === null) delete assignments[ticker];
      else assignments[ticker] = categoryId;
      return { ...s, assignments };
    });
  }, []);

  return { ...state, addCategory, renameCategory, deleteCategory, assign };
}
