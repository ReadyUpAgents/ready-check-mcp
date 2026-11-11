import {
  CHECK_KINDS,
  IDEMPOTENCY_KEY_PATTERN,
  INBOX_PROFILES,
  LEAD_FOLLOWUP_SITUATIONS,
  MAX_ATTACHMENT_NAME_CHARS,
  MAX_ATTACHMENT_NAMES,
  MAX_BODY_CHARS,
  MAX_CONTEXT_CHARS,
  MAX_HEADER_CHARS,
  MAX_REQUEST_BYTES,
  PACK_DOLLARS,
} from "./constants.js";
import { isValidPrepaidKey, keyFormatError, normalizeKey } from "./key.js";

export class InputError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "InputError";
    this.code = code;
  }
}

export type PackDollars = (typeof PACK_DOLLARS)[number];

export interface ResolvedKey {
  key: string;
  source: "argument" | "env";
}

export interface CheckInput {
  body: string;
  from?: string;
  reply_to?: string;
  subject?: string;
  attachment_names?: string[];
  kind?: (typeof CHECK_KINDS)[number];
  context?: Record<string, unknown>;
  idempotency_key?: string;
}

function utf8Bytes(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

function rejectUnknownKeys(obj: Record<string, unknown>, allowed: string[], label: string): void {
  const extra = Object.keys(obj).filter((k) => !allowed.includes(k));
  if (extra.length > 0) {
    throw new InputError(
      "invalid_request",
      `${label} has unsupported field(s): ${extra.join(", ")}. Remove them and retry.`,
    );
  }
}

export function resolveOptionalKey(argumentKey: unknown, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const fromArg = normalizeKey(argumentKey);
  if (fromArg) {
    if (!isValidPrepaidKey(fromArg)) {
      throw new InputError("invalid_key_format", keyFormatError());
    }
    return fromArg;
  }
  const fromEnv = normalizeKey(env.READY_CHECK_KEY);
  if (fromEnv) {
    if (!isValidPrepaidKey(fromEnv)) {
      throw new InputError(
        "invalid_key_format",
        "READY_CHECK_KEY is set but is not a valid prepaid key. " + keyFormatError(),
      );
    }
    return fromEnv;
  }
  return undefined;
}

export function requireKey(argumentKey: unknown, env: NodeJS.ProcessEnv = process.env): ResolvedKey {
  const fromArg = normalizeKey(argumentKey);
  if (fromArg) {
    if (!isValidPrepaidKey(fromArg)) {
      throw new InputError("invalid_key_format", keyFormatError());
    }
    return { key: fromArg, source: "argument" };
  }
  const fromEnv = normalizeKey(env.READY_CHECK_KEY);
  if (fromEnv) {
    if (!isValidPrepaidKey(fromEnv)) {
      throw new InputError(
        "invalid_key_format",
        "READY_CHECK_KEY is set but is not a valid prepaid key. " + keyFormatError(),
      );
    }
    return { key: fromEnv, source: "env" };
  }
  throw new InputError(
    "prepaid_key_required",
    "A prepaid Ready Check key is required. Set the READY_CHECK_KEY environment variable in your MCP client config, or pass the key argument. Prefer the environment variable so the key is not placed in the conversation. To start a pack after your principal approves, use ready_check_buy_credit.",
  );
}

function requireString(value: unknown, field: string, maxChars: number, required: boolean): string | undefined {
  if (value === undefined || value === null) {
    if (required) {
      throw new InputError("invalid_request", `${field} is required.`);
    }
    return undefined;
  }
  if (typeof value !== "string") {
    throw new InputError("invalid_request", `${field} must be a string.`);
  }
  if (required && value.length < 1) {
    throw new InputError("empty_body", `${field} must be a non-empty string.`);
  }
  if (value.length > maxChars) {
    throw new InputError(
      "payload_too_large",
      `${field} is ${value.length} characters; the limit is ${maxChars}. Shorten it and retry. Oversized input is rejected at no charge.`,
    );
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateContext(context: unknown, kind?: string): Record<string, unknown> | undefined {
  if (kind === "lead_followup") {
    const situation = isPlainObject(context) ? context.situation : undefined;
    if (
      typeof situation !== "string" ||
      !(LEAD_FOLLOWUP_SITUATIONS as readonly string[]).includes(situation)
    ) {
      throw new InputError(
        "invalid_request",
        "kind lead_followup requires context.situation of waiting_on_you or lead_went_quiet.",
      );
    }
  }
  if (context === undefined) return undefined;
  if (!isPlainObject(context)) {
    throw new InputError("invalid_request", "context must be a JSON object.");
  }
  const serialized = JSON.stringify(context);
  if (serialized.length > MAX_CONTEXT_CHARS) {
    throw new InputError(
      "payload_too_large",
      `Serialized context is ${serialized.length} characters; the limit is ${MAX_CONTEXT_CHARS}. Shorten it and retry.`,
    );
  }
  if (context.profile !== undefined && !(INBOX_PROFILES as readonly string[]).includes(String(context.profile))) {
    throw new InputError(
      "invalid_request",
      "context.profile, when set, must be real_estate (used with inbox or lead_followup).",
    );
  }
  if (context.rate_card !== undefined) {
    if (!isPlainObject(context.rate_card)) {
      throw new InputError("invalid_request", "context.rate_card must be an object of named nonnegative numbers.");
    }
    for (const [name, amount] of Object.entries(context.rate_card)) {
      if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
        throw new InputError(
          "invalid_request",
          `context.rate_card.${name} must be a finite nonnegative number.`,
        );
      }
    }
  }
  return context;
}

function looksLikeFileContents(name: string): boolean {
  const trimmed = name.trim().toLowerCase();
  return trimmed.startsWith("data:") || trimmed.includes("base64,") || /[\x00-\x08]/.test(name);
}

export function validateCheckInput(input: {
  body?: unknown;
  from?: unknown;
  reply_to?: unknown;
  subject?: unknown;
  attachment_names?: unknown;
  kind?: unknown;
  context?: unknown;
  idempotency_key?: unknown;
}): { payload: Record<string, unknown>; idempotencyKey?: string } {
  rejectUnknownKeys(
    input as Record<string, unknown>,
    ["body", "from", "reply_to", "subject", "attachment_names", "kind", "context", "idempotency_key", "key"],
    "ready_check",
  );

  const body = requireString(input.body, "body", MAX_BODY_CHARS, true) as string;
  const from = requireString(input.from, "from", MAX_HEADER_CHARS, false);
  const replyTo = requireString(input.reply_to, "reply_to", MAX_HEADER_CHARS, false);
  const subject = requireString(input.subject, "subject", MAX_HEADER_CHARS, false);

  let kind: (typeof CHECK_KINDS)[number] | undefined;
  if (input.kind !== undefined && input.kind !== null) {
    if (typeof input.kind !== "string" || !(CHECK_KINDS as readonly string[]).includes(input.kind)) {
      throw new InputError(
        "invalid_request",
        `Unsupported kind. Use one of: ${CHECK_KINDS.join(", ")}. Or omit kind for a general result.`,
      );
    }
    kind = input.kind as (typeof CHECK_KINDS)[number];
  }

  let attachment_names: string[] | undefined;
  if (input.attachment_names !== undefined) {
    if (!Array.isArray(input.attachment_names)) {
      throw new InputError("invalid_request", "attachment_names must be an array of file names only (no file bytes).");
    }
    if (input.attachment_names.length > MAX_ATTACHMENT_NAMES) {
      throw new InputError(
        "payload_too_large",
        `attachment_names has ${input.attachment_names.length} entries; the limit is ${MAX_ATTACHMENT_NAMES}.`,
      );
    }
    attachment_names = input.attachment_names.map((name, i) => {
      if (typeof name !== "string") {
        throw new InputError("invalid_request", `attachment_names[${i}] must be a string file name.`);
      }
      if (name.length > MAX_ATTACHMENT_NAME_CHARS) {
        throw new InputError(
          "payload_too_large",
          `attachment_names[${i}] is ${name.length} characters; the limit is ${MAX_ATTACHMENT_NAME_CHARS}.`,
        );
      }
      if (looksLikeFileContents(name)) {
        throw new InputError(
          "invalid_request",
          "attachment_names must be file names only. Do not send file bytes, data URLs, or media contents.",
        );
      }
      return name;
    });
  }

  const context = validateContext(input.context, kind);

  let idempotencyKey: string | undefined;
  if (input.idempotency_key !== undefined && input.idempotency_key !== null) {
    if (typeof input.idempotency_key !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(input.idempotency_key)) {
      throw new InputError(
        "invalid_idempotency_key",
        "idempotency_key must be 1–128 characters from the set A-Za-z0-9._-.",
      );
    }
    idempotencyKey = input.idempotency_key;
  }

  const payload: Record<string, unknown> = { body };
  if (from !== undefined) payload.from = from;
  if (replyTo !== undefined) payload.reply_to = replyTo;
  if (subject !== undefined) payload.subject = subject;
  if (attachment_names !== undefined) payload.attachment_names = attachment_names;
  if (kind !== undefined) payload.kind = kind;
  if (context !== undefined) payload.context = context;

  const raw = JSON.stringify(payload);
  if (utf8Bytes(raw) > MAX_REQUEST_BYTES) {
    throw new InputError(
      "request_too_large",
      `The JSON request is ${utf8Bytes(raw)} bytes; the limit is ${MAX_REQUEST_BYTES} (64 KiB). Shorten the email or context.`,
    );
  }

  return { payload, idempotencyKey };
}

export function validatePackDollars(value: unknown): PackDollars {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (n === 1 || n === 5) return n;
  throw new InputError("invalid_pack", "pack_dollars must be exactly 1 or 5 (USD). $1 is 400 standard checks; $5 is 2,000.");
}

export function validatePrincipalApproved(value: unknown): void {
  if (value !== true) {
    throw new InputError(
      "principal_approval_required",
      "Set principal_approved to true only after the human or the agent's principal has agreed to buy this pack. This tool will then return a Stripe checkout URL for them to pay by card. It never handles card data. Get approval before starting a purchase.",
    );
  }
}
