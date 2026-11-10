import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildAuthorizeUrl, exchangeCode, toStoredToken } from "../src/auth/oauth.js";
import { TokenStore, daysLeft, isExpired } from "../src/auth/tokenStore.js";
import { loadConfig } from "../src/config.js";
import { json, stubFetch } from "./helpers.js";

const config = loadConfig({ LINKEDIN_CLIENT_ID: "cid", LINKEDIN_CLIENT_SECRET: "secret", LINKEDIN_MCP_HOME: "/tmp/x" });

describe("loadConfig", () => {
  it("applies defaults and validates", () => {
    expect(config).toMatchObject({ clientId: "cid", apiVersion: "202610", redirectPort: 8765 });
    expect(() => loadConfig({ LINKEDIN_API_VERSION: "2026-10" })).toThrow(/YYYYMM/);
    expect(() => loadConfig({ LINKEDIN_REDIRECT_PORT: "abc" })).toThrow(/port/);
  });
});

describe("OAuth", () => {
  it("builds the authorize URL with all scopes and the loopback redirect", () => {
    const url = new URL(buildAuthorizeUrl(config, "st4te"));
    expect(url.origin + url.pathname).toBe("https://www.linkedin.com/oauth/v2/authorization");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "cid",
      redirect_uri: "http://127.0.0.1:8765/callback",
      state: "st4te",
      scope: "openid profile email w_member_social",
    });
  });

  it("exchanges the code and stores the person URN from userinfo", async () => {
    const { fetch, calls } = stubFetch({
      "POST https://www.linkedin.com/oauth/v2/accessToken": () => json({ access_token: "AT", expires_in: 5_184_000, scope: "openid,profile,email,w_member_social" }),
      "GET https://api.linkedin.com/v2/userinfo": () => json({ sub: "xyz", name: "Aman Kumar", email: "a@example.com" }),
    });
    const token = await exchangeCode(config, "CODE", fetch);
    expect(calls[0]!.body).toMatchObject({ grant_type: "authorization_code", code: "CODE", client_secret: "secret" });
    const stored = await toStoredToken(token, config, fetch, 1_000);
    expect(stored).toMatchObject({
      accessToken: "AT",
      personUrn: "urn:li:person:xyz",
      name: "Aman Kumar",
      scopes: ["openid", "profile", "email", "w_member_social"],
      expiresAt: 1_000 + 5_184_000_000,
    });
  });
});

describe("TokenStore", () => {
  it("writes the token with 0600 permissions and reads it back", async () => {
    const dir = await mkdtemp(join(tmpdir(), "linkedin-mcp-"));
    const store = new TokenStore(join(dir, "nested"));
    expect(await store.read()).toBeNull();
    const token = { accessToken: "AT", expiresAt: Date.now() + 3 * 86_400_000, scopes: ["w_member_social"], personUrn: "urn:li:person:1", createdAt: 1 };
    await store.write(token);
    expect((await stat(store.path)).mode & 0o777).toBe(0o600);
    expect(await store.read()).toMatchObject(token);
    expect(daysLeft(token)).toBe(2);
    expect(isExpired(token)).toBe(false);
    expect(isExpired({ ...token, expiresAt: Date.now() + 1000 })).toBe(true);
    expect(await store.clear()).toBe(true);
    expect(await store.read()).toBeNull();
  });
});
