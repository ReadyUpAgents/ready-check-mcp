#!/usr/bin/env node
/**
 * Private smoke test. Does not publish anything.
 * Does not start a purchase, does not make a paid check, and does not use a real key.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = path.join(root, "dist", "index.js");

// Never inherit a real key into this process or the child.
delete process.env.READY_CHECK_KEY;

const FAKE_FORMAT_VALID_KEY = "rc_TESTONLY_NOT_A_REAL_KEY_DO_NOT_USExxxxxxxxx";
if (!/^rc_[A-Za-z0-9_-]{43}$/.test(FAKE_FORMAT_VALID_KEY)) {
  throw new Error("Test fixture key is not the expected public length.");
}

function childEnv() {
  const keep = ["PATH", "HOME", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL", "NODE_ENV", "NODE_PATH", "TZ"];
  const env = {};
  for (const k of keep) {
    if (process.env[k]) env[k] = process.env[k];
  }
  return env;
}

function extractText(result) {
  const parts = result?.content ?? [];
  return parts.map((p) => (p.type === "text" ? p.text : JSON.stringify(p))).join("\n");
}

function looksLikeSecretLeak(text, key) {
  return Boolean(key) && text.includes(key);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function withClient(fn) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: childEnv(),
    stderr: "pipe",
  });
  const stderrChunks = [];
  transport.stderr?.on("data", (buf) => stderrChunks.push(buf));
  const client = new Client({ name: "ready-check-mcp-smoke", version: "0.1.0" });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    const stderr = Buffer.concat(stderrChunks).toString("utf8");
    await client.close().catch(() => {});
    if (stderr.trim()) {
      console.error("--- server stderr ---");
      console.error(stderr);
      console.error("--- end stderr ---");
    }
    if (looksLikeSecretLeak(stderr, FAKE_FORMAT_VALID_KEY)) {
      throw new Error("Server stderr leaked the test key.");
    }
  }
}

const cases = [];

async function runCase(name, fn) {
  try {
    const detail = await fn();
    cases.push({ name, ok: true, detail });
    console.log(`PASS  ${name}`);
    if (detail) console.log(detail);
  } catch (err) {
    const message = err instanceof Error ? err.stack || err.message : String(err);
    cases.push({ name, ok: false, detail: message });
    console.error(`FAIL  ${name}\n${message}`);
  }
}

await runCase("tools/list", async () => {
  return await withClient(async (client) => {
    const listed = await client.listTools();
    const names = listed.tools.map((t) => t.name);
    const expected = ["ready_check", "ready_check_balance", "ready_check_buy_credit"];
    for (const name of expected) {
      assert(names.includes(name), `Missing tool ${name}. Got: ${names.join(", ")}`);
    }
    const summary = listed.tools.map((t) => `- ${t.name}: ${(t.description || "").slice(0, 80)}…`).join("\n");
    return `tools: ${names.join(", ")}\n${summary}`;
  });
});

await runCase("ready_check_balance with no key (client-side, no API charge)", async () => {
  return await withClient(async (client) => {
    const result = await client.callTool({ name: "ready_check_balance", arguments: {} });
    const text = extractText(result);
    assert(result.isError, `Expected isError, got: ${text}`);
    assert(text.includes("prepaid_key_required"), `Expected prepaid_key_required, got: ${text}`);
    return text;
  });
});

await runCase("ready_check with no key (client-side, no API charge)", async () => {
  return await withClient(async (client) => {
    const result = await client.callTool({
      name: "ready_check",
      arguments: { body: "Smoke test body. This must not reach a paid check." },
    });
    const text = extractText(result);
    assert(result.isError, `Expected isError, got: ${text}`);
    assert(text.includes("prepaid_key_required"), `Expected prepaid_key_required, got: ${text}`);
    return text;
  });
});

await runCase("ready_check_balance with obviously invalid key (client-side)", async () => {
  return await withClient(async (client) => {
    const result = await client.callTool({
      name: "ready_check_balance",
      arguments: { key: "not-a-key" },
    });
    const text = extractText(result);
    assert(result.isError, `Expected isError, got: ${text}`);
    assert(text.includes("invalid_key_format"), `Expected invalid_key_format, got: ${text}`);
    return text;
  });
});

await runCase("ready_check with obviously invalid key (client-side)", async () => {
  return await withClient(async (client) => {
    const result = await client.callTool({
      name: "ready_check",
      arguments: { body: "Smoke test body. This must not reach a paid check.", key: "not-a-key" },
    });
    const text = extractText(result);
    assert(result.isError, `Expected isError, got: ${text}`);
    assert(text.includes("invalid_key_format"), `Expected invalid_key_format, got: ${text}`);
    return text;
  });
});

await runCase("ready_check_buy_credit without principal approval does not start a purchase", async () => {
  return await withClient(async (client) => {
    const result = await client.callTool({
      name: "ready_check_buy_credit",
      arguments: { pack_dollars: 2, principal_approved: false },
    });
    const text = extractText(result);
    assert(result.isError, `Expected isError, got: ${text}`);
    assert(text.includes("principal_approval_required"), `Expected principal_approval_required, got: ${text}`);
    assert(!text.includes("checkout_url"), `Must not return a checkout URL: ${text}`);
    return text;
  });
});

await runCase("ready_check_balance with format-valid unknown key (live API, no charge)", async () => {
  return await withClient(async (client) => {
    const result = await client.callTool({
      name: "ready_check_balance",
      arguments: { key: FAKE_FORMAT_VALID_KEY },
    });
    const text = extractText(result);
    assert(result.isError, `Expected isError from live API, got: ${text}`);
    assert(
      /invalid_key|prepaid_key_required|401/.test(text),
      `Expected a clean invalid/unknown key error from the live API, got: ${text}`,
    );
    assert(!text.includes(FAKE_FORMAT_VALID_KEY), `Live API or tool result echoed the key: ${text}`);
    return text;
  });
});

await runCase("ready_check with format-valid unknown key (live API, must not charge)", async () => {
  return await withClient(async (client) => {
    const result = await client.callTool({
      name: "ready_check",
      arguments: {
        body: "Smoke test body. This must not become a paid check.",
        key: FAKE_FORMAT_VALID_KEY,
      },
    });
    const text = extractText(result);
    assert(result.isError, `Expected isError from live API, got: ${text}`);
    assert(
      /invalid_key|prepaid_key_required|401/.test(text),
      `Expected a clean invalid/unknown key error from the live API, got: ${text}`,
    );
    assert(!/credit_charged":\s*[1-9]/.test(text), `A charge was reported: ${text}`);
    assert(!text.includes(FAKE_FORMAT_VALID_KEY), `Tool result echoed the key: ${text}`);
    return text;
  });
});

await runCase("generate-key prints one valid key and touches nothing else (offline)", async () => {
  const r = spawnSync(process.execPath, [serverPath, "generate-key"], { env: childEnv(), encoding: "utf8", timeout: 10_000 });
  assert(r.status === 0, `exit ${r.status}: ${r.stderr}`);
  const out = r.stdout.trim();
  assert(/^rc_[A-Za-z0-9_-]{43}$/.test(out), "generate-key output is not a single valid key");
  return "generate-key: ok (value not printed)";
});

const failed = cases.filter((c) => !c.ok);
console.log(`\n${cases.length - failed.length}/${cases.length} smoke cases passed.`);
if (failed.length) {
  process.exitCode = 1;
}
