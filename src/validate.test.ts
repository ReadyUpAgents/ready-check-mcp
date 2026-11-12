import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generatePrepaidKey } from "./key.js";
import {
  InputError,
  requireKey,
  resolveOptionalKey,
  validateCheckInput,
  validatePackDollars,
  validatePrincipalApproved,
} from "./validate.js";

const env = (key?: string): NodeJS.ProcessEnv => (key ? { READY_CHECK_KEY: key } : {});

describe("requireKey / resolveOptionalKey", () => {
  it("errors when no key is present", () => {
    assert.throws(() => requireKey(undefined, env()), (err: unknown) => err instanceof InputError && err.code === "prepaid_key_required");
    assert.equal(resolveOptionalKey(undefined, env()), undefined);
  });

  it("rejects an obviously invalid key without accepting it", () => {
    assert.throws(() => requireKey("not-a-key", env()), (err: unknown) => err instanceof InputError && err.code === "invalid_key_format");
    assert.throws(() => requireKey(undefined, env("rc_short")), (err: unknown) => err instanceof InputError && err.code === "invalid_key_format");
  });

  it("prefers the argument key over the environment", () => {
    const a = generatePrepaidKey();
    const b = generatePrepaidKey();
    assert.equal(requireKey(a, env(b)).key, a);
    assert.equal(requireKey(a, env(b)).source, "argument");
    assert.equal(requireKey(undefined, env(b)).key, b);
    assert.equal(requireKey(undefined, env(b)).source, "env");
  });
});

describe("validateCheckInput", () => {
  it("requires a non-empty body and accepts a minimal payload", () => {
    const { payload } = validateCheckInput({ body: "Hello, is this offer real?" });
    assert.deepEqual(payload, { body: "Hello, is this offer real?" });
  });

  it("rejects an oversized body before any API call", () => {
    assert.throws(
      () => validateCheckInput({ body: "x".repeat(16001) }),
      (err: unknown) => err instanceof InputError && err.code === "payload_too_large",
    );
  });

  it("rejects an unsupported kind and lead_followup without situation", () => {
    assert.throws(
      () => validateCheckInput({ body: "hi", kind: "not-a-kind" }),
      (err: unknown) => err instanceof InputError && err.code === "invalid_request",
    );
    assert.throws(
      () => validateCheckInput({ body: "hi", kind: "lead_followup" }),
      (err: unknown) => err instanceof InputError && err.code === "invalid_request",
    );
    const { payload } = validateCheckInput({
      body: "Following up on our call.",
      kind: "lead_followup",
      context: { situation: "lead_went_quiet" },
    });
    assert.equal(payload.kind, "lead_followup");
  });

  it("rejects attachment contents disguised as names", () => {
    assert.throws(
      () => validateCheckInput({ body: "see attached", attachment_names: ["data:application/pdf;base64,AAAA"] }),
      (err: unknown) => err instanceof InputError && err.code === "invalid_request",
    );
  });
});

describe("validatePackDollars and principal approval", () => {
  it("accepts only 2 or 5 ($1 retired)", () => {
    assert.equal(validatePackDollars(2), 2);
    assert.throws(() => validatePackDollars(1), (err: unknown) => err instanceof InputError && err.code === "invalid_pack");
    assert.equal(validatePackDollars(5), 5);
    assert.throws(() => validatePackDollars(10), (err: unknown) => err instanceof InputError && err.code === "invalid_pack");
  });

  it("refuses a purchase unless principal_approved is true", () => {
    assert.throws(() => validatePrincipalApproved(false), (err: unknown) => err instanceof InputError && err.code === "principal_approval_required");
    assert.throws(() => validatePrincipalApproved(undefined), (err: unknown) => err instanceof InputError && err.code === "principal_approval_required");
    assert.doesNotThrow(() => validatePrincipalApproved(true));
  });
});

describe("release metadata", () => {
  it("keeps package.json, server.json, and the server version in sync", async () => {
    const { readFileSync } = await import("node:fs");
    const { PACKAGE_VERSION } = await import("./constants.js");
    const root = new URL("../", import.meta.url);
    const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
    const srv = JSON.parse(readFileSync(new URL("server.json", root), "utf8"));
    assert.equal(pkg.version, PACKAGE_VERSION);
    assert.equal(srv.version, PACKAGE_VERSION);
    assert.equal(srv.packages[0].version, PACKAGE_VERSION);
    assert.equal(srv.packages[0].identifier, pkg.name);
    assert.equal(srv.name, pkg.mcpName);
    assert.ok(srv.description.length <= 100);
  });
});
