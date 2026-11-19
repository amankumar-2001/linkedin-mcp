import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { parseCsv, csvRecords } from "../src/export/csv.js";
import { readLinkedInExport } from "../src/export/read.js";
import { fetchCompanyJobs, fetchRemotive, filterJobs } from "../src/jobs/boards.js";
import { buildJobSearchUrl } from "../src/jobs/linkedinLink.js";
import { LinkedInClient, type FetchLike } from "../src/linkedin/client.js";
import { createServer } from "../src/server.js";
import type { Session } from "../src/session.js";
import { json, stubFetch } from "./helpers.js";

const token = { accessToken: "AT", expiresAt: Date.now() + 1e9, scopes: ["w_member_social"], personUrn: "urn:li:person:me", createdAt: 0 };

async function connect(fetchImpl: FetchLike) {
  const dataDir = await mkdtemp(join(tmpdir(), "limcp-f-"));
  const getSession = async (): Promise<Session> => ({ token, client: new LinkedInClient({ accessToken: "AT", apiVersion: "202610", fetchImpl }) });
  const server = createServer({ version: "test", getSession, fetchImpl, dataDir });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    const txt = (r.content as Array<{ text: string }>)[0]!.text;
    return { isError: Boolean(r.isError), text: txt, data: r.isError ? undefined : JSON.parse(txt) };
  };
  return { client, call, dataDir };
}

