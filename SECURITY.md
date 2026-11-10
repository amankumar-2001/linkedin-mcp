# Security

## How credentials are handled

- Your LinkedIn **client secret** is read from the environment only while `linkedin-mcp auth` runs. It is never written to disk by this tool.
- The **access token** is stored in `~/.config/linkedin-mcp/token.json` (or `$LINKEDIN_MCP_HOME`) with file mode `0600`, in a `0700` directory. It is never logged or returned by any MCP tool.
- The OAuth callback server binds to `127.0.0.1` only, accepts a single request, checks a random `state` value, and shuts down.
- The server talks only to `linkedin.com`, `api.linkedin.com`, LinkedIn's pre-signed upload URLs, and an `image_url` you explicitly pass (https only).

Run `linkedin-mcp logout` to delete the token, and revoke access any time at LinkedIn → Settings → Data privacy → Permitted services.

## Reporting a vulnerability

Please don't open a public issue. Use GitHub's **Report a vulnerability** button on the repository's Security tab, and include steps to reproduce. You'll get a reply within a few days.
