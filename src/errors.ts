/** Raised when there is no usable access token. The message tells the user how to fix it. */
export class NotAuthenticatedError extends Error {
  constructor(message = "Not signed in to LinkedIn. Run `npx -y github:amankumar-2001/linkedin-mcp auth` in a terminal.") {
    super(message);
    this.name = "NotAuthenticatedError";
  }
}

/** A non-2xx response from the LinkedIn API, with a human-readable hint where we have one. */
export class LinkedInApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(LinkedInApiError.describe(status, detail, retryAfterSeconds));
    this.name = "LinkedInApiError";
  }

  private static describe(status: number, detail: string, retryAfter?: number): string {
    const hint =
      status === 401
        ? "Your LinkedIn token is invalid or expired. Run the `auth` command again."
        : status === 403
          ? "LinkedIn refused this action. Check that your app has the \"Share on LinkedIn\" product and that you granted the w_member_social scope."
          : status === 429
            ? `LinkedIn rate limit reached${retryAfter ? `; retry in ${retryAfter}s` : ""}.`
            : status === 426
              ? "The LinkedIn-Version is no longer supported. Set LINKEDIN_API_VERSION to a newer YYYYMM value."
              : undefined;
    return [`LinkedIn API error ${status}`, detail && `: ${detail}`, hint && ` — ${hint}`].filter(Boolean).join("");
  }
}
