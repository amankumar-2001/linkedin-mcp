import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Draft, DraftStore } from "../drafts/store.js";
import { publish, validateSpec } from "../linkedin/publish.js";
import type { SessionLoader } from "../session.js";
import { anyPostShape, compact, toSpec, updatePostShape, type AnyPostArgs } from "./fields.js";
import type { PostToolDeps } from "./posts.js";
import { ok, safe } from "./result.js";

const summary = (d: Draft) => ({
  id: d.id,
  label: d.label ?? null,
  kind: d.spec.kind,
  visibility: d.spec.visibility ?? "PUBLIC",
  text: d.spec.text.length > 140 ? `${d.spec.text.slice(0, 140)}…` : d.spec.text,
  updatedAt: d.updatedAt,
  published: d.published ?? null,
});

const label = z.string().max(80).optional().describe("Optional short name to find the draft later.");
const id = z.string().describe("Draft id from save_draft or list_drafts.");

export function registerDraftTools(server: McpServer, store: DraftStore, getSession: SessionLoader, deps: PostToolDeps = {}): void {
  server.registerTool(
    "save_draft",
    {
      title: "Save a post draft",
      description:
        "Saves any kind of post (same fields as preview_post) as a local draft on this computer, without publishing. Files referenced by path are read only when the draft is published.",
      inputSchema: { ...anyPostShape, label },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    safe(async ({ label: l, ...a }) => {
      const spec = compact(toSpec(a));
      validateSpec(spec);
      const draft = await store.create(spec, l);
      return ok({ saved: true, draft: { ...summary(draft), spec: draft.spec } });
    }),
  );

  server.registerTool(
    "list_drafts",
    {
      title: "List post drafts",
      description: "Lists your local post drafts, newest first. Published drafts are hidden unless include_published is true.",
      inputSchema: { include_published: z.boolean().default(false), with_details: z.boolean().default(false).describe("Include each draft's full post fields.") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    safe(async (a) => {
      const drafts = await store.list({ includePublished: a.include_published });
      return ok({ count: drafts.length, drafts: drafts.map((d) => (a.with_details ? { ...summary(d), spec: d.spec } : summary(d))), file: store.path });
    }),
  );

  server.registerTool(
    "update_draft",
    {
      title: "Update a post draft",
      description: "Changes fields of an unpublished draft. Only the fields you pass are changed; pass `kind` to switch the post type.",
      inputSchema: { id, label, ...updatePostShape },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    safe(async ({ id: draftId, label: l, ...changes }) => {
      const current = await store.get(draftId);
      const merged = { ...(current.spec as AnyPostArgs), ...compact(changes as AnyPostArgs) };
      const spec = compact(toSpec(merged));
      validateSpec(spec);
      const draft = await store.update(draftId, { spec, label: l });
      return ok({ updated: true, draft: { ...summary(draft), spec: draft.spec } });
    }),
  );

  server.registerTool(
    "delete_draft",
    {
      title: "Delete a post draft",
      description: "Deletes a local draft. Doesn't touch anything already published on LinkedIn.",
      inputSchema: { id },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    safe(async (a) => ok({ deleted: await store.remove(a.id), id: a.id })),
  );

  server.registerTool(
    "publish_draft",
    {
      title: "Publish a post draft",
      description: "Publishes a saved draft to LinkedIn exactly as saved (uploading any files it references) and marks it published. Show the user the draft and get explicit approval first.",
      inputSchema: { id, allow_republish: z.boolean().default(false).describe("Publish again even if this draft was already published.") },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    safe(async (a) => {
      const draft = await store.get(a.id);
      if (draft.published && !a.allow_republish) {
        throw new Error(`Draft "${a.id}" was already published (${draft.published.url}). Pass allow_republish: true to post it again.`);
      }
      const r = await publish(await getSession(), draft.spec, deps);
      await store.markPublished(a.id, { postUrn: r.urn, url: r.url });
      return ok({ published: true, draftId: a.id, kind: draft.spec.kind, visibility: r.visibility, postUrn: r.urn, url: r.url });
    }),
  );
}
