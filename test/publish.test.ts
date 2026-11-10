import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LinkedInClient } from "../src/linkedin/client.js";
import { escapeLittleText, editPost } from "../src/linkedin/posts.js";
import { previewBody, publish, validateSpec, type PostSpec } from "../src/linkedin/publish.js";
import { parsePostRef, requireEditablePost } from "../src/linkedin/refs.js";
import type { Session } from "../src/session.js";
import { json, stubFetch } from "./helpers.js";

const me = "urn:li:person:me";
const noWait = { sleep: async () => {}, pollIntervalMs: 0, timeoutMs: 1_000 };

function session(fetchImpl: typeof fetch): Session {
  return {
    token: { accessToken: "AT", expiresAt: Date.now() + 1e9, scopes: ["w_member_social"], personUrn: me, createdAt: 0 },
    client: new LinkedInClient({ accessToken: "AT", apiVersion: "202610", fetchImpl }),
  };
}

const posted = (urn = "urn:li:share:9") => () => new Response(null, { status: 201, headers: { "x-restli-id": urn } });

async function tmpFile(name: string, bytes: Uint8Array | string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "limcp-"));
  const p = join(dir, name);
  await writeFile(p, bytes);
  return p;
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

function fakeMp4(size: number): Uint8Array {
  const b = new Uint8Array(size);
  b.set([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70], 0); // ....ftyp
  for (let i = 8; i < size; i++) b[i] = i % 251;
  return b;
}

describe("mentions and post refs", () => {
  it("keeps valid mention tokens but escapes everything else", () => {
    expect(escapeLittleText("Thanks @[Bloom Health](urn:li:organization:123) and @[Aman](urn:li:person:Ab_9-x) (team)!"))
      .toBe("Thanks @[Bloom Health](urn:li:organization:123) and @[Aman](urn:li:person:Ab_9-x) \\(team\\)!");
    expect(escapeLittleText("email me @ work [not a mention](https://x.y)")).toBe("email me \\@ work \\[not a mention\\]\\(https://x.y\\)");
  });

  it("parses URNs and links", () => {
    expect(parsePostRef("urn:li:share:123")).toEqual({ urn: "urn:li:share:123", kind: "share" });
    expect(parsePostRef("https://www.linkedin.com/feed/update/urn:li:activity:7100000000000000001/")).toEqual({ urn: "urn:li:activity:7100000000000000001", kind: "activity" });
    expect(parsePostRef("https://www.linkedin.com/feed/update/urn%3Ali%3AugcPost%3A42/").urn).toBe("urn:li:ugcPost:42");
    expect(parsePostRef("https://www.linkedin.com/posts/aman-kumar_mcp-activity-7255555555555555555-AbCd/?utm=x").urn).toBe("urn:li:activity:7255555555555555555");
    expect(() => parsePostRef("hello")).toThrow(/Could not find/);
    expect(() => requireEditablePost("urn:li:activity:1")).toThrow(/activity id/);
  });
});

describe("validateSpec", () => {
  const cases: Array<[PostSpec, RegExp]> = [
    [{ kind: "images", text: "", images: [{ path: "a.png" }] }, /2 to 20/],
    [{ kind: "poll", text: "Q?", question: "x".repeat(141), options: ["a", "b"], duration: "ONE_DAY" }, /140/],
    [{ kind: "poll", text: "Q?", question: "Best DB?", options: ["Postgres"], duration: "ONE_DAY" }, /2 to 4/],
    [{ kind: "poll", text: "Q?", question: "Best DB?", options: ["a", "x".repeat(31)], duration: "ONE_DAY" }, /1–30/],
    [{ kind: "image", text: "hi" }, /local path or an https URL/],
    [{ kind: "reshare", text: "", post: "nope" }, /Could not find/],
    [{ kind: "text", text: "  " }, /empty/],
  ];
  it.each(cases)("rejects invalid %#", (spec, msg) => {
    expect(() => validateSpec(spec)).toThrow(msg);
  });

  it("allows media posts with no text", () => {
    expect(() => validateSpec({ kind: "document", text: "", document_path: "deck.pdf" })).not.toThrow();
    expect(previewBody({ kind: "reshare", text: "", post: "urn:li:share:5" }, me).reshareContext).toEqual({ parent: "urn:li:share:5" });
  });
});

