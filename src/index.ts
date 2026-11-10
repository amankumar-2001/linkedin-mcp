#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { runAuthFlow } from "./auth/oauth.js";
import { TokenStore, daysLeft, isExpired } from "./auth/tokenStore.js";
import { loadConfig, redirectUri } from "./config.js";
import { createServer } from "./server.js";
import { createSessionLoader } from "./session.js";

const VERSION = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

const HELP = `linkedin-mcp ${VERSION} — MCP server for your LinkedIn account

Usage:
  linkedin-mcp            Start the MCP server on stdio (what MCP clients run)
  linkedin-mcp auth       Sign in to LinkedIn in your browser and save a token
  linkedin-mcp status     Show the signed-in account and token expiry
  linkedin-mcp logout     Delete the saved token
  linkedin-mcp --version

Environment:
  LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET   From your app at https://www.linkedin.com/developers/apps (needed for auth)
  LINKEDIN_API_VERSION    LinkedIn-Version header, YYYYMM (default set in this release)
  LINKEDIN_REDIRECT_PORT  Callback port (default 8765 → http://127.0.0.1:8765/callback)
  LINKEDIN_MCP_HOME       Token directory (default ~/.config/linkedin-mcp)
`;

async function main(argv: string[]): Promise<number> {
  const cmd = argv[0] ?? "serve";
  if (cmd === "--help" || cmd === "-h" || cmd === "help") {
    process.stdout.write(HELP);
    return 0;
  }
  if (cmd === "--version" || cmd === "-v") {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  const config = loadConfig();
  const store = new TokenStore(config.home);

  switch (cmd) {
    case "serve": {
      const server = createServer({ version: VERSION, getSession: createSessionLoader(config), dataDir: config.home });
      await server.connect(new StdioServerTransport());
      console.error(`linkedin-mcp ${VERSION} running on stdio`);
      return -1; // keep running
    }
    case "auth": {
      if (!config.clientId || !config.clientSecret) {
        console.error(
          "Set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET first (see README → Setup).\n" +
            `Your LinkedIn app must list this redirect URL: ${redirectUri(config)}`,
        );
        return 1;
      }
      const token = await runAuthFlow(config);
      await store.write(token);
      console.error(`Signed in as ${token.name ?? token.personUrn}. Token saved to ${store.path} (expires in ${daysLeft(token)} days).`);
      return 0;
    }
    case "status": {
      const token = await store.read();
      if (!token) {
        console.error("Not signed in. Run `linkedin-mcp auth`.");
        return 1;
      }
      const state = isExpired(token) ? "EXPIRED — run `linkedin-mcp auth`" : `valid for ${daysLeft(token)} more days`;
      console.error(`Signed in as ${token.name ?? "(unknown)"} (${token.personUrn})\nScopes: ${token.scopes.join(" ")}\nToken: ${state}\nFile: ${store.path}`);
      return isExpired(token) ? 1 : 0;
    }
    case "logout": {
      const removed = await store.clear();
      console.error(removed ? `Removed ${store.path}.` : "No saved token.");
      return 0;
    }
    default:
      console.error(`Unknown command "${cmd}".\n\n${HELP}`);
      return 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    if (code >= 0) process.exit(code);
  },
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
