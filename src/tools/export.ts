import { homedir } from "node:os";
import { resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SECTIONS, readLinkedInExport } from "../export/read.js";
import { ok, safe } from "./result.js";

const expand = (p: string) => (p === "~" ? homedir() : p.startsWith("~/") ? resolve(homedir(), p.slice(2)) : resolve(p));

export function registerExportTools(server: McpServer): void {
  server.registerTool(
    "read_linkedin_export",
    {
      title: "Read my full LinkedIn profile from my data export",
      description:
        "Reads the user's LinkedIn data export (LinkedIn → Settings → Data privacy → Get a copy of your data) from a local .zip or unzipped folder and returns their full profile: " +
        "headline, summary, positions, education, skills, certifications, projects, languages, honors, courses, recommendations and a connections summary. " +
        "Everything is read locally; nothing is uploaded. Address, birth date and similar fields are never returned.",
      inputSchema: {
        path: z.string().describe("Path to the export .zip (e.g. ~/Downloads/Basic_LinkedInDataExport_11-10-2026.zip) or the unzipped folder."),
        sections: z.array(z.enum(SECTIONS)).optional().describe("Only return these sections (default: all found)."),
        include_connections: z.boolean().default(false).describe("Also return the full list of connections (names, companies). Off by default for privacy."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    safe(async (a) => ok({ ...(await readLinkedInExport(expand(a.path), { sections: a.sections, includeConnections: a.include_connections })) })),
  );
}
