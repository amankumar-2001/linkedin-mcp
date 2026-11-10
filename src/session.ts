import { TokenStore, isExpired, type StoredToken } from "./auth/tokenStore.js";
import type { Config } from "./config.js";
import { NotAuthenticatedError } from "./errors.js";
import { LinkedInClient, type FetchLike } from "./linkedin/client.js";

export interface Session {
  token: StoredToken;
  client: LinkedInClient;
}

export type SessionLoader = () => Promise<Session>;

/** Loads the saved token for each tool call, so re-running `auth` takes effect without restarting the server. */
export function createSessionLoader(config: Config, fetchImpl?: FetchLike): SessionLoader {
  const store = new TokenStore(config.home);
  return async () => {
    const token = await store.read();
    if (!token) throw new NotAuthenticatedError();
    if (isExpired(token)) {
      throw new NotAuthenticatedError("Your LinkedIn token has expired (they last ~60 days). Run the `auth` command again to sign in.");
    }
    return { token, client: new LinkedInClient({ accessToken: token.accessToken, apiVersion: config.apiVersion, fetchImpl }) };
  };
}
