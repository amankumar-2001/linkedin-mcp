import { basename } from "node:path";
import type { FetchLike } from "./client.js";
import { uploadImage, type ImageSource } from "./images.js";
import { uploadDocument, uploadVideo, type WaitOptions } from "./media.js";
import { buildPostBody, createPost, type PollDuration, type PostBody, type PostContent, type Visibility } from "./posts.js";
import { parsePostRef } from "./refs.js";
import type { Session } from "../session.js";

export const POST_KINDS = ["text", "link", "image", "images", "video", "document", "poll", "reshare"] as const;
export type PostKind = (typeof POST_KINDS)[number];

export interface ImageInput {
  path?: string;
  url?: string;
  alt_text?: string;
}

/**
 * Everything needed to publish one post. Field names match the MCP tool inputs, so drafts store
 * exactly what the user approved and `publish_draft` replays it.
 */
export type PostSpec = { text: string; visibility?: Visibility } & (
  | { kind: "text" }
  | { kind: "link"; url: string; title: string; description?: string; thumbnail_path?: string }
  | { kind: "image"; image_path?: string; image_url?: string; alt_text?: string }
  | { kind: "images"; images: ImageInput[] }
  | { kind: "video"; video_path: string; title?: string; thumbnail_path?: string }
  | { kind: "document"; document_path: string; title?: string }
  | { kind: "poll"; question: string; options: string[]; duration: PollDuration }
  | { kind: "reshare"; post: string }
);

export const POLL_DURATIONS = ["ONE_DAY", "THREE_DAYS", "SEVEN_DAYS", "FOURTEEN_DAYS"] as const;

function imageSource(i: ImageInput, label = "image"): ImageSource {
  if (i.path && i.url) throw new Error(`Pass either a path or a URL for the ${label}, not both.`);
  if (i.path) return { path: i.path };
  if (i.url) return { url: i.url };
  throw new Error(`The ${label} needs a local path or an https URL.`);
}

/** Checks a spec without touching the network, so bad input fails before any upload starts. */
export function validateSpec(spec: PostSpec): void {
  switch (spec.kind) {
    case "link":
      if (!spec.url || !spec.title) throw new Error("A link post needs url and title.");
      break;
    case "image":
      imageSource({ path: spec.image_path, url: spec.image_url });
      break;
    case "images":
      if (!Array.isArray(spec.images) || spec.images.length < 2 || spec.images.length > 20) {
        throw new Error("A multi-image post needs 2 to 20 images.");
      }
      spec.images.forEach((img, i) => imageSource(img, `image #${i + 1}`));
      break;
    case "video":
      if (!spec.video_path) throw new Error("A video post needs video_path (a local MP4).");
      break;
    case "document":
      if (!spec.document_path) throw new Error("A document post needs document_path (PDF, PPT, PPTX, DOC or DOCX).");
      break;
    case "poll": {
      if (!spec.question || spec.question.length > 140) throw new Error("A poll question is required and can be at most 140 characters.");
      const opts = spec.options ?? [];
      if (opts.length < 2 || opts.length > 4) throw new Error("A poll needs 2 to 4 options.");
      const long = opts.find((o) => !o.trim() || o.length > 30);
      if (long !== undefined) throw new Error(`Poll options must be 1–30 characters ("${long}").`);
      if (!POLL_DURATIONS.includes(spec.duration)) throw new Error(`Poll duration must be one of ${POLL_DURATIONS.join(", ")}.`);
      break;
    }
    case "reshare":
      parsePostRef(spec.post);
      break;
    default:
      break;
  }
  // Text rules (length, empty text-only post) are enforced by buildPostBody.
  buildPostBody({ authorUrn: "urn:li:person:preview", text: spec.text, visibility: spec.visibility, content: placeholderContent(spec), reshareParent: spec.kind === "reshare" ? "urn:li:share:0" : undefined });
}

