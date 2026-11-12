import { API_BASE_URL, REQUEST_TIMEOUT_MS, USER_AGENT } from "./constants.js";
import { redactSecrets, redactValue } from "./key.js";

export interface ApiResult {
  ok: boolean;
  status: number;
  body: unknown;
  retryAfterSeconds?: number;
  idempotencyReplayed?: boolean;
  timedOut: boolean;
  networkError?: string;
}

export class ApiUncertainError extends Error {
  readonly idempotencyKey?: string;
  readonly timedOut: boolean;
  constructor(message: string, opts: { idempotencyKey?: string; timedOut: boolean }) {
    super(message);
    this.name = "ApiUncertainError";
    this.idempotencyKey = opts.idempotencyKey;
    this.timedOut = opts.timedOut;
  }
}

function headerSeconds(value: string | null): number | undefined {
  if (!value) return undefined;
  const n = Number(value.trim());
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : undefined;
}

/** Upper bound on a response body this client will read (defensive; real responses are small). */
const MAX_RESPONSE_BYTES = 256 * 1024;

async function readCapped(res: Response): Promise<string | undefined> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => {});
      return undefined;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await readCapped(res);
  if (text === undefined) return { error: "response_too_large", detail: "The API response was larger than this client accepts." };
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { error: "unreadable_response", detail: redactSecrets(text.slice(0, 500)) };
  }
}

export interface RequestOptions {
  method: "GET" | "POST";
  path: "/v1/payments/register" | "/v1/ready-check/balance" | "/v1/ready-check" | "/v1/quick-check";
  key?: string;
  json?: unknown;
  idempotencyKey?: string;
  timeoutMs?: number;
}

/**
 * One HTTP call to the public Ready Check API. Never retries.
 * A retry after the request has been sent could double-charge a check.
 */
export async function apiRequest(opts: RequestOptions): Promise<ApiResult> {
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": USER_AGENT,
  };
  if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (opts.key) {
    headers.Authorization = `Bearer ${opts.key}`;
  }
  if (opts.idempotencyKey) {
    headers["Idempotency-Key"] = opts.idempotencyKey;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${API_BASE_URL}${opts.path}`, {
      method: opts.method,
      headers,
      body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
      signal: controller.signal,
      redirect: "error",
    });

    const body = redactValue(await parseBody(res));
    return {
      ok: res.ok,
      status: res.status,
      body,
      retryAfterSeconds: headerSeconds(res.headers.get("Retry-After")),
      idempotencyReplayed: res.headers.get("Idempotency-Replayed") === "true",
      timedOut: false,
    };
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
    const raw = err instanceof Error ? err.message : String(err);
    const networkError = redactSecrets(raw);
    if (timedOut) {
      throw new ApiUncertainError(
        opts.path === "/v1/ready-check"
          ? `The Ready Check request timed out after ${timeoutMs} ms. Do not assume it was uncharged. Check ready_check_balance, and if you retry, reuse the same idempotency_key.`
          : `The request timed out after ${timeoutMs} ms. Wait and retry with the same key if needed.`,
        { idempotencyKey: opts.idempotencyKey, timedOut: true },
      );
    }
    // For paid checks, a failure after the request left this process is uncertain.
    // Node's fetch typically throws only when the request could not be completed;
    // still do not retry automatically.
    if (opts.path === "/v1/ready-check") {
      throw new ApiUncertainError(
        `The Ready Check request did not complete (${networkError}). Do not assume it was uncharged or unrun. Check ready_check_balance, and if you retry, reuse the same idempotency_key.`,
        { idempotencyKey: opts.idempotencyKey, timedOut: false },
      );
    }
    return {
      ok: false,
      status: 0,
      body: {
        error: "network_error",
        detail: `The request did not complete (${networkError}). Wait and retry with the same key if needed.`,
      },
      timedOut: false,
      networkError,
    };
  } finally {
    clearTimeout(timer);
  }
}
