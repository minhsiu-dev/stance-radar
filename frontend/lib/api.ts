import type { Envelope } from "@/lib/types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (resp.status === 204) return null as T;
  let body: Envelope<T>;
  try {
    body = await resp.json();
  } catch {
    throw new ApiError(`Failed to parse server response (${resp.status})`, resp.status);
  }
  if (!resp.ok || !body.success) {
    throw new ApiError(body.error ?? `Request failed (${resp.status})`, resp.status);
  }
  return body.data as T;
}

/** Non-throwing variant: read data even on partial failure (400) when adding channels. */
export async function apiFetchEnvelope<T>(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: Envelope<T> }> {
  const resp = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  return { status: resp.status, body: await resp.json() };
}