function placeholderContent(spec: PostSpec): PostContent {
  const pending = (what: string) => `urn:li:${what}:<uploaded on publish>`;
  switch (spec.kind) {
    case "link":
      return { kind: "article", source: spec.url, title: spec.title, description: spec.description, thumbnail: spec.thumbnail_path ? pending("image") : undefined };
    case "image":
      return { kind: "image", image: pending("image"), altText: spec.alt_text };
    case "images":
      return { kind: "multiImage", images: spec.images.map((i) => ({ id: pending("image"), altText: i.alt_text })) };
    case "video":
      return { kind: "media", id: pending("video"), title: spec.title ?? basename(spec.video_path) };
    case "document":
      return { kind: "media", id: pending("document"), title: spec.title ?? basename(spec.document_path) };
    case "poll":
      return { kind: "poll", question: spec.question, options: spec.options, duration: spec.duration };
    default:
      return { kind: "text" };
  }
}

/** The exact request body that `publish` would send, with placeholder URNs for files not yet uploaded. */
export function previewBody(spec: PostSpec, authorUrn: string): PostBody {
  validateSpec(spec);
  return buildPostBody({
    authorUrn,
    text: spec.text,
    visibility: spec.visibility,
    content: placeholderContent(spec),
    reshareParent: spec.kind === "reshare" ? parsePostRef(spec.post).urn : undefined,
  });
}

export interface PublishResult {
  urn: string;
  url: string;
  visibility: Visibility;
  assets: string[];
}

/** Uploads any media the spec needs, then creates the post. */
export async function publish(session: Session, spec: PostSpec, deps: { fetchImpl?: FetchLike; wait?: WaitOptions } = {}): Promise<PublishResult> {
  validateSpec(spec);
  const { client, token } = session;
  const owner = token.personUrn;
  const assets: string[] = [];
  let content: PostContent = { kind: "text" };
  let reshareParent: string | undefined;

  switch (spec.kind) {
    case "link": {
      const thumbnail = spec.thumbnail_path ? await uploadImage(client, owner, { path: spec.thumbnail_path }, deps.fetchImpl) : undefined;
      if (thumbnail) assets.push(thumbnail);
      content = { kind: "article", source: spec.url, title: spec.title, description: spec.description, thumbnail };
      break;
    }
    case "image": {
      const id = await uploadImage(client, owner, imageSource({ path: spec.image_path, url: spec.image_url }), deps.fetchImpl);
      assets.push(id);
      content = { kind: "image", image: id, altText: spec.alt_text };
      break;
    }
    case "images": {
      const images: Array<{ id: string; altText?: string }> = [];
      for (const [i, img] of spec.images.entries()) {
        const id = await uploadImage(client, owner, imageSource(img, `image #${i + 1}`), deps.fetchImpl);
        assets.push(id);
        images.push({ id, altText: img.alt_text });
      }
      content = { kind: "multiImage", images };
      break;
    }
    case "video": {
      const id = await uploadVideo(client, owner, spec.video_path, { ...deps.wait, thumbnailPath: spec.thumbnail_path });
      assets.push(id);
      content = { kind: "media", id, title: spec.title ?? basename(spec.video_path) };
      break;
    }
    case "document": {
      const id = await uploadDocument(client, owner, spec.document_path, deps.wait);
      assets.push(id);
      content = { kind: "media", id, title: spec.title ?? basename(spec.document_path) };
      break;
    }
    case "poll":
      content = { kind: "poll", question: spec.question, options: spec.options, duration: spec.duration };
      break;
    case "reshare":
      reshareParent = parsePostRef(spec.post).urn;
      break;
    default:
      break;
  }

  const body = buildPostBody({ authorUrn: owner, text: spec.text, visibility: spec.visibility, content, reshareParent });
  const post = await createPost(client, body);
  return { urn: post.urn, url: post.url, visibility: body.visibility, assets };
}
