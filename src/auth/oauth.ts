import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { LINKEDIN_AUTHORIZE_URL, LINKEDIN_TOKEN_URL, SCOPES, redirectUri, type Config } from "../config.js";
import { LinkedInClient, ensureOk, type FetchLike } from "../linkedin/client.js";
import type { StoredToken } from "./tokenStore.js";

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  scope?: string;
}

export function buildAuthorizeUrl(config: Pick<Config, "clientId" | "redirectPort">, state: string): string {
  if (!config.clientId) throw new Error("LINKEDIN_CLIENT_ID is not set.");
  const url = new URL(LINKEDIN_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri(config));
  url.searchParams.set("state", state);
  url.searchParams.set("scope", SCOPES.join(" "));
  return url.toString();
}

export async function exchangeCode(config: Config, code: string, fetchImpl: FetchLike = fetch): Promise<TokenResponse> {
  if (!config.clientId || !config.clientSecret) throw new Error("LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET must be set.");
  const res = await fetchImpl(LINKEDIN_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(config),
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });
  await ensureOk(res);
  const json = (await res.json()) as TokenResponse;
  if (!json.access_token) throw new Error("LinkedIn did not return an access token.");
  return json;
}

/** Turns a token response + userinfo into what we persist. */
export async function toStoredToken(token: TokenResponse, config: Config, fetchImpl: FetchLike = fetch, now = Date.now()): Promise<StoredToken> {
  const client = new LinkedInClient({ accessToken: token.access_token, apiVersion: config.apiVersion, fetchImpl });
  const me = await client.userinfo();
  return {
    accessToken: token.access_token,
    expiresAt: now + token.expires_in * 1000,
    scopes: (token.scope ?? SCOPES.join(" ")).split(/[ ,]+/).filter(Boolean),
    personUrn: `urn:li:person:${me.sub}`,
    name: me.name,
    email: me.email,
    createdAt: now,
  };
}

function openInBrowser(url: string): void {
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(cmd, args as string[], { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // The URL is printed too, so the user can open it by hand.
  }
}

const page = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
  `<body style="font-family:system-ui;max-width:520px;margin:80px auto;padding:0 16px;line-height:1.5">` +
  `<h2>${title}</h2><p>${body}</p></body>`;

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Runs the browser-based OAuth flow: starts a one-shot callback server on 127.0.0.1,
 * opens LinkedIn's consent page, validates `state`, and exchanges the code for a token.
 */
export async function runAuthFlow(
  config: Config,
  opts: { log?: (msg: string) => void; open?: boolean; timeoutMs?: number; fetchImpl?: FetchLike } = {},
): Promise<StoredToken> {
  const log = opts.log ?? ((m) => console.error(m));
  const fetchImpl = opts.fetchImpl ?? fetch;
  const state = randomBytes(24).toString("hex");
  const authorizeUrl = buildAuthorizeUrl(config, state);

  let server: Server | undefined;
  const code = await new Promise<string>((resolveCode, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for LinkedIn sign-in.")), opts.timeoutMs ?? 5 * 60_000);
    server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", redirectUri(config));
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const error = url.searchParams.get("error");
      if (error) {
        const desc = url.searchParams.get("error_description") ?? error;
        res.writeHead(400, { "Content-Type": "text/html" }).end(page("Sign-in cancelled", escapeHtml(desc)));
        clearTimeout(timer);
        reject(new Error(`LinkedIn sign-in failed: ${desc}`));
        return;
      }
      if (url.searchParams.get("state") !== state) {
        res.writeHead(400, { "Content-Type": "text/html" }).end(page("Sign-in rejected", "The state parameter did not match. Please run the auth command again."));
        clearTimeout(timer);
        reject(new Error("OAuth state mismatch; aborting."));
        return;
      }
      const c = url.searchParams.get("code");
      if (!c) {
        res.writeHead(400).end();
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" }).end(page("You're signed in", "LinkedIn is connected. You can close this tab and return to your terminal."));
      clearTimeout(timer);
      resolveCode(c);
    });
    server.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(
        err.code === "EADDRINUSE"
          ? new Error(`Port ${config.redirectPort} is busy. Free it or set LINKEDIN_REDIRECT_PORT (and update the redirect URL on your LinkedIn app).`)
          : err,
      );
    });
    server.listen(config.redirectPort, "127.0.0.1", () => {
      log(`Opening LinkedIn sign-in in your browser. If it doesn't open, visit:\n\n  ${authorizeUrl}\n`);
      if (opts.open !== false) openInBrowser(authorizeUrl);
    });
  }).finally(() => server?.close());

  const token = await exchangeCode(config, code, fetchImpl);
  return toStoredToken(token, config, fetchImpl);
}