describe("drafts", () => {
  it("saves, updates, publishes once and deletes a draft", async () => {
    const stub = stubFetch({ "POST https://api.linkedin.com/rest/posts": () => new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:share:42" } }) });
    const { call, dataDir } = await connect(stub.fetch);

    const saved = await call("save_draft", { kind: "poll", text: "Which DB?", question: "Pick one", options: ["Postgres", "Mongo"], label: "db poll" });
    expect(saved.isError).toBe(false);
    const id = saved.data.draft.id as string;
    expect((await stat(join(dataDir, "drafts.json"))).mode & 0o777).toBe(0o600);

    const bad = await call("save_draft", { kind: "poll", text: "x", question: "q", options: ["only one"] });
    expect(bad.isError).toBe(true);

    const updated = await call("update_draft", { id, options: ["Postgres", "Mongo", "MySQL"] });
    expect(updated.data.draft.spec).toMatchObject({ kind: "poll", text: "Which DB?", visibility: "PUBLIC", options: ["Postgres", "Mongo", "MySQL"] });

    const listed = await call("list_drafts");
    expect(listed.data.drafts).toHaveLength(1);
    expect(listed.data.drafts[0]).toMatchObject({ id, label: "db poll", kind: "poll" });

    const pub = await call("publish_draft", { id });
    expect(pub.data).toMatchObject({ published: true, postUrn: "urn:li:share:42" });
    expect(stub.calls[0]!.body).toMatchObject({ content: { poll: { question: "Pick one" } } });

    const again = await call("publish_draft", { id });
    expect(again.isError).toBe(true);
    expect(again.text).toMatch(/already published/);
    expect((await call("list_drafts")).data.count).toBe(0);
    expect((await call("list_drafts", { include_published: true })).data.count).toBe(1);

    expect((await call("delete_draft", { id })).data.deleted).toBe(true);
    expect(JSON.parse(await readFile(join(dataDir, "drafts.json"), "utf8")).drafts).toHaveLength(0);
  });
});

describe("jobs", () => {
  it("builds a filtered LinkedIn jobs URL", () => {
    const url = new URL(
      buildJobSearchUrl({ keywords: "backend engineer", location: "Bengaluru, India", posted_within: "week", work_type: ["remote", "hybrid"], experience: ["mid_senior"], job_type: ["full_time"], easy_apply: true, sort: "recent" }),
    );
    expect(url.origin + url.pathname).toBe("https://www.linkedin.com/jobs/search/");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      keywords: "backend engineer",
      location: "Bengaluru, India",
      f_TPR: "r604800",
      f_WT: "2,3",
      f_E: "4",
      f_JT: "F",
      f_AL: "true",
      sortBy: "DD",
    });
  });

  it("normalizes Greenhouse/Lever/Ashby boards and falls through on 404", async () => {
    const stub = stubFetch({
      "GET https://boards-api.greenhouse.io/v1/boards/acme/jobs": () =>
        json({ jobs: [{ title: "Senior Backend Engineer", absolute_url: "https://acme.com/j/1", location: { name: "Remote - India" }, first_published: "2026-11-01T00:00:00Z", company_name: "Acme" }] }),
      "GET https://boards-api.greenhouse.io/v1/boards/plaid/jobs": () => new Response("{}", { status: 404 }),
      "GET https://api.lever.co/v0/postings/plaid": () =>
        json([{ text: "Backend Engineer, Payments", hostedUrl: "https://jobs.lever.co/plaid/1", createdAt: 1788199939703, workplaceType: "onsite", categories: { location: "San Francisco", commitment: "Full-time", team: "Payments" } }]),
      "GET https://api.ashbyhq.com/posting-api/job-board/notion": () =>
        json({ jobs: [{ title: "Product Designer", jobUrl: "https://jobs.ashbyhq.com/notion/1", location: "NYC", isRemote: false, publishedAt: "2026-10-01T00:00:00Z", isListed: true }] }),
    });
    const acme = await fetchCompanyJobs(stub.fetch, "acme");
    expect(acme).toMatchObject({ source: "greenhouse", jobs: [{ company: "Acme", remote: true, url: "https://acme.com/j/1" }] });
    const plaid = await fetchCompanyJobs(stub.fetch, "plaid");
    expect(plaid).toMatchObject({ source: "lever", jobs: [{ title: "Backend Engineer, Payments", employmentType: "Full-time", department: "Payments" }] });
    const notion = await fetchCompanyJobs(stub.fetch, "ashby:notion");
    expect(notion.jobs[0]).toMatchObject({ source: "ashby", title: "Product Designer" });
    expect(filterJobs([...acme.jobs, ...plaid.jobs, ...notion.jobs], { keywords: "backend engineer" })).toHaveLength(2);
    expect(filterJobs([...acme.jobs, ...plaid.jobs], { keywords: "backend", location: "remote" })).toHaveLength(1);
  });

  it("reports unknown boards instead of failing the whole search", async () => {
    const stub = stubFetch({});
    const { call } = await connect(stub.fetch);
    const r = await call("search_public_jobs", { companies: ["nope"], keywords: "x" });
    expect(r.isError).toBe(false);
    expect(r.data.companies[0].error).toMatch(/599|no public/);
  });

  it("caches Remotive results on disk so we stay within its request limits", async () => {
    let hits = 0;
    const stub = stubFetch({
      "GET https://remotive.com/api/remote-jobs": () => {
        hits++;
        return json({
          jobs: [
            { title: "Go Developer", company_name: "Remote Co", candidate_required_location: "Worldwide", url: "https://remotive.com/remote-jobs/1", publication_date: "2026-11-08T21:47:58", job_type: "full_time" },
            { title: "Senior Back-end Developer", company_name: "Other Co", url: "https://remotive.com/remote-jobs/2", tags: ["C#", "golang"] },
          ],
        });
      },
    });
    const dir = await mkdtemp(join(tmpdir(), "limcp-r-"));
    const first = await fetchRemotive(stub.fetch, "Go", dir, 1_000);
    const second = await fetchRemotive(stub.fetch, "go ", dir, 2_000);
    const later = await fetchRemotive(stub.fetch, "go", dir, 1_000 + 7 * 3600_000);
    expect([first.cached, second.cached, later.cached]).toEqual([false, true, false]);
    expect(hits).toBe(2);
    expect(first.jobs[0]).toMatchObject({ source: "remotive", remote: true, url: "https://remotive.com/remote-jobs/1" });
    expect(filterJobs(first.jobs, { keywords: "golang" }).map((j) => j.title)).toEqual(["Senior Back-end Developer"]);
  });
});

