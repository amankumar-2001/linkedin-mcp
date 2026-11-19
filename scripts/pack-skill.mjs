// Zip skill/linkedin-mcp/ into linkedin-mcp-skill.zip with SKILL.md at the zip root,
// ready to upload to skill marketplaces (e.g. Agensi) or copy into ~/.claude/skills/.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { URL, fileURLToPath } from "node:url";
import { log } from "node:console";
import { zipSync } from "fflate";

const root = fileURLToPath(new URL("..", import.meta.url));
const skillDir = join(root, "skill", "linkedin-mcp");
const out = join(root, "linkedin-mcp-skill.zip");

const files = {};
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files[relative(skillDir, p).split(sep).join("/")] = readFileSync(p);
  }
};
walk(skillDir);

if (!files["SKILL.md"]) throw new Error(`No SKILL.md in ${skillDir}`);
const frontmatter = files["SKILL.md"].toString("utf8").match(/^---\n([\s\S]*?)\n---\n/);
if (!frontmatter || !/^name: \S+/m.test(frontmatter[1]) || !/^description: .+/m.test(frontmatter[1])) {
  throw new Error("SKILL.md needs YAML frontmatter with name and description");
}

writeFileSync(out, zipSync(files, { level: 9 }));
log(`Wrote ${relative(root, out)} (${Object.keys(files).join(", ")})`);