describe("publish", () => {
  it("creates a poll post", async () => {
    const stub = stubFetch({ "POST https://api.linkedin.com/rest/posts": posted() });
    await publish(session(stub.fetch), { kind: "poll", text: "Quick one", question: "Best DB?", options: ["Postgres", "MongoDB"], duration: "SEVEN_DAYS" });
    expect(stub.calls[0]!.body).toMatchObject({
      author: me,
      content: { poll: { question: "Best DB?", options: [{ text: "Postgres" }, { text: "MongoDB" }], settings: { duration: "SEVEN_DAYS" } } },
    });
  });

  it("uploads each image for a multi-image post", async () => {
    const a = await tmpFile("a.png", PNG);
    let n = 0;
    const stub = stubFetch({
      "POST https://api.linkedin.com/rest/images?action=initializeUpload": () => json({ value: { uploadUrl: `https://up.example/${++n}`, image: `urn:li:image:I${n}` } }),
      "PUT https://up.example/": () => new Response(null, { status: 201 }),
      "POST https://api.linkedin.com/rest/posts": posted(),
    });
    const r = await publish(session(stub.fetch), { kind: "images", text: "", images: [{ path: a, alt_text: "one" }, { path: a }] });
    expect(r.assets).toEqual(["urn:li:image:I1", "urn:li:image:I2"]);
    expect(stub.calls.at(-1)!.body).toMatchObject({ content: { multiImage: { images: [{ id: "urn:li:image:I1", altText: "one" }, { id: "urn:li:image:I2" }] } } });
  });

  it("uploads a video in parts, finalizes with ETags, waits for AVAILABLE, then posts", async () => {
    const size = 100 * 1024;
    const video = await tmpFile("clip.mp4", fakeMp4(size));
    let polls = 0;
    const stub = stubFetch({
      "POST https://api.linkedin.com/rest/videos?action=initializeUpload": () =>
        json({
          value: {
            video: "urn:li:video:V1",
            uploadToken: "tok",
            uploadInstructions: [
              { uploadUrl: "https://up.example/p1", firstByte: 0, lastByte: 65535 },
              { uploadUrl: "https://up.example/p2", firstByte: 65536, lastByte: size - 1 },
            ],
          },
        }),
      "PUT https://up.example/p1": () => new Response(null, { status: 200, headers: { etag: '"e1"' } }),
      "PUT https://up.example/p2": () => new Response(null, { status: 200, headers: { etag: "e2" } }),
      "POST https://api.linkedin.com/rest/videos?action=finalizeUpload": () => new Response(null, { status: 200 }),
      "GET https://api.linkedin.com/rest/videos/": () => json({ status: ++polls < 2 ? "PROCESSING" : "AVAILABLE" }),
      "POST https://api.linkedin.com/rest/posts": posted("urn:li:ugcPost:77"),
    });
    const r = await publish(session(stub.fetch), { kind: "video", text: "Demo", video_path: video }, { wait: noWait });
    expect(r.urn).toBe("urn:li:ugcPost:77");
    const puts = stub.calls.filter((c) => c.method === "PUT");
    expect(puts.map((c) => (c.body as Uint8Array).byteLength)).toEqual([65536, size - 65536]);
    expect(stub.calls.find((c) => c.url.includes("finalizeUpload"))!.body).toEqual({
      finalizeUploadRequest: { video: "urn:li:video:V1", uploadToken: "tok", uploadedPartIds: ["e1", "e2"] },
    });
    expect(polls).toBe(2);
    expect(stub.calls.at(-1)!.body).toMatchObject({ content: { media: { id: "urn:li:video:V1", title: "clip.mp4" } } });
  });

  it("stops with a clear error if the video fails processing, and never posts", async () => {
    const video = await tmpFile("clip.mp4", fakeMp4(80 * 1024));
    const stub = stubFetch({
      "POST https://api.linkedin.com/rest/videos?action=initializeUpload": () =>
        json({ value: { video: "urn:li:video:V2", uploadInstructions: [{ uploadUrl: "https://up.example/x", firstByte: 0, lastByte: 80 * 1024 - 1 }] } }),
      "PUT https://up.example/x": () => new Response(null, { status: 200, headers: { etag: "e" } }),
      "POST https://api.linkedin.com/rest/videos?action=finalizeUpload": () => new Response(null, { status: 200 }),
      "GET https://api.linkedin.com/rest/videos/": () => json({ status: "PROCESSING_FAILED", processingFailureReason: "Bad codec" }),
    });
    await expect(publish(session(stub.fetch), { kind: "video", text: "", video_path: video }, { wait: noWait })).rejects.toThrow(/Bad codec/);
    expect(stub.calls.some((c) => c.url.endsWith("/rest/posts"))).toBe(false);
  });

  it("rejects non-MP4 videos and unsupported documents before calling LinkedIn", async () => {
    const notVideo = await tmpFile("x.mp4", new Uint8Array(80 * 1024));
    const notDoc = await tmpFile("x.txt", "hello");
    const stub = stubFetch({});
    await expect(publish(session(stub.fetch), { kind: "video", text: "", video_path: notVideo }, { wait: noWait })).rejects.toThrow(/MP4/);
    await expect(publish(session(stub.fetch), { kind: "document", text: "", document_path: notDoc }, { wait: noWait })).rejects.toThrow(/PDF/);
    expect(stub.calls).toHaveLength(0);
  });

  it("uploads a document and posts it with its file name as title", async () => {
    const pdf = await tmpFile("Deck.pdf", "%PDF-1.7 fake");
    const stub = stubFetch({
      "POST https://api.linkedin.com/rest/documents?action=initializeUpload": () => json({ value: { uploadUrl: "https://up.example/d", document: "urn:li:document:D1" } }),
      "PUT https://up.example/d": () => new Response(null, { status: 201 }),
      "GET https://api.linkedin.com/rest/documents/": () => json({ status: "AVAILABLE" }),
      "POST https://api.linkedin.com/rest/posts": posted(),
    });
    await publish(session(stub.fetch), { kind: "document", text: "Slides", document_path: pdf }, { wait: noWait });
    expect(stub.calls[0]!.body).toEqual({ initializeUploadRequest: { owner: me } });
    expect(stub.calls.at(-1)!.body).toMatchObject({ content: { media: { id: "urn:li:document:D1", title: "Deck.pdf" } } });
  });

  it("reshares from a post link", async () => {
    const stub = stubFetch({ "POST https://api.linkedin.com/rest/posts": posted() });
    await publish(session(stub.fetch), { kind: "reshare", text: "Worth a read", post: "https://www.linkedin.com/feed/update/urn:li:share:555/" });
    expect(stub.calls[0]!.body).toMatchObject({ reshareContext: { parent: "urn:li:share:555" }, commentary: "Worth a read" });
  });

  it("edits a post with PARTIAL_UPDATE", async () => {
    const stub = stubFetch({ "POST https://api.linkedin.com/rest/posts/": () => new Response(null, { status: 204 }) });
    await editPost(session(stub.fetch).client, "urn:li:share:9", "Fixed typo (v2)");
    expect(stub.calls[0]!.url).toBe("https://api.linkedin.com/rest/posts/urn%3Ali%3Ashare%3A9");
    expect(stub.calls[0]!.headers["x-restli-method"]).toBe("PARTIAL_UPDATE");
    expect(stub.calls[0]!.body).toEqual({ patch: { $set: { commentary: "Fixed typo \\(v2\\)" } } });
  });
});
