import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FetchLike } from "../linkedin/client.js";

export type JobSource = "greenhouse" | "lever" | "ashby" | "remotive";
export const BOARD_SOURCES = ["greenhouse", "lever", "ashby"] as const;

export interface Job {
  title: string;
  company: string;
  location: string;
  remote: boolean;
  url: string;
  postedAt: string | null;
  department: string | null;
  employmentType: string | null;
  /** Skill tags (Remotive provides these; boards don't). Used for keyword matching. */
  tags?: string[];
  source: JobSource;
}

const REMOTE = /\bremote\b|anywhere|worldwide/i;
const iso = (v: unknown): string | null => {
  if (v === undefined || v === null || v === "") return null;
  const d = new Date(typeof v === "number" ? v : String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

export class BoardNotFoundError extends Error {}

async function getJson(fetchImpl: FetchLike, url: string): Promise<unknown> {
  const res = await fetchImpl(url, { headers: { Accept: "application/json", "User-Agent": "linkedin-mcp (+https://github.com/amankumar-2001/linkedin-mcp)" } });
  if (res.status === 404) throw new BoardNotFoundError(`not found (${url})`);
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
  return res.json();
}

/** Greenhouse Job Board API: https://developers.greenhouse.io/job-board.html */
async function greenhouse(fetchImpl: FetchLike, slug: string): Promise<Job[]> {
  const data = (await getJson(fetchImpl, `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs`)) as {
    jobs?: Array<{ title: string; absolute_url: string; location?: { name?: string }; updated_at?: string; first_published?: string; company_name?: string; departments?: Array<{ name: string }> }>;
  };
  return (data.jobs ?? []).map((j) => {
    const location = j.location?.name ?? "";
    return {
      title: j.title,
      company: j.company_name ?? slug,
      location,
      remote: REMOTE.test(location),
      url: j.absolute_url,
      postedAt: iso(j.first_published ?? j.updated_at),
      department: j.departments?.[0]?.name ?? null,
      employmentType: null,
      source: "greenhouse" as const,
    };
  });
}

/** Lever Postings API: https://github.com/lever/postings-api */
async function lever(fetchImpl: FetchLike, slug: string): Promise<Job[]> {
  const data = (await getJson(fetchImpl, `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`)) as
    | Array<{ text: string; hostedUrl: string; createdAt?: number; workplaceType?: string; categories?: { location?: string; commitment?: string; department?: string; team?: string } }>
    | { ok?: boolean };
  if (!Array.isArray(data)) throw new BoardNotFoundError(`not found (lever:${slug})`);
  return data.map((j) => {
    const location = j.categories?.location ?? "";
    return {
      title: j.text,
      company: slug,
      location,
      remote: j.workplaceType === "remote" || REMOTE.test(location),
      url: j.hostedUrl,
      postedAt: iso(j.createdAt),
      department: j.categories?.department ?? j.categories?.team ?? null,
      employmentType: j.categories?.commitment ?? null,
      source: "lever" as const,
    };
  });
}

/** Ashby public job board API: https://developers.ashbyhq.com/docs/public-job-posting-api */
async function ashby(fetchImpl: FetchLike, slug: string): Promise<Job[]> {
  const data = (await getJson(fetchImpl, `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`)) as {
    jobs?: Array<{ title: string; jobUrl: string; location?: string; isRemote?: boolean; workplaceType?: string; publishedAt?: string; department?: string; employmentType?: string; isListed?: boolean }>;
  };
  return (data.jobs ?? [])
    .filter((j) => j.isListed !== false)
    .map((j) => ({
      title: j.title,
      company: slug,
      location: j.location ?? "",
      remote: Boolean(j.isRemote) || j.workplaceType === "Remote",
      url: j.jobUrl,
      postedAt: iso(j.publishedAt),
      department: j.department ?? null,
      employmentType: j.employmentType ?? null,
      source: "ashby" as const,
    }));
}

const FETCHERS = { greenhouse, lever, ashby } as const;

export interface CompanyResult {
  company: string;
  source?: JobSource;
  jobs: Job[];
  error?: string;
}

/**
 * Fetches one company's board. `company` is a board slug ("stripe") or "source:slug" ("lever:plaid").
 * A bare slug is tried on Greenhouse, then Lever, then Ashby.
 */
export async function fetchCompanyJobs(fetchImpl: FetchLike, company: string): Promise<CompanyResult> {
  const [maybeSource, maybeSlug] = company.includes(":") ? company.split(":", 2) : [undefined, company];
  const slug = (maybeSlug ?? "").trim().toLowerCase();
  if (!slug) return { company, jobs: [], error: "empty company slug" };
  const sources = maybeSource ? [maybeSource as (typeof BOARD_SOURCES)[number]] : [...BOARD_SOURCES];
  for (const source of sources) {
    const fetcher = FETCHERS[source];
    if (!fetcher) return { company, jobs: [], error: `unknown source "${source}" (use greenhouse, lever or ashby)` };
    try {
      return { company: slug, source, jobs: await fetcher(fetchImpl, slug) };
    } catch (err) {
      if (err instanceof BoardNotFoundError && sources.length > 1) continue;
      return { company: slug, source, jobs: [], error: err instanceof BoardNotFoundError ? `no ${source} board named "${slug}"` : (err as Error).message };
    }
  }
  return { company: slug, jobs: [], error: `no public Greenhouse, Lever or Ashby board named "${slug}"` };
}

const REMOTIVE_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Remotive public API (remote jobs). Remotive asks for at most ~4 requests a day and a link back,
 * so results are cached on disk for 6 hours per search and every job keeps its Remotive URL.
 */
export async function fetchRemotive(fetchImpl: FetchLike, search: string, cacheDir: string, now = Date.now()): Promise<{ jobs: Job[]; cached: boolean }> {
  const key = createHash("sha1").update(search.toLowerCase().trim()).digest("hex").slice(0, 16);
  const file = join(cacheDir, "cache", `remotive-v2-${key}.json`);
  try {
    const cached = JSON.parse(await readFile(file, "utf8")) as { at: number; jobs: Job[] };
    if (now - cached.at < REMOTIVE_TTL_MS) return { jobs: cached.jobs, cached: true };
  } catch {
    // no cache yet
  }
  const url = new URL("https://remotive.com/api/remote-jobs");
  if (search.trim()) url.searchParams.set("search", search.trim());
  const data = (await getJson(fetchImpl, url.toString())) as {
    jobs?: Array<{ title: string; company_name: string; candidate_required_location?: string; url: string; publication_date?: string; job_type?: string; category?: string; tags?: string[] }>;
  };
  const jobs: Job[] = (data.jobs ?? []).map((j) => ({
    tags: Array.isArray(j.tags) ? j.tags : [],
    title: j.title,
    company: j.company_name,
    location: j.candidate_required_location || "Remote",
    remote: true,
    url: j.url,
    postedAt: iso(j.publication_date),
    department: j.category ?? null,
    employmentType: j.job_type ?? null,
    source: "remotive" as const,
  }));
  await mkdir(join(cacheDir, "cache"), { recursive: true, mode: 0o700 });
  await writeFile(file, JSON.stringify({ at: now, jobs }), { mode: 0o600 });
  return { jobs, cached: false };
}

/** Keeps jobs whose title/department/tags contain every keyword and whose location matches (or is remote, if asked). */
export function filterJobs(jobs: Job[], opts: { keywords?: string; location?: string; remoteOnly?: boolean }): Job[] {
  const words = (opts.keywords ?? "").toLowerCase().split(/[\s,]+/).filter(Boolean);
  const loc = opts.location?.toLowerCase().trim();
  return jobs.filter((j) => {
    const tags = (j.tags ?? []).map((t) => t.toLowerCase());
    const hay = `${j.title} ${j.department ?? ""}`.toLowerCase();
    if (!words.every((w) => hay.includes(w) || tags.includes(w))) return false;
    if (opts.remoteOnly && !j.remote) return false;
    if (loc && !(j.location.toLowerCase().includes(loc) || (loc === "remote" && j.remote))) return false;
    return true;
  });
}

export function sortNewestFirst(jobs: Job[]): Job[] {
  return [...jobs].sort((a, b) => (b.postedAt ?? "").localeCompare(a.postedAt ?? ""));
}
