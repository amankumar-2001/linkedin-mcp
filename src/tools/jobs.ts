import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fetchCompanyJobs, fetchRemotive, filterJobs, sortNewestFirst, type Job } from "../jobs/boards.js";
import { EXPERIENCE, JOB_TYPES, POSTED_WITHIN, WORK_TYPES, buildJobSearchUrl } from "../jobs/linkedinLink.js";
import type { FetchLike } from "../linkedin/client.js";
import { ok, safe } from "./result.js";

const keys = <T extends object>(o: T) => Object.keys(o) as [keyof T & string, ...Array<keyof T & string>];

export function registerJobTools(server: McpServer, opts: { cacheDir: string; fetchImpl?: FetchLike }): void {
  const fetchImpl = opts.fetchImpl ?? fetch;

  server.registerTool(
    "linkedin_job_search_link",
    {
      title: "Build a LinkedIn job search link",
      description:
        "Builds a filtered LinkedIn Jobs search URL for the user to open (LinkedIn has no job-search API for members, so this tool returns a link, not listings).",
      inputSchema: {
        keywords: z.string().min(1).describe('Role or skills, e.g. "backend engineer golang".'),
        location: z.string().optional().describe('City, country or "Remote", e.g. "Bengaluru, India".'),
        posted_within: z.enum(keys(POSTED_WITHIN)).default("any"),
        work_type: z.array(z.enum(keys(WORK_TYPES))).optional().describe("onsite, remote, hybrid"),
        experience: z.array(z.enum(keys(EXPERIENCE))).optional().describe("internship, entry, associate, mid_senior, director, executive"),
        job_type: z.array(z.enum(keys(JOB_TYPES))).optional().describe("full_time, part_time, contract, temporary, internship, volunteer, other"),
        easy_apply: z.boolean().default(false),
        sort: z.enum(["relevant", "recent"]).default("recent"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    safe(async (a) => ok({ url: buildJobSearchUrl(a), note: "Open this link in your browser while signed in to LinkedIn." })),
  );

  server.registerTool(
    "search_public_jobs",
    {
      title: "Search public job boards",
      description:
        "Returns real, current job listings from companies' public job boards (Greenhouse, Lever, Ashby) and remote jobs from Remotive, filtered by keywords and location. " +
        'Pass company board slugs in `companies` (e.g. ["stripe", "lever:plaid", "ashby:notion"]); include "remotive" in `sources` for remote roles across companies. ' +
        "Listings from Remotive must be shown with their Remotive link and credited to Remotive.",
      inputSchema: {
        keywords: z.string().default("").describe('Words that must all appear in the title or department, e.g. "backend engineer".'),
        location: z.string().optional().describe('Substring to match in the job location, or "remote".'),
        remote_only: z.boolean().default(false),
        companies: z.array(z.string()).max(25).default([]).describe('Company board slugs; prefix with greenhouse:/lever:/ashby: to pick the board, otherwise all three are tried.'),
        sources: z.array(z.enum(["boards", "remotive"])).default(["boards"]).describe('"boards" = the companies you listed; "remotive" = remote jobs from Remotive (cached 6h).'),
        limit: z.number().int().min(1).max(100).default(25),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    safe(async (a) => {
      const wantBoards = a.sources.includes("boards");
      const wantRemotive = a.sources.includes("remotive");
      if (wantBoards && a.companies.length === 0 && !wantRemotive) {
        throw new Error('Pass at least one company board slug in `companies` (e.g. "stripe"), or add "remotive" to `sources`.');
      }
      const all: Job[] = [];
      const companies: Array<{ company: string; source?: string; matched: number; total: number; error?: string }> = [];
      if (wantBoards) {
        const results = await Promise.all(a.companies.map((c) => fetchCompanyJobs(fetchImpl, c)));
        for (const r of results) {
          const matched = filterJobs(r.jobs, { keywords: a.keywords, location: a.location, remoteOnly: a.remote_only });
          all.push(...matched);
          companies.push({ company: r.company, source: r.source, matched: matched.length, total: r.jobs.length, ...(r.error ? { error: r.error } : {}) });
        }
      }
      let remotive: { matched: number; cached: boolean; error?: string } | undefined;
      if (wantRemotive) {
        try {
          const r = await fetchRemotive(fetchImpl, a.keywords, opts.cacheDir);
          const matched = filterJobs(r.jobs, { keywords: a.keywords, location: a.location === "remote" ? undefined : a.location });
          all.push(...matched);
          remotive = { matched: matched.length, cached: r.cached };
        } catch (err) {
          remotive = { matched: 0, cached: false, error: (err as Error).message };
        }
      }
      const jobs = sortNewestFirst(all).slice(0, a.limit);
      return ok({
        count: jobs.length,
        totalMatched: all.length,
        jobs,
        companies,
        ...(remotive ? { remotive: { ...remotive, attribution: "Remote listings via Remotive (remotive.com) — always link to the Remotive URL." } } : {}),
        tip: "Use linkedin_job_search_link for the same search on LinkedIn Jobs.",
      });
    }),
  );
}
