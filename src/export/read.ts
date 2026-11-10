import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { csvRecords } from "./csv.js";

/** Files from LinkedIn's "Get a copy of your data" export that this reader understands. */
const FILES = [
  "Profile.csv",
  "Positions.csv",
  "Education.csv",
  "Skills.csv",
  "Certifications.csv",
  "Projects.csv",
  "Languages.csv",
  "Honors.csv",
  "Courses.csv",
  "Recommendations_Received.csv",
  "Connections.csv",
] as const;
type ExportFile = (typeof FILES)[number];

export const SECTIONS = ["profile", "positions", "education", "skills", "certifications", "projects", "languages", "honors", "courses", "recommendations", "connections"] as const;
export type Section = (typeof SECTIONS)[number];

const MAX_ZIP_BYTES = 200 * 1024 * 1024;

/** Reads the CSVs we care about from an export ZIP or an unzipped export folder, matching by file name anywhere inside. */
export async function loadExportFiles(path: string): Promise<{ source: string; files: Partial<Record<ExportFile, string>> }> {
  const info = await stat(path);
  const wanted = new Set<string>(FILES);
  const files: Partial<Record<ExportFile, string>> = {};

  if (info.isDirectory()) {
    const walk = async (dir: string, depth: number): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory() && depth < 3) await walk(p, depth + 1);
        else if (entry.isFile() && wanted.has(entry.name) && !files[entry.name as ExportFile]) files[entry.name as ExportFile] = await readFile(p, "utf8");
      }
    };
    await walk(path, 0);
  } else {
    if (!/\.zip$/i.test(path)) throw new Error("Pass the LinkedIn export .zip file or the folder you unzipped it into.");
    if (info.size > MAX_ZIP_BYTES) throw new Error("That ZIP is larger than 200 MB. Unzip it and pass the folder instead.");
    const entries = unzipSync(new Uint8Array(await readFile(path)), { filter: (f) => wanted.has(basename(f.name)) });
    for (const [name, bytes] of Object.entries(entries)) {
      const key = basename(name) as ExportFile;
      if (!files[key]) files[key] = strFromU8(bytes);
    }
  }
  if (Object.keys(files).length === 0) {
    throw new Error("No LinkedIn export files found (expected Profile.csv, Positions.csv, …). Download it from LinkedIn → Settings → Data privacy → Get a copy of your data.");
  }
  return { source: path, files };
}

const pick = (r: Record<string, string>, ...keys: string[]) => {
  for (const k of keys) if (r[k]) return r[k];
  return null;
};

export interface ExportSummary {
  source: string;
  filesFound: string[];
  profile?: { firstName: string | null; lastName: string | null; headline: string | null; summary: string | null; industry: string | null; location: string | null; websites: string | null };
  positions?: Array<{ company: string | null; title: string | null; location: string | null; startedOn: string | null; finishedOn: string | null; description: string | null }>;
  education?: Array<{ school: string | null; degree: string | null; startDate: string | null; endDate: string | null; notes: string | null; activities: string | null }>;
  skills?: string[];
  certifications?: Array<{ name: string | null; authority: string | null; url: string | null; startedOn: string | null; finishedOn: string | null }>;
  projects?: Array<{ title: string | null; description: string | null; url: string | null; startedOn: string | null; finishedOn: string | null }>;
  languages?: Array<{ name: string | null; proficiency: string | null }>;
  honors?: Array<{ title: string | null; description: string | null; issuedOn: string | null }>;
  courses?: Array<{ name: string | null; number: string | null }>;
  recommendations?: { count: number; items: Array<{ from: string; company: string | null; jobTitle: string | null; text: string | null; date: string | null }> };
  connections?: {
    count: number;
    topCompanies: Array<{ company: string; count: number }>;
    list?: Array<{ name: string; company: string | null; position: string | null; connectedOn: string | null; url: string | null }>;
  };
}

/**
 * Summarizes a LinkedIn data export. Sensitive Profile.csv fields (address, birth date, zip, messenger handles)
 * are never returned; connection names are only included when `includeConnections` is true.
 */