describe("LinkedIn data export", () => {
  it("parses quoted CSV with embedded commas, quotes and newlines", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","he said ""hi""\nthere"\n')).toEqual([["a", "b"], ["x, y", 'he said "hi"\nthere']]);
    expect(csvRecords("Notes:\n\"Some note, with comma\"\n\nFirst Name,Last Name\nAsha,Rao\n", "First Name")).toEqual([{ "First Name": "Asha", "Last Name": "Rao" }]);
  });

  it("summarizes an export ZIP and never returns sensitive profile fields", async () => {
    const zip = zipSync({
      "Profile.csv": strToU8('First Name,Last Name,Maiden Name,Address,Birth Date,Headline,Summary,Industry,Zip Code,Geo Location,Twitter Handles,Websites,Instant Messengers\nTest,User,,"1 Secret St",Jan 1 2000,Backend Engineer,"Builds APIs, loves Go",Software Development,123456,"Bengaluru, India",,,\n'),
      "Positions.csv": strToU8('Company Name,Title,Description,Location,Started On,Finished On\nAcme,SDE-1,"Built payments, v2",Bengaluru,Apr 2025,\nBeta,SDE-1,,Gurugram,Apr 2024,Apr 2025\n'),
      "Skills.csv": strToU8("Name\nGo\nTypeScript\n"),
      "nested/Education.csv": strToU8("School Name,Start Date,End Date,Notes,Degree Name,Activities\nIET,2020,2024,,B.Tech,\n"),
      "Connections.csv": strToU8("Notes:\n\"When exporting your connection data, you may notice that some of the email addresses are missing.\"\n\nFirst Name,Last Name,URL,Email Address,Company,Position,Connected On\nA,One,u1,,Acme,SDE,01 Jan 2026\nB,Two,u2,,Acme,PM,02 Jan 2026\nC,Three,u3,,Beta,SDE,03 Jan 2026\n"),
      "Ignored.txt": strToU8("x"),
    });
    const dir = await mkdtemp(join(tmpdir(), "limcp-x-"));
    const file = join(dir, "export.zip");
    await writeFile(file, zip);

    const s = await readLinkedInExport(file);
    expect(s.filesFound).toEqual(["Connections.csv", "Education.csv", "Positions.csv", "Profile.csv", "Skills.csv"]);
    expect(s.profile).toEqual({ firstName: "Test", lastName: "User", headline: "Backend Engineer", summary: "Builds APIs, loves Go", industry: "Software Development", location: "Bengaluru, India", websites: null });
    expect(JSON.stringify(s)).not.toMatch(/Secret|Jan 1 2000|123456/);
    expect(s.positions?.[0]).toMatchObject({ company: "Acme", description: "Built payments, v2", finishedOn: null });
    expect(s.skills).toEqual(["Go", "TypeScript"]);
    expect(s.education?.[0]).toMatchObject({ school: "IET", degree: "B.Tech" });
    expect(s.connections).toEqual({ count: 3, topCompanies: [{ company: "Acme", count: 2 }, { company: "Beta", count: 1 }] });

    const withList = await readLinkedInExport(file, { sections: ["connections"], includeConnections: true });
    expect(Object.keys(withList)).toEqual(["source", "filesFound", "connections"]);
    expect(withList.connections?.list?.[0]).toMatchObject({ name: "A One", company: "Acme" });
  });

  it("explains how to get the export when the path has none", async () => {
    const dir = await mkdtemp(join(tmpdir(), "limcp-e-"));
    await expect(readLinkedInExport(dir)).rejects.toThrow(/Get a copy of your data/);
  });
});

describe("tool catalogue", () => {
  it("exposes all 21 tools", async () => {
    const { client } = await connect(stubFetch({}).fetch);
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(21);
    for (const t of tools) expect(t.description?.length ?? 0).toBeGreaterThan(30);
  });
});
