import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DraftStore } from "./drafts/store.js";
import type { FetchLike } from "./linkedin/client.js";
import type { WaitOptions } from "./linkedin/media.js";
import type { SessionLoader } from "./session.js";
import { registerDraftTools } from "./tools/drafts.js";
import { registerExportTools } from "./tools/export.js";
import { registerJobTools } from "./tools/jobs.js";
import { registerPostTools } from "./tools/posts.js";
import { registerProfileTools } from "./tools/profile.js";

export interface ServerOptions {
  version: string;
  getSession: SessionLoader;
  /** Directory for drafts.json and caches (the same folder as token.json). */
  dataDir: string;
  fetchImpl?: FetchLike;
  wait?: WaitOptions;
}

export function createServer(opts: ServerOptions): McpServer {
  const server = new McpServer(
    { name: "linkedin-mcp", version: opts.version },
    {
      instructions:
        "Tools for the user's own LinkedIn account and job search. " +
        "Posting: text, link, image, multi-image, video, document (carousel), poll and reshare posts, plus editing post text and deleting posts. " +
        "Before any create_*, reshare_post, edit_post or publish_draft call, show the user the exact post (preview_post) and get explicit approval. " +
        "Drafts are stored locally and can be published later with publish_draft. " +
        "Jobs: linkedin_job_search_link builds a filtered LinkedIn Jobs search URL; search_public_jobs returns real listings from public company job boards (Greenhouse, Lever, Ashby) and Remotive. " +
        "Full profile (experience, education, skills, connections) comes only from the user's LinkedIn data export via read_linkedin_export. " +
        "LinkedIn's API does not allow editing profile sections, reading the feed or messages, or commenting/reacting with this app.",
    },
  );
  registerProfileTools(server, opts.getSession);
  const deps = { fetchImpl: opts.fetchImpl, wait: opts.wait };
  registerPostTools(server, opts.getSession, deps);
  registerDraftTools(server, new DraftStore(opts.dataDir), opts.getSession, deps);
  registerJobTools(server, { cacheDir: opts.dataDir, fetchImpl: opts.fetchImpl });
  registerExportTools(server);
  return server;
}
