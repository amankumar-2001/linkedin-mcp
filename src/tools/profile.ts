import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { daysLeft } from "../auth/tokenStore.js";
import type { SessionLoader } from "../session.js";
import { ok, safe } from "./result.js";

export function registerProfileTools(server: McpServer, getSession: SessionLoader): void {
  server.registerTool(
    "auth_status",
    {
      title: "LinkedIn sign-in status",
      description: "Shows which LinkedIn account is connected, the granted scopes, and how many days until the token expires.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    safe(async () => {
      const { token } = await getSession();
      return ok({
        signedIn: true,
        name: token.name ?? null,
        personUrn: token.personUrn,
        scopes: token.scopes,
        canPost: token.scopes.includes("w_member_social"),
        expiresAt: new Date(token.expiresAt).toISOString(),
        daysLeft: daysLeft(token),
      });
    }),
  );

  server.registerTool(
    "get_my_profile",
    {
      title: "Get my LinkedIn profile",
      description: "Returns the signed-in member's basic profile from LinkedIn: id, name, profile picture, email and locale.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    safe(async () => {
      const { client, token } = await getSession();
      const me = await client.userinfo();
      return ok({
        personUrn: token.personUrn,
        name: me.name ?? null,
        givenName: me.given_name ?? null,
        familyName: me.family_name ?? null,
        picture: me.picture ?? null,
        email: me.email ?? null,
        emailVerified: me.email_verified ?? null,
        locale: me.locale ?? null,
      });
    }),
  );
}
