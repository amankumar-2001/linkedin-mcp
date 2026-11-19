import type { LinkedInClient } from "./client.js";
import { requireEditablePost } from "./refs.js";

export type Visibility = "PUBLIC" | "CONNECTIONS";
export type PollDuration = "ONE_DAY" | "THREE_DAYS" | "SEVEN_DAYS" | "FOURTEEN_DAYS";

/** LinkedIn's limit for post commentary. */
export const MAX_COMMENTARY_LENGTH = 3000;

export type PostContent =
  | { kind: "text" }
  | { kind: "article"; source: string; title: string; description?: string; thumbnail?: string }
  | { kind: "image"; image: string; altText?: string }
  | { kind: "multiImage"; images: Array<{ id: string; altText?: string }> }
  /** A finished video (urn:li:video:…) or document (urn:li:document:…) upload. */
  | { kind: "media"; id: string; title?: string }
  | { kind: "poll"; question: string; options: string[]; duration: PollDuration };

export interface PostBody {
  author: string;
  commentary: string;
  visibility: Visibility;
  distribution: { feedDistribution: "MAIN_FEED"; targetEntities: []; thirdPartyDistributionChannels: [] };
  content?: Record<string, unknown>;
  reshareContext?: { parent: string };
  lifecycleState: "PUBLISHED";
  isReshareDisabledByAuthor: boolean;
}

/** `@[Display Name](urn:li:person:abc)` or `(urn:li:organization:123)` — LinkedIn's mention syntax. */
const MENTION = /@\[([^\]\n]{1,100})\]\((urn:li:(?:person|organization|organizationBrand):[A-Za-z0-9_-]+)\)/g;

function escapeSegment(text: string): string {
  return text.replace(/[\\|{}@[\]()<>*_~#]/g, (ch, offset: number, whole: string) => {
    if (ch === "#" && /[\p{L}\p{N}_]/u.test(whole.charAt(offset + 1))) return ch;
    return `\\${ch}`;
  });
}

/**
 * Escapes characters reserved by LinkedIn's "little" text format so commentary is posted verbatim.
 * Without this, text after an unescaped "(" or "[" can be silently dropped.
 * `#word` hashtags and `@[Name](urn:li:person:…)` mentions are kept as-is so they still link.
 */
export function escapeLittleText(text: string): string {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(MENTION)) {
    out += escapeSegment(text.slice(last, m.index));
    out += `@[${m[1]!.replace(/[\\[\]()]/g, (c) => `\\${c}`)}](${m[2]})`;
    last = m.index + m[0].length;
  }
  return out + escapeSegment(text.slice(last));
}

export function buildPostBody(args: {
  authorUrn: string;
  text: string;
  visibility?: Visibility;
  content?: PostContent;
  reshareParent?: string;
}): PostBody {
  const hasContent = (args.content && args.content.kind !== "text") || Boolean(args.reshareParent);
  if (args.text.trim().length === 0 && !hasContent) throw new Error("Post text cannot be empty.");
  if (args.text.length > MAX_COMMENTARY_LENGTH) {
    throw new Error(`Post text is ${args.text.length} characters; LinkedIn allows ${MAX_COMMENTARY_LENGTH}.`);
  }
  const body: PostBody = {
    author: args.authorUrn,
    commentary: escapeLittleText(args.text),
    visibility: args.visibility ?? "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };
  const c = args.content;
  switch (c?.kind) {
    case "article":
      body.content = {
        article: {
          source: c.source,
          title: c.title,
          ...(c.description ? { description: c.description } : {}),
          ...(c.thumbnail ? { thumbnail: c.thumbnail } : {}),
        },
      };
      break;
    case "image":
      body.content = { media: { id: c.image, ...(c.altText ? { altText: c.altText } : {}) } };
      break;
    case "multiImage":
      body.content = { multiImage: { images: c.images.map((i) => ({ id: i.id, ...(i.altText ? { altText: i.altText } : {}) })) } };
      break;
    case "media":
      body.content = { media: { id: c.id, ...(c.title ? { title: c.title } : {}) } };
      break;
    case "poll":
      body.content = { poll: { question: c.question, options: c.options.map((text) => ({ text })), settings: { duration: c.duration } } };
      break;
    default:
      break;
  }
  if (args.reshareParent) body.reshareContext = { parent: args.reshareParent };
  return body;
}

export function postUrl(postUrn: string): string {
  return `https://www.linkedin.com/feed/update/${postUrn}/`;
}

export async function createPost(client: LinkedInClient, body: PostBody): Promise<{ urn: string; url: string }> {
  const res = await client.rest("/posts", { method: "POST", body });
  const urn = res.headers.get("x-restli-id") ?? res.headers.get("x-linkedin-id");
  if (!urn) throw new Error("LinkedIn accepted the post but did not return its id (x-restli-id header missing).");
  return { urn, url: postUrl(urn) };
}

export function isPostUrn(value: string): boolean {
  return /^urn:li:(share|ugcPost):\d+$/.test(value);
}

export async function deletePost(client: LinkedInClient, postUrn: string): Promise<void> {
  if (!isPostUrn(postUrn)) throw new Error(`"${postUrn}" is not a post URN (expected urn:li:share:… or urn:li:ugcPost:…).`);
  await client.rest(`/posts/${encodeURIComponent(postUrn)}`, { method: "DELETE", headers: { "X-RestLi-Method": "DELETE" } });
}

/** Replaces the text of one of your posts. LinkedIn only allows editing the commentary. */
export async function editPost(client: LinkedInClient, post: string, text: string): Promise<{ urn: string; url: string }> {
  const urn = requireEditablePost(post);
  if (text.trim().length === 0) throw new Error("New post text cannot be empty.");
  if (text.length > MAX_COMMENTARY_LENGTH) throw new Error(`Post text is ${text.length} characters; LinkedIn allows ${MAX_COMMENTARY_LENGTH}.`);
  await client.rest(`/posts/${encodeURIComponent(urn)}`, {
    method: "POST",
    headers: { "X-RestLi-Method": "PARTIAL_UPDATE" },
    body: { patch: { $set: { commentary: escapeLittleText(text) } } },
  });
  return { urn, url: postUrl(urn) };
}
