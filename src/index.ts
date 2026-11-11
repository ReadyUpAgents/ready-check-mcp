#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PACKAGE_VERSION } from "./constants.js";
import { generatePrepaidKey, redactSecrets } from "./key.js";
import { createServer } from "./server.js";

const HELP = `ready-check-mcp ${PACKAGE_VERSION}

Usage:
  ready-check-mcp                 Start the MCP server on stdio (what MCP clients run).
  ready-check-mcp generate-key    Print one new prepaid key to this terminal and exit.
                                  Nothing is stored or sent. Put it in READY_CHECK_KEY.
  ready-check-mcp --version
  ready-check-mcp --help
`;

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (arg === "generate-key") {
    // Printed to the human's terminal only. Not written to disk, not sent anywhere.
    process.stdout.write(generatePrepaidKey() + "\n");
    return;
  }
  if (arg === "--version" || arg === "-v") {
    process.stdout.write(PACKAGE_VERSION + "\n");
    return;
  }
  if (arg === "--help" || arg === "-h") {
    process.stdout.write(HELP);
    return;
  }
  if (arg !== undefined) {
    process.stderr.write(`Unknown argument.\n\n${HELP}`);
    process.exit(2);
  }
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("ready-check-mcp failed to start:", redactSecrets(message));
  process.exit(1);
});
