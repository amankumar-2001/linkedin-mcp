import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { FetchLike } from "../linkedin/client.js";
import type { WaitOptions } from "../linkedin/media.js";
import { deletePost, editPost } from "../linkedin/posts.js";
import { previewBody, publish, type PostSpec } from "../linkedin/publish.js";
import { requireEditablePost } from "../linkedin/refs.js";
import type { SessionLoader } from "../session.js";
import { anyPostShape, f, toSpec } from "./fields.js";
import { ok, safe } from "./result.js";

const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const;
const CONFIRM = "Show the user the exact post (preview_post) and get explicit approval first.";

export interface PostToolDeps {
  fetchImpl?: FetchLike;
  wait?: WaitOptions;
}

export function registerPostTools(server: McpServer, getSession: SessionLoader, deps: PostToolDeps = {}): void {
  const run = async (spec: PostSpec) => {
    const session = await getSession();
    const r = await publish(session, spec, deps);
    return ok({ published: true, kind: spec.kind, visibility: r.visibility, postUrn: r.urn, url: r.url, ...(r.assets.length ? { assets: r.assets } : {}) });
  };

  server.registerTool(
    "preview_post",
    {
      title: "Preview a LinkedIn post",
      description:
        "Shows exactly what would be sent to LinkedIn for any post kind (text, link, image, images, video, document, poll, reshare) without publishing or uploading anything. Use it to show the user the post before creating it.",
      inputSchema: anyPostShape,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    safe(async (a) => {
      const { token } = await getSession();
      const spec = toSpec(a);
      return ok({ publishes: false, kind: spec.kind, characters: spec.text.length, body: previewBody(spec, token.personUrn) });
    }),
  );

  server.registerTool(
    "create_text_post",
    { title: "Publish a text post", description: `Publishes a text-only post to your LinkedIn feed. ${CONFIRM}`, inputSchema: { text: f.text, visibility: f.visibility }, annotations: WRITE },
    safe((a) => run({ kind: "text", ...a })),
  );

  server.registerTool(
    "create_link_post",
    {
      title: "Publish a link post",
      description: `Publishes a post with a link card (title, optional description and thumbnail). ${CONFIRM}`,
      inputSchema: { text: f.text, visibility: f.visibility, url: f.url, title: f.title, description: f.description, thumbnail_path: f.thumbnailPath },
      annotations: WRITE,
    },
    safe((a) => run({ kind: "link", ...a })),
  );

  server.registerTool(
    "create_image_post",
    {
      title: "Publish an image post",
      description: `Uploads one image (local file or https URL) and publishes it with your text. ${CONFIRM}`,
      inputSchema: { text: f.text, visibility: f.visibility, image_path: f.imagePath, image_url: f.imageUrl, alt_text: f.altText },
      annotations: WRITE,
    },
    safe((a) => run({ kind: "image", ...a })),
  );

  server.registerTool(
    "create_multi_image_post",
    {
      title: "Publish a multi-image post",
      description: `Uploads 2–20 images and publishes them as one post (a swipeable gallery). ${CONFIRM}`,
      inputSchema: { text: f.optionalText, visibility: f.visibility, images: f.images },
      annotations: WRITE,
    },
    safe((a) => run({ kind: "images", ...a })),
  );

  server.registerTool(
    "create_video_post",
    {
      title: "Publish a video post",
      description: `Uploads a local MP4 (multipart), waits for LinkedIn to process it, then publishes it. Large files can take a few minutes. ${CONFIRM}`,
      inputSchema: { text: f.optionalText, visibility: f.visibility, video_path: f.videoPath, title: f.mediaTitle, thumbnail_path: f.thumbnailPath },
      annotations: WRITE,
    },
    safe((a) => run({ kind: "video", ...a })),
  );

  server.registerTool(
    "create_document_post",
    {
      title: "Publish a document (carousel) post",
      description: `Uploads a PDF/PPT/PPTX/DOC/DOCX and publishes it as a swipeable document post — the usual way to share slides or a carousel. ${CONFIRM}`,
      inputSchema: { text: f.optionalText, visibility: f.visibility, document_path: f.documentPath, title: f.mediaTitle },
      annotations: WRITE,
    },
    safe((a) => run({ kind: "document", ...a })),
  );

  server.registerTool(
    "create_poll_post",
    {
      title: "Publish a poll",
      description: `Publishes a poll with 2–4 options, open for 1, 3, 7 or 14 days. You'll see who voted. Don't ask for political, health or other sensitive information. ${CONFIRM}`,
      inputSchema: { text: f.text, visibility: f.visibility, question: f.question, options: f.options, duration: f.duration },
      annotations: WRITE,
    },
    safe((a) => run({ kind: "poll", ...a })),
  );

  server.registerTool(
    "reshare_post",
    {
      title: "Reshare a post",
      description: `Reshares an existing LinkedIn post to your feed, optionally with your own text on top. Accepts a post URN or a linkedin.com post link. ${CONFIRM}`,
      inputSchema: { post: f.post, text: f.optionalText, visibility: f.visibility },
      annotations: WRITE,
    },
    safe((a) => run({ kind: "reshare", ...a })),
  );

  server.registerTool(
    "edit_post",
    {
      title: "Edit a post's text",
      description: "Replaces the text of one of your posts (LinkedIn only allows editing the text, not media or visibility). Show the user the new text and get approval first.",
      inputSchema: { post_urn: z.string().describe("The post URN returned when it was created (urn:li:share:… or urn:li:ugcPost:…)."), text: f.text },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    safe(async (a) => {
      const { client } = await getSession();
      const r = await editPost(client, a.post_urn, a.text);
      return ok({ edited: true, postUrn: r.urn, url: r.url });
    }),
  );

  server.registerTool(
    "delete_post",
    {
      title: "Delete a post",
      description: "Permanently deletes one of your posts by URN (urn:li:share:… or urn:li:ugcPost:…). This cannot be undone.",
      inputSchema: { post_urn: z.string().describe("The post URN returned when the post was created.") },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    safe(async (a) => {
      const { client } = await getSession();
      const urn = requireEditablePost(a.post_urn);
      await deletePost(client, urn);
      return ok({ deleted: true, postUrn: urn });
    }),
  );
}
