# linkedin-mcp

An [MCP](https://modelcontextprotocol.io) server for **your own LinkedIn account**. Connect it to Claude (or any MCP client) to read your profile and publish text, link and image posts — using LinkedIn's official API.

- **Bring your own LinkedIn app.** You create a free developer app; nobody else ever sees your credentials.
- **Your token stays on your machine** in `~/.config/linkedin-mcp/token.json` (permissions `0600`).
- **Nothing is posted without you.** Write tools are marked as such, so MCP clients ask before running them, and `preview_post` shows the exact payload first.

## Tools

| Tool | What it does |
|---|---|
| `auth_status` | Connected account, granted scopes, days until the token expires |
| `get_my_profile` | Your id, name, photo, email and locale |
| `preview_post` | Shows exactly what would be sent for a text, link or image post — publishes nothing |
| `create_text_post` | Publish a text post (`PUBLIC` or `CONNECTIONS`) |
| `create_link_post` | Publish a post with a link card (title, description, optional thumbnail) |
| `create_image_post` | Upload a PNG/JPEG/GIF (local file or https URL) and publish it |
| `delete_post` | Delete one of your posts by URN |

> **What it can't do:** LinkedIn only lets approved partners edit profile sections (headline, About, experience, skills) or read your feed, messages and connections. This server sticks to what LinkedIn allows for self-serve apps, and does not scrape or automate the website.

## Setup

### 1. Create a LinkedIn app (5 minutes, once)

1. Go to [linkedin.com/developers/apps](https://www.linkedin.com/developers/apps) → **Create app**. LinkedIn requires a Company Page to attach the app to — any page you admin works (you can create one for yourself).
2. **Products** tab → add **Sign In with LinkedIn using OpenID Connect** and **Share on LinkedIn**.
3. **Auth** tab → under *Authorized redirect URLs* add:
   ```
   http://127.0.0.1:8765/callback
   ```
4. Copy the **Client ID** and **Primary Client Secret** from the Auth tab.

### 2. Sign in

```bash
LINKEDIN_CLIENT_ID=your_id LINKEDIN_CLIENT_SECRET=your_secret npx -y github:amankumar-2001/linkedin-mcp auth
```

Your browser opens LinkedIn's consent page. After you approve, the token is saved locally. Check it any time:

```bash
npx -y github:amankumar-2001/linkedin-mcp status
```

LinkedIn tokens for self-serve apps last **about 60 days** and can't be refreshed automatically — run `auth` again when `status` says it has expired.

### 3. Add it to your MCP client

**Claude Code**

```bash
claude mcp add linkedin -- npx -y github:amankumar-2001/linkedin-mcp
```

**Claude Desktop** — add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "linkedin": {
      "command": "npx",
      "args": ["-y", "github:amankumar-2001/linkedin-mcp"]
    }
  }
}
```

**Any other MCP client:** run `npx -y github:amankumar-2001/linkedin-mcp` as a stdio server.

The server itself only needs the saved token; the client ID/secret are used only by `auth`.

Then try: *"What's my LinkedIn auth status?"* or *"Draft a LinkedIn post announcing my new project and show me a preview."*

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` | — | Your app's credentials (only for `auth`) |
| `LINKEDIN_API_VERSION` | `202610` | `LinkedIn-Version` header (YYYYMM). LinkedIn retires versions after ~12 months; bump this if you get a 426 error. |
| `LINKEDIN_REDIRECT_PORT` | `8765` | Local callback port. Change the redirect URL on your app to match. |
| `LINKEDIN_MCP_HOME` | `~/.config/linkedin-mcp` | Where `token.json` lives |

CLI: `linkedin-mcp [serve|auth|status|logout|--help|--version]`.

## Notes

- **Link posts:** LinkedIn's API doesn't fetch page previews, so you supply the card `title` (and optionally `description` and a thumbnail).
- **Formatting:** post text is escaped for LinkedIn's "little" text format, so characters like `(`, `[`, `@` and `*` appear literally instead of truncating your post. `#hashtags` stay clickable.
- **Rate limits:** LinkedIn applies daily per-member limits; a 429 error includes the retry delay when LinkedIn sends one.
- Follow LinkedIn's [API Terms of Use](https://www.linkedin.com/legal/l/api-terms-of-use) and [Professional Community Policies](https://www.linkedin.com/legal/professional-community-policies) — you're responsible for what you post.

## Development

```bash
git clone https://github.com/amankumar-2001/linkedin-mcp && cd linkedin-mcp
npm install          # also builds dist/
npm test             # unit + MCP protocol tests, no network
npm run inspect      # open the MCP Inspector against the local build
```

See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues: [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © Aman Kumar
