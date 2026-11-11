import { randomBytes } from "node:crypto";
import {
  KEY_BODY_LENGTH,
  KEY_PATTERN,
  KEY_PREFIX,
  KEY_TOTAL_LENGTH,
} from "./constants.js";

/** Key-shaped token not preceded by another key character (so "src_..." is not touched). */
const KEY_LIKE = /(?<![A-Za-z0-9_-])rc_[A-Za-z0-9_-]{10,}/g;

/** Field names whose string values are always treated as secrets. */
function isSecretFieldName(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower === "idempotency_key") return false; // not a secret; agents need it to retry safely
  return lower === "key" || lower === "authorization" || lower.endsWith("_key") || lower.includes("secret") || lower.includes("token") || lower.includes("password");
}

export function generatePrepaidKey(): string {
  const body = randomBytes(32).toString("base64url");
  if (body.length !== KEY_BODY_LENGTH) {
    throw new Error("Internal key generation produced an unexpected length.");
  }
  const key = `${KEY_PREFIX}${body}`;
  if (!KEY_PATTERN.test(key)) {
    throw new Error("Internal key generation produced an invalid key.");
  }
  return key;
}

export function generateIdempotencyKey(): string {
  return randomBytes(16).toString("hex");
}

export function normalizeKey(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function isValidPrepaidKey(value: unknown): value is string {
  return typeof value === "string" && KEY_PATTERN.test(value);
}

export function keyFormatError(): string {
  return (
    `Key must be ${KEY_PREFIX} plus ${KEY_BODY_LENGTH} URL-safe base64 characters ` +
    `(${KEY_TOTAL_LENGTH} characters total, from the set A-Za-z0-9_-), generated with a CSPRNG ` +
    "from 32 random bytes. Do not use passwords, short strings, or repeated characters."
  );
}

/** Replace prepaid-key-shaped strings so they are never logged or echoed accidentally. */
export function redactSecrets(text: string): string {
  return text.replace(KEY_LIKE, "rc_[redacted]");
}

export function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redactSecrets(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSecretFieldName(k)) {
        out[k] = typeof v === "string" && v.length > 0 ? "rc_[redacted]" : v;
      } else {
        out[k] = redactValue(v);
      }
    }
    return out;
  }
  return value;
}

/**
 * Accept only an https URL on checkout.stripe.com (default port, no credentials).
 * Returns the normalized URL string, or undefined when the value is not acceptable.
 */
export function validateStripeCheckoutUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096) return undefined;
  if (/[\s\u0000-\u001f\u007f]/.test(value)) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:") return undefined;
  if (url.hostname !== "checkout.stripe.com") return undefined;
  if (url.port !== "" || url.username !== "" || url.password !== "") return undefined;
  return url.toString();
}
