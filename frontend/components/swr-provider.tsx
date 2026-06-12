"use client";

import { SWRConfig } from "swr";
import { apiFetch } from "@/lib/api";

export function SWRProvider({ children }: { children: React.ReactNode }) {
  return <SWRConfig value={{ fetcher: apiFetch }}>{children}</SWRConfig>;
}
