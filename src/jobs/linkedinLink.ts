/** Builds a LinkedIn Jobs search URL. No API call — the user opens it in their browser. */

export const POSTED_WITHIN = { any: undefined, day: "r86400", week: "r604800", month: "r2592000" } as const;
export const WORK_TYPES = { onsite: "1", remote: "2", hybrid: "3" } as const;
export const EXPERIENCE = { internship: "1", entry: "2", associate: "3", mid_senior: "4", director: "5", executive: "6" } as const;
export const JOB_TYPES = { full_time: "F", part_time: "P", contract: "C", temporary: "T", internship: "I", volunteer: "V", other: "O" } as const;

export interface JobSearchLinkInput {
  keywords: string;
  location?: string;
  posted_within?: keyof typeof POSTED_WITHIN;
  work_type?: Array<keyof typeof WORK_TYPES>;
  experience?: Array<keyof typeof EXPERIENCE>;
  job_type?: Array<keyof typeof JOB_TYPES>;
  easy_apply?: boolean;
  sort?: "relevant" | "recent";
}

export function buildJobSearchUrl(input: JobSearchLinkInput): string {
  const url = new URL("https://www.linkedin.com/jobs/search/");
  const p = url.searchParams;
  p.set("keywords", input.keywords.trim());
  if (input.location?.trim()) p.set("location", input.location.trim());
  const tpr = POSTED_WITHIN[input.posted_within ?? "any"];
  if (tpr) p.set("f_TPR", tpr);
  const join = <T extends Record<string, string>>(map: T, keys?: Array<keyof T>) =>
    keys?.length ? [...new Set(keys.map((k) => map[k]))].join(",") : undefined;
  const wt = join(WORK_TYPES, input.work_type);
  if (wt) p.set("f_WT", wt);
  const e = join(EXPERIENCE, input.experience);
  if (e) p.set("f_E", e);
  const jt = join(JOB_TYPES, input.job_type);
  if (jt) p.set("f_JT", jt);
  if (input.easy_apply) p.set("f_AL", "true");
  if (input.sort === "recent") p.set("sortBy", "DD");
  return url.toString();
}
