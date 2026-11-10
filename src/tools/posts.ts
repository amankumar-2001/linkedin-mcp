import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { FetchLike } from "../linkedin/client.js";
import { uploadImage, type ImageSource } from "../linkedin/images.js";
import { MAX_COMMENTARY_LENGTH, buildPostBody, createPost, deletePost, type PostContent } from "../linkedin/posts.js";
import type { SessionLoader } from "../session.js";
import { ok, safe } from "./result.js";

const text = z.string().max(MAX_COMMENTARY_LENGTH).describe("Post text. #hashtags are kept as hashtags; other formatting characters are posted literally.");
const visibility = z.enum(["PUBLIC", "CONNECTIONS"]).default("PUBLIC").describe("PUBLIC (anyone) or CONNECTIONS (your 1st-degree network).");
const link = {
  url: z.url({ protocol: /^https?$/ }).describe("Link to share."),
  title: z.string().min(1).max(400).describe("Title shown on the link card (LinkedIn does not fetch it from the page)."),
  description: z.string().max(4086).optional().describe("Optional description shown on the link card."),
  thumbnail_path: z.string().optional().describe("Optional local PNG/JPEG/GIF to use as the link card image."),
};
const image = {
  image_path: z.string().optional().describe("Local path to a PNG, JPEG or GIF (max 8 MB)."),
  image_url: z.url({ protocol: /^https$/ }).optional().describe("https:// URL of a PNG, JPEG or GIF to download and attach."),
  alt_text: z.string().max(4086).optional().describe("Alt text for screen readers."),
};

const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const;

function imageSource(a: { image_path?: string; image_url?: string }): ImageSource {
  if (a.image_path && a.image_url) throw new Error("Pass either image_path or image_url, not both.");
  if (a.image_path) return { path: a.image_path };
  if (a.image_url) return { url: a.image_url };
  throw new Error("Pass image_path or image_url.");
}

export function registerPostTools(server: McpServer, getSession: SessionLoader, fetchImpl?: FetchLike): void {
  server.registerTool(
    "preview_post",
    {
      title: "Preview a LinkedIn post",
      description:
        "Shows exactly what would be sent to LinkedIn for a text, link or image post, without publishing anything or uploading images. Use this to show the user the post before creating it.",
      inputSchema: {
        kind: z.enum(["text", "link", "image"]).default("text"),
        text,
        visibility,
        ...link,
        url: link.url.optional(),
        title: link.title.optional(),
        ...image,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    safe(async (a) => {
      const { token } = await getSession();
      let content: PostContent = { kind: "text" };
      if (a.kind === "link") {
        if (!a.url || !a.title) throw new Error("A link preview needs url and title.");
        content = { kind: "article", source: a.url, title: a.title, description: a.description, thumbnail: a.thumbnail_path ? "urn:li:image:<uploaded on publish>" : undefined };
      } else if (a.kind === "image") {
        imageSource(a);
        content = { kind: "image", image: "urn:li:image:<uploaded on publish>", altText: a.alt_text };
      }
      const body = buildPostBody({ authorUrn: token.personUrn, text: a.text, visibility: a.visibility, content });
      return ok({ publishes: false, characters: a.text.length, body });
    }),
  );

  server.registerTool(
    "create_text_post",
    {
      title: "Publish a text post on LinkedIn",
      description: "Publishes a text-only post to the signed-in member's LinkedIn feed. Confirm the exact text with the user first.",
      inputSchema: { text, visibility },
      annotations: WRITE,
    },
    safe(async (a) => {
      const { client, token } = await getSession();
      const body = buildPostBody({ authorUrn: token.personUrn, text: a.text, visibility: a.visibility });
      const post = await createPost(client, body);
      return ok({ published: true, visibility: body.visibility, postUrn: post.urn, url: post.url });
    }),
  );

  server.registerTool(
    "create_link_post",
    {
      title: "Publish a link post on LinkedIn",
      description: "Publishes a post with a link card (title, optional description and thumbnail). Confirm the exact text with the user first.",
      inputSchema: { text, visibility, ...link },
      annotations: WRITE,
    },
    safe(async (a) => {
      const { client, token } = await getSession();
      const thumbnail = a.thumbnail_path ? await uploadImage(client, token.personUrn, { path: a.thumbnail_path }, fetchImpl) : undefined;
      const body = buildPostBody({
        authorUrn: token.personUrn,
        text: a.text,
        visibility: a.visibility,
        content: { kind: "article", source: a.url, title: a.title, description: a.description, thumbnail },
      });
      const post = await createPost(client, body);
      return ok({ published: true, visibility: body.visibility, postUrn: post.urn, url: post.url });
    }),
  );

  server.registerTool(
    "create_image_post",
    {
      title: "Publish an image post on LinkedIn",
      description: "Uploads one image (local file or https URL) and publishes it with the given text. Confirm the exact text and image with the user first.",
      inputSchema: { text, visibility, ...image },
      annotations: WRITE,
    },
    safe(async (a) => {
      const source = imageSource(a);
      const { client, token } = await getSession();
      const imageUrn = await uploadImage(client, token.personUrn, source, fetchImpl);
      const body = buildPostBody({
        authorUrn: token.personUrn,
        text: a.text,
        visibility: a.visibility,
        content: { kind: "image", image: imageUrn, altText: a.alt_text },
      });
      const post = await createPost(client, body);
      return ok({ published: true, visibility: body.visibility, postUrn: post.urn, imageUrn, url: post.url });
    }),
  );

  server.registerTool(
    "delete_post",
    {
      title: "Delete a LinkedIn post",
      description: "Permanently deletes one of the signed-in member's posts by URN (urn:li:share:… or urn:li:ugcPost:…). This cannot be undone.",
      inputSchema: { post_urn: z.string().describe("The post URN returned when the post was created.") },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    safe(async (a) => {
      const { client } = await getSession();
      await deletePost(client, a.post_urn);
      return ok({ deleted: true, postUrn: a.post_urn });
    }),
  );
}
