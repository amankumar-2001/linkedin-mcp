import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { LinkedInClient, type FetchLike } from "../src/linkedin/client.js";
import { createServer } from "../src/server.js";
import type { Session } from "../src/session.js";
import { NotAuthenticatedError } from "../src/errors.js";
import { json, stubFetch } from "./helpers.js";

const token = {
  accessToken: "AT",
  expiresAt: Date.now() + 30 * 86_400_000,
  scopes: ["openid", "profile", "email", "w_member_social"],
  personUrn: "urn:li:person:me",
  name: "Aman Kumar",
  createdAt: Date.now(),
};

async function connect(fetchImpl: FetchLike, signedIn = true) {
  const getSession = async (): Promise<Session> => {
    if (!signedIn) throw new NotAuthenticatedError();
    return { token, client: new LinkedInClient({ accessToken: token.accessToken, apiVersion: "202610", fetchImpl }) };
  };
  const server = createServer({ version: "0.0.0-test", getSession, fetchImpl, dataDir: await mkdtemp(join(tmpdir(), "limcp-data-")) });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

const text = (r: Record<string, unknown>) => ((r.content as Array<{ text: string }> | undefined)?.[0]?.text ?? "");

describe("MCP tools", () => {
  it("lists the post tools with write tools marked non-read-only", async () => {
    const client = await connect(stubFetch({}).fetch);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        "auth_status",
        "get_my_profile",
        "preview_post",
        "create_text_post",
        "create_link_post",
        "create_image_post",
        "create_multi_image_post",
        "create_video_post",
        "create_document_post",
        "create_poll_post",
        "reshare_post",
        "edit_post",
        "delete_post",
      ]),
    );
    const del = tools.find((t) => t.name === "delete_post")!;
    expect(del.annotations).toMatchObject({ destructiveHint: true, readOnlyHint: false });
    expect(tools.find((t) => t.name === "preview_post")!.annotations?.readOnlyHint).toBe(true);
  });

  it("preview_post never calls LinkedIn", async () => {
    const stub = stubFetch({});
    const client = await connect(stub.fetch);
    const r = await client.callTool({ name: "preview_post", arguments: { kind: "link", text: "New site (v2)", url: "https://example.com", title: "Example" } });
    expect(r.isError).toBeFalsy();
    expect(JSON.parse(text(r))).toMatchObject({ publishes: false, body: { commentary: "New site \\(v2\\)", content: { article: { title: "Example" } } } });
    expect(stub.calls).toHaveLength(0);
  });

  it("create_text_post publishes and returns the post link", async () => {
    const stub = stubFetch({
      "POST https://api.linkedin.com/rest/posts": () => new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:share:1" } }),
    });
    const client = await connect(stub.fetch);
    const r = await client.callTool({ name: "create_text_post", arguments: { text: "Hello #mcp", visibility: "CONNECTIONS" } });
    expect(JSON.parse(text(r))).toEqual({ published: true, kind: "text", visibility: "CONNECTIONS", postUrn: "urn:li:share:1", url: "https://www.linkedin.com/feed/update/urn:li:share:1/" });
    expect(stub.calls[0]!.body).toMatchObject({ author: "urn:li:person:me", commentary: "Hello #mcp", visibility: "CONNECTIONS" });
  });

  it("create_image_post uploads the image first, then posts it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "linkedin-mcp-img-"));
    const png = join(dir, "a.png");
    await writeFile(png, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]));
    const stub = stubFetch({
      "POST https://api.linkedin.com/rest/images?action=initializeUpload": () => json({ value: { uploadUrl: "https://upload.example/u1", image: "urn:li:image:I1" } }),
      "PUT https://upload.example/u1": () => new Response(null, { status: 201 }),
      "POST https://api.linkedin.com/rest/posts": () => new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:share:2" } }),
    });
    const client = await connect(stub.fetch);
    const r = await client.callTool({ name: "create_image_post", arguments: { text: "Chart", image_path: png, alt_text: "bar chart" } });
    expect(r.isError).toBeFalsy();
    expect(stub.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "POST https://api.linkedin.com/rest/images?action=initializeUpload",
      "PUT https://upload.example/u1",
      "POST https://api.linkedin.com/rest/posts",
    ]);
    expect(stub.calls[0]!.body).toEqual({ initializeUploadRequest: { owner: "urn:li:person:me" } });
    expect(stub.calls[1]!.headers["content-type"]).toBe("image/png");
    expect(stub.calls[2]!.body).toMatchObject({ content: { media: { id: "urn:li:image:I1", altText: "bar chart" } } });
  });

  it("rejects non-image files before calling LinkedIn", async () => {
    const dir = await mkdtemp(join(tmpdir(), "linkedin-mcp-img-"));
    const txt = join(dir, "a.png");
    await writeFile(txt, "not an image");
    const stub = stubFetch({});
    const client = await connect(stub.fetch);
    const r = await client.callTool({ name: "create_image_post", arguments: { text: "x", image_path: txt } });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/PNG, JPEG or GIF/);
    expect(stub.calls).toHaveLength(0);
  });

  it("returns a clear error when not signed in", async () => {
    const client = await connect(stubFetch({}).fetch, false);
    const r = await client.callTool({ name: "auth_status", arguments: {} });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/auth/);
  });

  it("get_my_profile maps userinfo", async () => {
    const stub = stubFetch({ "GET https://api.linkedin.com/v2/userinfo": () => json({ sub: "me", name: "Aman Kumar", email: "a@example.com" }) });
    const client = await connect(stub.fetch);
    const r = await client.callTool({ name: "get_my_profile", arguments: {} });
    expect(JSON.parse(text(r))).toMatchObject({ personUrn: "urn:li:person:me", name: "Aman Kumar", email: "a@example.com" });
  });
});
