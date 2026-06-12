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
    throw new ApiError(`無法解析伺服器回應 (${resp.status})`, resp.status);
  }
  if (!resp.ok || !body.success) {
    throw new ApiError(body.error ?? `請求失敗 (${resp.status})`, resp.status);
  }
  return body.data as T;
}

/** 不丟例外版本:channels 新增的部分失敗(400)也要讀 data。 */
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
