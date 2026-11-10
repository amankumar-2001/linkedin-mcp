import type { LinkedInClient } from "./client.js";

export type Visibility = "PUBLIC" | "CONNECTIONS";

/** LinkedIn's limit for post commentary. */
export const MAX_COMMENTARY_LENGTH = 3000;

export type PostContent =
  | { kind: "text" }
  | { kind: "article"; source: string; title: string; description?: string; thumbnail?: string }
  | { kind: "image"; image: string; altText?: string };

export interface PostBody {
  author: string;
  commentary: string;
  visibility: Visibility;
  distribution: { feedDistribution: "MAIN_FEED"; targetEntities: []; thirdPartyDistributionChannels: [] };
  content?: Record<string, unknown>;
  lifecycleState: "PUBLISHED";
  isReshareDisabledByAuthor: boolean;
}

/**
 * Escapes characters reserved by LinkedIn's "little" text format so commentary is posted verbatim.
 * Without this, text after an unescaped "(" or "[" can be silently dropped.
 * `#word` is left alone so hashtags still link.
 */
export function escapeLittleText(text: string): string {
  return text.replace(/[\\|{}@[\]()<>*_~#]/g, (ch, offset: number, whole: string) => {
    if (ch === "#" && /[\p{L}\p{N}_]/u.test(whole.charAt(offset + 1))) return ch;
    return `\\${ch}`;
  });
}

export function buildPostBody(args: { authorUrn: string; text: string; visibility?: Visibility; content?: PostContent }): PostBody {
  const commentary = escapeLittleText(args.text);
  if (args.text.trim().length === 0 && (!args.content || args.content.kind === "text")) {
    throw new Error("Post text cannot be empty.");
  }
  if (args.text.length > MAX_COMMENTARY_LENGTH) {
    throw new Error(`Post text is ${args.text.length} characters; LinkedIn allows ${MAX_COMMENTARY_LENGTH}.`);
  }
  const body: PostBody = {
    author: args.authorUrn,
    commentary,
    visibility: args.visibility ?? "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };
  const c = args.content;
  if (c?.kind === "article") {
    body.content = {
      article: {
        source: c.source,
        title: c.title,
        ...(c.description ? { description: c.description } : {}),
        ...(c.thumbnail ? { thumbnail: c.thumbnail } : {}),
      },
    };
  } else if (c?.kind === "image") {
    body.content = { media: { id: c.image, ...(c.altText ? { altText: c.altText } : {}) } };
  }
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
