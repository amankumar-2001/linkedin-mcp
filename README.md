# linkedin-mcp

An [MCP](https://modelcontextprotocol.io) server for **your own LinkedIn account**. Connect it to Claude (or any MCP client) to publish every kind of post LinkedIn's API allows, keep drafts, search for jobs, and read your full profile from your LinkedIn data export.

- **Bring your own LinkedIn app.** You create a free developer app; nobody else ever sees your credentials.
- **Everything stays on your machine** — token, drafts and caches live in `~/.config/linkedin-mcp/` (files are `0600`).
- **Nothing is posted without you.** Write tools are marked as such, so MCP clients ask before running them, and `preview_post` shows the exact payload first.
- **No scraping.** It uses LinkedIn's official API, public job-board APIs, and the export file LinkedIn gives you.

## Tools (21)

**Account**

| Tool | What it does |
|---|---|
| `auth_status` | Connected account, granted scopes, days until the token expires |
| `get_my_profile` | Your id, name, photo, email and locale (all LinkedIn's API shares) |
| `read_linkedin_export` | Your **full profile** — headline, summary, positions, education, skills, certifications, projects, languages, honors, courses, recommendations, connections summary — read locally from LinkedIn's data export |

**Posting** — all accept `visibility` (`PUBLIC` / `CONNECTIONS`), `#hashtags` and `@[Name](urn:li:person:…)` mentions

| Tool | What it does |
|---|---|
| `preview_post` | Shows exactly what would be sent for any post kind — publishes and uploads nothing |
| `create_text_post` | Text post (up to 3,000 characters) |
| `create_link_post` | Link card with title, description and optional thumbnail |
| `create_image_post` | One PNG/JPEG/GIF (local file or https URL) |
| `create_multi_image_post` | 2–20 images in one post |
| `create_video_post` | MP4, 3 s–30 min, up to 500 MB (multipart upload, waits for processing) |
| `create_document_post` | PDF/PPT/PPTX/DOC/DOCX shown as a swipeable carousel (≤100 MB, ≤300 pages) |
| `create_poll_post` | Poll with 2–4 options, open 1/3/7/14 days |
| `reshare_post` | Reshare a post (URN or linkedin.com link) with your own text |
| `edit_post` | Change the text of one of your posts |
| `delete_post` | Delete one of your posts |

**Drafts** (local, in `drafts.json`)

| Tool | What it does |
|---|---|
| `save_draft` / `update_draft` / `delete_draft` | Keep any kind of post as a draft and refine it |
| `list_drafts` | Your drafts, newest first |
| `publish_draft` | Publish a draft exactly as saved (once, unless you allow a repost) |

**Jobs** (no LinkedIn API exists for this; see [Jobs](#jobs))

| Tool | What it does |
|---|---|
| `linkedin_job_search_link` | A filtered LinkedIn Jobs search URL (keywords, location, date posted, remote/hybrid/on-site, experience level, job type, Easy Apply) |
| `search_public_jobs` | Real listings from company job boards (Greenhouse, Lever, Ashby) and remote jobs from Remotive |

> **What it can't do:** LinkedIn only lets approved partners edit profile sections (headline, About, experience, skills), read your feed, messages or connections, search jobs, or comment/react. This server sticks to what LinkedIn allows for self-serve apps and does not scrape or automate the website.

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

## Jobs

LinkedIn has no job-search API for members, so jobs come from two legitimate places:

- **`linkedin_job_search_link`** builds the same URL LinkedIn's own filters produce, e.g. *"backend engineer, Bengaluru, past week, remote or hybrid"*. Open it while signed in.
- **`search_public_jobs`** calls public job-board APIs that companies publish:
  - **Greenhouse, Lever, Ashby** — pass company board slugs, e.g. `["stripe", "lever:plaid", "ashby:notion"]`. A bare slug is tried on all three. The slug is the name in the company's careers URL (`boards.greenhouse.io/stripe`, `jobs.lever.co/plaid`, `jobs.ashbyhq.com/notion`).
  - **Remotive** — add `"remotive"` to `sources` for remote roles. Remotive's feed is delayed 24 h and asks for at most ~4 requests a day, so results are cached for 6 hours; always credit Remotive and link to its listing.

Keywords must all appear in the job title, department or tags; `location` matches the job's location text, or use `"remote"`.

## Full profile from your LinkedIn export

1. LinkedIn → **Settings → Data privacy → Get a copy of your data**. Pick *"Download larger data archive"* (or at least Profile, Positions, Education, Skills, Connections) and request it.
2. LinkedIn emails a link (usually within minutes for the basic archive, up to 24 h for the full one). Download the ZIP.
3. Ask: *"Read my LinkedIn export at ~/Downloads/Basic_LinkedInDataExport_….zip"*.

The file is read locally and never uploaded. Address, birth date and similar fields are never returned, and connection names are only included if you pass `include_connections: true`.

## Notes

- **Link posts:** LinkedIn's API doesn't fetch page previews, so you supply the card `title` (and optionally `description` and a thumbnail).
- **Mentions:** write `@[Bloom Health](urn:li:organization:123)` or `@[Name](urn:li:person:abc)`. The display text must match the name on LinkedIn. There's no API to look up someone's URN, so you need to know it.
- **Videos/documents** are uploaded, then the server waits (up to 5 minutes) for LinkedIn to finish processing before posting. If processing takes longer, nothing is posted and you can retry.
- **Edit/delete** need the post URN returned when the post was created (`urn:li:share:…`); feed links contain an activity id, which works for resharing only.
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
