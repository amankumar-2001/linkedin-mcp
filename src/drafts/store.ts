import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PostSpec } from "../linkedin/publish.js";

export interface Draft {
  id: string;
  label?: string;
  spec: PostSpec;
  createdAt: string;
  updatedAt: string;
  published?: { postUrn: string; url: string; at: string };
}

interface DraftFile {
  version: 1;
  drafts: Draft[];
}

/** Post drafts kept on this machine in drafts.json (0600), next to the token. */
export class DraftStore {
  constructor(
    private readonly dir: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get path(): string {
    return join(this.dir, "drafts.json");
  }

  private async load(): Promise<DraftFile> {
    try {
      const data = JSON.parse(await readFile(this.path, "utf8")) as Partial<DraftFile>;
      return { version: 1, drafts: Array.isArray(data.drafts) ? data.drafts : [] };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, drafts: [] };
      throw new Error(`Could not read ${this.path}: ${(err as Error).message}`, { cause: err });
    }
  }

  private async save(file: DraftFile): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    // Write to a temp file and rename so a crash never leaves half-written JSON.
    const tmp = `${this.path}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(file, null, 2) + "\n", { mode: 0o600 });
    await rename(tmp, this.path);
    await chmod(this.path, 0o600);
  }

  async list(opts: { includePublished?: boolean } = {}): Promise<Draft[]> {
    const { drafts } = await this.load();
    return drafts.filter((d) => opts.includePublished || !d.published).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string): Promise<Draft> {
    const draft = (await this.load()).drafts.find((d) => d.id === id);
    if (!draft) throw new Error(`No draft with id "${id}". Use list_drafts to see your drafts.`);
    return draft;
  }

  async create(spec: PostSpec, label?: string): Promise<Draft> {
    const file = await this.load();
    const at = this.now().toISOString();
    const draft: Draft = { id: randomBytes(4).toString("hex"), label, spec, createdAt: at, updatedAt: at };
    file.drafts.push(draft);
    await this.save(file);
    return draft;
  }

  async update(id: string, patch: { spec?: PostSpec; label?: string }): Promise<Draft> {
    const file = await this.load();
    const draft = file.drafts.find((d) => d.id === id);
    if (!draft) throw new Error(`No draft with id "${id}".`);
    if (draft.published) throw new Error(`Draft "${id}" was already published as ${draft.published.postUrn}; save a new draft instead.`);
    if (patch.spec) draft.spec = patch.spec;
    if (patch.label !== undefined) draft.label = patch.label || undefined;
    draft.updatedAt = this.now().toISOString();
    await this.save(file);
    return draft;
  }

  async markPublished(id: string, post: { postUrn: string; url: string }): Promise<Draft> {
    const file = await this.load();
    const draft = file.drafts.find((d) => d.id === id);
    if (!draft) throw new Error(`No draft with id "${id}".`);
    draft.published = { ...post, at: this.now().toISOString() };
    draft.updatedAt = draft.published.at;
    await this.save(file);
    return draft;
  }

  async remove(id: string): Promise<boolean> {
    const file = await this.load();
    const before = file.drafts.length;
    file.drafts = file.drafts.filter((d) => d.id !== id);
    if (file.drafts.length === before) return false;
    await this.save(file);
    return true;
  }
}
