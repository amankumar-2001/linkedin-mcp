import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface StoredToken {
  accessToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  scopes: string[];
  /** urn:li:person:{sub} — the author of every post. */
  personUrn: string;
  name?: string;
  email?: string;
  createdAt: number;
}

/** Persists the access token in a single file readable only by the current user (0600). */
export class TokenStore {
  constructor(private readonly dir: string) {}

  get path(): string {
    return join(this.dir, "token.json");
  }

  async read(): Promise<StoredToken | null> {
    let raw: string;
    try {
      raw = await readFile(this.path, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
    const data = JSON.parse(raw) as Partial<StoredToken>;
    if (!data.accessToken || !data.personUrn || typeof data.expiresAt !== "number") return null;
    return {
      accessToken: data.accessToken,
      expiresAt: data.expiresAt,
      scopes: data.scopes ?? [],
      personUrn: data.personUrn,
      name: data.name,
      email: data.email,
      createdAt: data.createdAt ?? Date.now(),
    };
  }

  async write(token: StoredToken): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await writeFile(this.path, JSON.stringify(token, null, 2) + "\n", { mode: 0o600 });
    // writeFile's mode only applies on create; enforce it for an existing file too.
    await chmod(this.path, 0o600);
  }

  async clear(): Promise<boolean> {
    try {
      await rm(this.path);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw err;
    }
  }
}

export function isExpired(token: StoredToken, now = Date.now(), skewMs = 60_000): boolean {
  return token.expiresAt - skewMs <= now;
}

export function daysLeft(token: StoredToken, now = Date.now()): number {
  return Math.max(0, Math.floor((token.expiresAt - now) / 86_400_000));
}
