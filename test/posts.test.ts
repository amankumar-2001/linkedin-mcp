import { describe, expect, it } from "vitest";
import { LinkedInClient } from "../src/linkedin/client.js";
import { buildPostBody, createPost, deletePost, escapeLittleText, MAX_COMMENTARY_LENGTH } from "../src/linkedin/posts.js";
import { LinkedInApiError } from "../src/errors.js";
import { stubFetch } from "./helpers.js";

const author = "urn:li:person:abc123";

describe("escapeLittleText", () => {
  it("escapes reserved characters but keeps hashtags", () => {
    expect(escapeLittleText("Shipped v2 (finally) #golang @team [beta] a_b *x* ~y~ <z> {q} | \\"))
      .toBe("Shipped v2 \\(finally\\) #golang \\@team \\[beta\\] a\\_b \\*x\\* \\~y\\~ \\<z\\> \\{q\\} \\| \\\\");
  });
  it("escapes a lone # that is not a hashtag", () => {
    expect(escapeLittleText("Issue # 42 and #")).toBe("Issue \\# 42 and \\#");
  });
  it("keeps unicode hashtags", () => {
    expect(escapeLittleText("#हिंदी #café")).toBe("#हिंदी #café");
  });
});

describe("buildPostBody", () => {
  it("builds a text post matching the Posts API shape", () => {
    expect(buildPostBody({ authorUrn: author, text: "Hello" })).toEqual({
      author,
      commentary: "Hello",
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    });
  });
  it("adds article content for link posts", () => {
    const body = buildPostBody({
      authorUrn: author,
      text: "Read this",
      visibility: "CONNECTIONS",
      content: { kind: "article", source: "https://example.com", title: "Example", thumbnail: "urn:li:image:1" },
    });
    expect(body.visibility).toBe("CONNECTIONS");
    expect(body.content).toEqual({ article: { source: "https://example.com", title: "Example", thumbnail: "urn:li:image:1" } });
  });
  it("adds media content for image posts", () => {
    const body = buildPostBody({ authorUrn: author, text: "", content: { kind: "image", image: "urn:li:image:9", altText: "chart" } });
    expect(body.content).toEqual({ media: { id: "urn:li:image:9", altText: "chart" } });
  });
  it("rejects empty text posts and over-long text", () => {
    expect(() => buildPostBody({ authorUrn: author, text: "   " })).toThrow(/empty/);
    expect(() => buildPostBody({ authorUrn: author, text: "x".repeat(MAX_COMMENTARY_LENGTH + 1) })).toThrow(/3000/);
  });
});

describe("createPost / deletePost", () => {
  it("sends versioned headers and returns the URN from x-restli-id", async () => {
    const { fetch, calls } = stubFetch({
      "POST https://api.linkedin.com/rest/posts": () => new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:share:777" } }),
    });
    const client = new LinkedInClient({ accessToken: "tok", apiVersion: "202610", fetchImpl: fetch });
    const post = await createPost(client, buildPostBody({ authorUrn: author, text: "Hi" }));
    expect(post).toEqual({ urn: "urn:li:share:777", url: "https://www.linkedin.com/feed/update/urn:li:share:777/" });
    expect(calls[0]!.headers).toMatchObject({
      authorization: "Bearer tok",
      "linkedin-version": "202610",
      "x-restli-protocol-version": "2.0.0",
      "content-type": "application/json",
    });
  });

  it("url-encodes the URN on delete and rejects non-post URNs", async () => {
    const { fetch, calls } = stubFetch({ "DELETE https://api.linkedin.com/rest/posts/": () => new Response(null, { status: 204 }) });
    const client = new LinkedInClient({ accessToken: "tok", apiVersion: "202610", fetchImpl: fetch });
    await deletePost(client, "urn:li:share:777");
    expect(calls[0]!.url).toBe("https://api.linkedin.com/rest/posts/urn%3Ali%3Ashare%3A777");
    await expect(deletePost(client, "urn:li:person:1")).rejects.toThrow(/not a post URN/);
  });

  it("maps API errors to LinkedInApiError with hints", async () => {
    const { fetch } = stubFetch({
      "POST https://api.linkedin.com/rest/posts": () =>
        new Response(JSON.stringify({ message: "Not enough permissions" }), { status: 403 }),
    });
    const client = new LinkedInClient({ accessToken: "tok", apiVersion: "202610", fetchImpl: fetch });
    const err = await createPost(client, buildPostBody({ authorUrn: author, text: "Hi" })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LinkedInApiError);
    expect((err as Error).message).toMatch(/403.*Not enough permissions.*w_member_social/);
  });
});