export async function readLinkedInExport(path: string, opts: { sections?: Section[]; includeConnections?: boolean } = {}): Promise<ExportSummary> {
  const { source, files } = await loadExportFiles(path);
  const want = (s: Section) => !opts.sections?.length || opts.sections.includes(s);
  const out: ExportSummary = { source, filesFound: Object.keys(files).sort() };
  const rec = (file: ExportFile, header?: string) => (files[file] ? csvRecords(files[file]!, header) : undefined);

  const profile = want("profile") ? rec("Profile.csv", "First Name")?.[0] : undefined;
  if (profile) {
    out.profile = {
      firstName: pick(profile, "First Name"),
      lastName: pick(profile, "Last Name"),
      headline: pick(profile, "Headline"),
      summary: pick(profile, "Summary"),
      industry: pick(profile, "Industry"),
      location: pick(profile, "Geo Location", "Location"),
      websites: pick(profile, "Websites"),
    };
  }
  const positions = want("positions") ? rec("Positions.csv", "Company Name") : undefined;
  if (positions) {
    out.positions = positions.map((r) => ({
      company: pick(r, "Company Name"),
      title: pick(r, "Title"),
      location: pick(r, "Location"),
      startedOn: pick(r, "Started On"),
      finishedOn: pick(r, "Finished On"),
      description: pick(r, "Description"),
    }));
  }
  const education = want("education") ? rec("Education.csv", "School Name") : undefined;
  if (education) {
    out.education = education.map((r) => ({
      school: pick(r, "School Name"),
      degree: pick(r, "Degree Name"),
      startDate: pick(r, "Start Date"),
      endDate: pick(r, "End Date"),
      notes: pick(r, "Notes"),
      activities: pick(r, "Activities"),
    }));
  }
  const skills = want("skills") ? rec("Skills.csv", "Name") : undefined;
  if (skills) out.skills = skills.map((r) => r.Name ?? "").filter(Boolean);
  const certs = want("certifications") ? rec("Certifications.csv", "Name") : undefined;
  if (certs) {
    out.certifications = certs.map((r) => ({ name: pick(r, "Name"), authority: pick(r, "Authority"), url: pick(r, "Url", "URL"), startedOn: pick(r, "Started On"), finishedOn: pick(r, "Finished On") }));
  }
  const projects = want("projects") ? rec("Projects.csv", "Title") : undefined;
  if (projects) {
    out.projects = projects.map((r) => ({ title: pick(r, "Title"), description: pick(r, "Description"), url: pick(r, "Url", "URL"), startedOn: pick(r, "Started On"), finishedOn: pick(r, "Finished On") }));
  }
  const langs = want("languages") ? rec("Languages.csv", "Name") : undefined;
  if (langs) out.languages = langs.map((r) => ({ name: pick(r, "Name"), proficiency: pick(r, "Proficiency") }));
  const honors = want("honors") ? rec("Honors.csv", "Title") : undefined;
  if (honors) out.honors = honors.map((r) => ({ title: pick(r, "Title"), description: pick(r, "Description"), issuedOn: pick(r, "Issued On") }));
  const courses = want("courses") ? rec("Courses.csv", "Name") : undefined;
  if (courses) out.courses = courses.map((r) => ({ name: pick(r, "Name"), number: pick(r, "Number") }));
  const recs = want("recommendations") ? rec("Recommendations_Received.csv", "First Name") : undefined;
  if (recs) {
    const visible = recs.filter((r) => !r.Status || /visible/i.test(r.Status));
    out.recommendations = {
      count: visible.length,
      items: visible.map((r) => ({
        from: [r["First Name"], r["Last Name"]].filter(Boolean).join(" "),
        company: pick(r, "Company"),
        jobTitle: pick(r, "Job Title"),
        text: pick(r, "Text"),
        date: pick(r, "Creation Date"),
      })),
    };
  }
  const conns = want("connections") ? rec("Connections.csv", "First Name") : undefined;
  if (conns) {
    const byCompany = new Map<string, number>();
    for (const c of conns) if (c.Company) byCompany.set(c.Company, (byCompany.get(c.Company) ?? 0) + 1);
    out.connections = {
      count: conns.length,
      topCompanies: [...byCompany.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([company, count]) => ({ company, count })),
      ...(opts.includeConnections
        ? {
            list: conns.map((c) => ({
              name: [c["First Name"], c["Last Name"]].filter(Boolean).join(" "),
              company: pick(c, "Company"),
              position: pick(c, "Position"),
              connectedOn: pick(c, "Connected On"),
              url: pick(c, "URL"),
            })),
          }
        : {}),
    };
  }
  return out;
}
