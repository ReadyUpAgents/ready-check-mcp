/** Public Ready Check contract values. Do not add unpublished limits here. */
export const PACKAGE_NAME = "ready-check-mcp";
export const PACKAGE_VERSION = "0.2.0";
export const SERVER_NAME = "ready-check";

export const API_BASE_URL = "https://api.readyupagents.com";
export const USER_AGENT = `${PACKAGE_NAME}/${PACKAGE_VERSION}`;

/** Client-side request timeout, not an API-published limit. */
export const REQUEST_TIMEOUT_MS = 60_000;

export const STANDARD_CHECK_USD = 0.0025;
export const LONG_CHECK_USD = 0.005;
export const PACK_DOLLARS = [2, 5] as const;
export const PACK_STANDARD_CHECKS: Record<(typeof PACK_DOLLARS)[number], number> = {
  2: 800,
  5: 2000,
};

export const MAX_BODY_CHARS = 16_000;
export const MAX_HEADER_CHARS = 1_000;
export const MAX_CONTEXT_CHARS = 1_000;
export const MAX_ATTACHMENT_NAMES = 30;
export const MAX_ATTACHMENT_NAME_CHARS = 255;
export const MAX_REQUEST_BYTES = 64 * 1024;
export const KEY_PREFIX = "rc_";
export const KEY_BODY_LENGTH = 43;
export const KEY_TOTAL_LENGTH = 46;
export const KEY_BODY_CHARS = "A-Za-z0-9_-";
export const KEY_PATTERN = /^rc_[A-Za-z0-9_-]{43}$/;
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export const CHECK_KINDS = [
  "inbox",
  "lead_followup",
  "form_lead",
  "guest_post",
  "sponsorship",
  "key_request",
  "podcast_guest",
  "cold_pitch",
  "pr_pitch",
  "security_report",
] as const;

export type CheckKind = (typeof CHECK_KINDS)[number];

export const LEAD_FOLLOWUP_SITUATIONS = ["waiting_on_you", "lead_went_quiet"] as const;
export const INBOX_PROFILES = ["real_estate"] as const;

export const FACTS_URL = "https://readyupagents.com/ready-check/";
export const PRIVACY_URL = "https://readyupagents.com/privacy/";
export const TERMS_URL = "https://readyupagents.com/terms/";
export const AGENTS_GUIDE_URL = "https://readyupagents.com/articles/ready-check-for-agents/";
export const OPENAPI_URL = "https://readyupagents.com/openapi.yaml";
