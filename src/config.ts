import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** LinkedIn-Version header (YYYYMM). LinkedIn sunsets each version about a year after release. */
export const DEFAULT_API_VERSION = "202610";
export const DEFAULT_REDIRECT_PORT = 8765;

/** Scopes from the "Sign In with LinkedIn using OpenID Connect" and "Share on LinkedIn" products. */
export const SCOPES = ["openid", "profile", "email", "w_member_social"] as const;

export const LINKEDIN_AUTHORIZE_URL = "https://www.linkedin.com/oauth/v2/authorization";
export const LINKEDIN_TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
export const LINKEDIN_USERINFO_URL = "https://api.linkedin.com/v2/userinfo";
export const LINKEDIN_REST_BASE = "https://api.linkedin.com/rest";

export interface Config {
  clientId?: string;
  clientSecret?: string;
  apiVersion: string;
  redirectPort: number;
  /** Directory holding token.json. */
  home: string;
}

function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return resolve(p);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.LINKEDIN_REDIRECT_PORT ?? DEFAULT_REDIRECT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`LINKEDIN_REDIRECT_PORT must be a port number, got "${env.LINKEDIN_REDIRECT_PORT}"`);
  }
  const apiVersion = env.LINKEDIN_API_VERSION?.trim() || DEFAULT_API_VERSION;
  if (!/^\d{6}$/.test(apiVersion)) {
    throw new Error(`LINKEDIN_API_VERSION must be YYYYMM (e.g. ${DEFAULT_API_VERSION}), got "${apiVersion}"`);
  }
  return {
    clientId: env.LINKEDIN_CLIENT_ID?.trim() || undefined,
    clientSecret: env.LINKEDIN_CLIENT_SECRET?.trim() || undefined,
    apiVersion,
    redirectPort: port,
    home: expandHome(env.LINKEDIN_MCP_HOME?.trim() || join(homedir(), ".config", "linkedin-mcp")),
  };
}

export function redirectUri(config: Pick<Config, "redirectPort">): string {
  return `http://127.0.0.1:${config.redirectPort}/callback`;
}
