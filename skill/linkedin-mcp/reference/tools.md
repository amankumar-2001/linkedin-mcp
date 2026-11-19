# linkedin-mcp tool reference

All 21 tools, with parameters as the server declares them. "R" marks a read-only tool. "W" marks a tool that changes LinkedIn or local drafts; follow the confirm-first rule in SKILL.md for those.

## Shared post fields

| Field | Type | Notes |
|---|---|---|
| `text` | string ≤ 3,000 | Required for text, link, image and poll posts; optional for others. `#hashtags` stay clickable. Mentions use `@[Name](urn:li:person:ID)`. |
| `visibility` | `PUBLIC` \| `CONNECTIONS` | Default `PUBLIC`. |
| `url` | http(s) URL | Link posts. |
| `title` | string ≤ 400 | Link card title (required for links), or the video/document title (optional; defaults to the file name). |
| `description` | string ≤ 4,086 | Link card description. |
| `thumbnail_path` | local path | PNG/JPEG/GIF thumbnail for link or video posts. |
| `image_path` / `image_url` | local path / https URL | One image, PNG/JPEG/GIF ≤ 8 MB. |
| `alt_text` | string ≤ 4,086 | Screen-reader text. |
| `images` | array of 2–20 `{path?, url?, alt_text?}` | Multi-image posts. |
| `video_path` | local path | MP4, 3 s–30 min, 75 KB–500 MB. |
| `document_path` | local path | PDF/PPT/PPTX/DOC/DOCX, ≤ 100 MB, ≤ 300 pages. |
| `question` | string ≤ 140 | Poll question. |
| `options` | 2–4 strings ≤ 30 | Poll options. |
| `duration` | `ONE_DAY` \| `THREE_DAYS` \| `SEVEN_DAYS` \| `FOURTEEN_DAYS` | Poll duration, default `THREE_DAYS`. |
| `post` | URN or linkedin.com link | Post to reshare. Activity URNs work here only. |

## Account

| Tool | | Params | Returns |
|---|---|---|---|
| `auth_status` | R | none | `name`, `personUrn`, `scopes`, `canPost`, `expiresAt`, `daysLeft` |
| `get_my_profile` | R | none | `personUrn`, `name`, `givenName`, `familyName`, `picture`, `email`, `emailVerified`, `locale` |
| `read_linkedin_export` | R | `path` (zip or folder; `~` expands), `sections?` (profile, positions, education, skills, certifications, projects, languages, honors, courses, recommendations, connections), `include_connections` (default false) | The requested profile sections |

## Posting

| Tool | | Params |
|---|---|---|
| `preview_post` | R | `kind` (text, link, image, images, video, document, poll, reshare; default text) plus any shared post fields. Returns `{publishes: false, kind, characters, body}` and uploads nothing. |
| `create_text_post` | W | `text`, `visibility` |
| `create_link_post` | W | `text`, `visibility`, `url`, `title`, `description?`, `thumbnail_path?` |
| `create_image_post` | W | `text`, `visibility`, `image_path?` or `image_url?`, `alt_text?` |
| `create_multi_image_post` | W | `text?`, `visibility`, `images` |
| `create_video_post` | W | `text?`, `visibility`, `video_path`, `title?`, `thumbnail_path?` |
| `create_document_post` | W | `text?`, `visibility`, `document_path`, `title?` |
| `create_poll_post` | W | `text`, `visibility`, `question`, `options`, `duration` |
| `reshare_post` | W | `post`, `text?`, `visibility` |
| `edit_post` | W, destructive | `post_urn` (`urn:li:share:…` / `urn:li:ugcPost:…`), `text` |
| `delete_post` | W, destructive | `post_urn` |

Every `create_*` tool returns `{published: true, kind, visibility, postUrn, url, assets?}`.

## Drafts (local `drafts.json`)

| Tool | | Params |
|---|---|---|
| `save_draft` | W (local) | Same as `preview_post`, plus `label?` (≤ 80 chars) |
| `list_drafts` | R | `include_published` (default false), `with_details` (default false) |
| `update_draft` | W (local) | `id`, `label?`, and any post fields to change, including `kind` |
| `delete_draft` | W (local) | `id` |
| `publish_draft` | W | `id`, `allow_republish` (default false) |

## Jobs

| Tool | | Params |
|---|---|---|
| `linkedin_job_search_link` | R | `keywords`, `location?`, `posted_within` (any, day, week, month; default any), `work_type?` (onsite, remote, hybrid), `experience?` (internship, entry, associate, mid_senior, director, executive), `job_type?` (full_time, part_time, contract, temporary, internship, volunteer, other), `easy_apply` (default false), `sort` (relevant or recent; default recent) |
| `search_public_jobs` | R | `keywords` (default ""), `location?`, `remote_only` (default false), `companies` (≤ 25 slugs, optionally prefixed `greenhouse:`, `lever:` or `ashby:`), `sources` (boards and/or remotive; default boards), `limit` (1–100, default 25) |
