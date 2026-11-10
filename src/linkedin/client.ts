import { LINKEDIN_REST_BASE, LINKEDIN_USERINFO_URL } from "../config.js";
import { LinkedInApiError } from "../errors.js";

export type FetchLike = typeof fetch;

export interface UserInfo {
  sub: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  locale?: string | { country?: string; language?: string };
  email?: string;
  email_verified?: boolean;
}

export interface LinkedInClientOptions {
  accessToken: string;
  apiVersion: string;
  fetchImpl?: FetchLike;
}

/** Thin wrapper over LinkedIn's REST API that adds auth/version headers and turns errors into LinkedInApiError. */
export class LinkedInClient {
  private readonly fetchImpl: FetchLike;

  constructor(private readonly opts: LinkedInClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async userinfo(): Promise<UserInfo> {
    const res = await this.fetchImpl(LINKEDIN_USERINFO_URL, {
      headers: { Authorization: `Bearer ${this.opts.accessToken}` },
    });
    await ensureOk(res);
    return (await res.json()) as UserInfo;
  }

  /** Calls https://api.linkedin.com/rest{path}. */
  async rest(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.opts.accessToken}`,
      "LinkedIn-Version": this.opts.apiVersion,
      "X-Restli-Protocol-Version": "2.0.0",
      ...init.headers,
    };
    let body: string | undefined;
    if (init.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(init.body);
    }
    const res = await this.fetchImpl(`${LINKEDIN_REST_BASE}${path}`, { method: init.method ?? "GET", headers, body });
    await ensureOk(res);
    return res;
  }

  /** Uploads raw bytes to a pre-signed LinkedIn upload URL. Returns the response so callers can read the ETag. */
  async uploadBytes(uploadUrl: string, bytes: Uint8Array, contentType: string, extraHeaders: Record<string, string> = {}): Promise<Response> {
    const res = await this.fetchImpl(uploadUrl, {
      method: "PUT",
      headers: { Authorization: `Bearer ${this.opts.accessToken}`, "Content-Type": contentType, ...extraHeaders },
      body: bytes,
    });
    await ensureOk(res);
    return res;
  }
}

export async function ensureOk(res: Response): Promise<void> {
  if (res.ok) return;
  let detail = "";
  try {
    const text = await res.text();
    try {
      const json = JSON.parse(text) as { message?: string; error_description?: string; code?: string };
      detail = json.message ?? json.error_description ?? json.code ?? text;
    } catch {
      detail = text;
    }
  } catch {
    // ignore unreadable bodies
  }
  const retryAfter = Number(res.headers.get("retry-after"));
  throw new LinkedInApiError(res.status, detail.slice(0, 500), Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined);
}
