import type { FetchLike } from "../src/linkedin/client.js";

export interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

type Route = (req: Recorded) => Response | Promise<Response>;

/** A tiny fetch stub: routes by "METHOD url-prefix" and records every request. */
export function stubFetch(routes: Record<string, Route>): { fetch: FetchLike; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = input instanceof Request ? input.url : input.toString();
    const method = (init.method ?? "GET").toUpperCase();
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    let body: unknown = init.body;
    if (typeof init.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    } else if (init.body instanceof URLSearchParams) {
      body = Object.fromEntries(init.body.entries());
    }
    const req = { url, method, headers, body };
    calls.push(req);
    const key = Object.keys(routes).find((k) => {
      const [m, prefix] = k.split(" ") as [string, string];
      return m === method && url.startsWith(prefix);
    });
    if (!key) return new Response(`no route for ${method} ${url}`, { status: 599 });
    return routes[key]!(req);
  }) as FetchLike;
  return { fetch: fetchImpl, calls };
}

export const json = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" }, ...init });
