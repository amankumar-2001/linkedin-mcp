import { z } from "zod";
import { MAX_COMMENTARY_LENGTH } from "../linkedin/posts.js";
import { POLL_DURATIONS, POST_KINDS, type PostSpec } from "../linkedin/publish.js";

/** Zod fields shared by the post, preview and draft tools. */
export const f = {
  text: z
    .string()
    .max(MAX_COMMENTARY_LENGTH)
    .describe("Post text (max 3,000 chars). #hashtags stay clickable; mention with @[Name](urn:li:person:ID) or @[Company](urn:li:organization:ID). Other formatting characters are posted literally."),
  optionalText: z.string().max(MAX_COMMENTARY_LENGTH).default("").describe("Optional post text. Same rules as for text posts."),
  visibility: z.enum(["PUBLIC", "CONNECTIONS"]).default("PUBLIC").describe("PUBLIC (anyone) or CONNECTIONS (your 1st-degree network)."),
  url: z.url({ protocol: /^https?$/ }).describe("Link to share."),
  title: z.string().min(1).max(400).describe("Title shown on the link card (LinkedIn does not fetch it from the page)."),
  description: z.string().max(4086).optional().describe("Optional description shown on the link card."),
  thumbnailPath: z.string().optional().describe("Optional local PNG/JPEG/GIF to use as the thumbnail."),
  imagePath: z.string().optional().describe("Local path to a PNG, JPEG or GIF (max 8 MB)."),
  imageUrl: z.url({ protocol: /^https$/ }).optional().describe("https:// URL of a PNG, JPEG or GIF to download and attach."),
  altText: z.string().max(4086).optional().describe("Alt text for screen readers."),
  images: z
    .array(
      z.object({
        path: z.string().optional().describe("Local image path."),
        url: z.url({ protocol: /^https$/ }).optional().describe("https:// image URL."),
        alt_text: z.string().max(4086).optional(),
      }),
    )
    .min(2)
    .max(20)
    .describe("2 to 20 images, each with a local path or https URL."),
  videoPath: z.string().describe("Local path to an MP4 (3 s – 30 min, 75 KB – 500 MB)."),
  documentPath: z.string().describe("Local path to a PDF, PPT, PPTX, DOC or DOCX (max 100 MB / 300 pages). Shown as a swipeable carousel."),
  mediaTitle: z.string().max(400).optional().describe("Title shown on the video/document (defaults to the file name)."),
  question: z.string().min(1).max(140).describe("Poll question (max 140 chars)."),
  options: z.array(z.string().min(1).max(30)).min(2).max(4).describe("2 to 4 poll options, each up to 30 chars."),
  duration: z.enum(POLL_DURATIONS).default("THREE_DAYS").describe("How long the poll stays open."),
  post: z.string().describe("Post URN (urn:li:share:… / urn:li:ugcPost:… / urn:li:activity:…) or a linkedin.com post link."),
};

/** Every post field, all optional, plus `kind` — used by preview_post, save_draft and update_draft. */
export const anyPostShape = {
  kind: z.enum(POST_KINDS).default("text").describe("text, link, image, images (multi-image), video, document, poll or reshare."),
  text: f.optionalText,
  visibility: f.visibility,
  url: f.url.optional(),
  title: z.string().max(400).optional().describe("Link card title (link posts) or media title (video/document)."),
  description: f.description,
  thumbnail_path: f.thumbnailPath,
  image_path: f.imagePath,
  image_url: f.imageUrl,
  alt_text: f.altText,
  images: f.images.optional(),
  video_path: z.string().optional().describe("Local MP4 path (video posts)."),
  document_path: z.string().optional().describe("Local PDF/PPT/PPTX/DOC/DOCX path (document posts)."),
  question: z.string().max(140).optional().describe("Poll question."),
  options: z.array(z.string().max(30)).optional().describe("Poll options."),
  duration: z.enum(POLL_DURATIONS).optional().describe("Poll duration."),
  post: z.string().optional().describe("Post to reshare (URN or link)."),
};

/** Same fields with no defaults, so update_draft only changes what the caller actually passes. */
export const updatePostShape = {
  ...anyPostShape,
  kind: z.enum(POST_KINDS).optional().describe("Switch the post type (text, link, image, images, video, document, poll, reshare)."),
  text: z.string().max(MAX_COMMENTARY_LENGTH).optional().describe("New post text."),
  visibility: z.enum(["PUBLIC", "CONNECTIONS"]).optional().describe("New visibility."),
};

export type AnyPostArgs = { [K in keyof typeof anyPostShape]?: z.infer<(typeof anyPostShape)[K]> };

/** Turns the flat tool arguments into a PostSpec, keeping only the fields that kind uses. */
export function toSpec(a: AnyPostArgs): PostSpec {
  const base = { text: a.text ?? "", visibility: a.visibility ?? "PUBLIC" } as const;
  switch (a.kind ?? "text") {
    case "link":
      return { ...base, kind: "link", url: a.url ?? "", title: a.title ?? "", description: a.description, thumbnail_path: a.thumbnail_path };
    case "image":
      return { ...base, kind: "image", image_path: a.image_path, image_url: a.image_url, alt_text: a.alt_text };
    case "images":
      return { ...base, kind: "images", images: a.images ?? [] };
    case "video":
      return { ...base, kind: "video", video_path: a.video_path ?? "", title: a.title, thumbnail_path: a.thumbnail_path };
    case "document":
      return { ...base, kind: "document", document_path: a.document_path ?? "", title: a.title };
    case "poll":
      return { ...base, kind: "poll", question: a.question ?? "", options: a.options ?? [], duration: a.duration ?? "THREE_DAYS" };
    case "reshare":
      return { ...base, kind: "reshare", post: a.post ?? "" };
    default:
      return { ...base, kind: "text" };
  }
}

/** Drops undefined fields so stored drafts stay tidy. */
export function compact<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}
