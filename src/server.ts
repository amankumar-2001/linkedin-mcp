import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FetchLike } from "./linkedin/client.js";
import type { SessionLoader } from "./session.js";
import { registerPostTools } from "./tools/posts.js";
import { registerProfileTools } from "./tools/profile.js";

export function createServer(opts: { version: string; getSession: SessionLoader; fetchImpl?: FetchLike }): McpServer {
  const server = new McpServer(
    { name: "linkedin-mcp", version: opts.version },
    {
      instructions:
        "Tools for the user's own LinkedIn account: read their basic profile and publish or delete their posts. " +
        "Before any create_* call, show the user the exact post (use preview_post) and get their explicit approval. " +
        "LinkedIn's API does not allow editing profile sections such as headline, About or experience.",
    },
  );
  registerProfileTools(server, opts.getSession);
  registerPostTools(server, opts.getSession, opts.fetchImpl);
  return server;
}
