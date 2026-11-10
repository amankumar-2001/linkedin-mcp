# Changelog

## 0.2.0 — 2026-11-10

- New post types: `create_multi_image_post` (2–20 images), `create_video_post` (MP4 multipart upload with processing wait), `create_document_post` (PDF/PPT/DOC carousels), `create_poll_post`.
- `reshare_post` (accepts a URN or a linkedin.com post link) and `edit_post` (change a post's text).
- `@[Name](urn:li:…)` mentions are kept intact in every post's text.
- Local drafts: `save_draft`, `list_drafts`, `update_draft`, `delete_draft`, `publish_draft`.
- Jobs: `linkedin_job_search_link` (filtered LinkedIn Jobs URL) and `search_public_jobs` (Greenhouse, Lever, Ashby boards + Remotive, cached 6 h).
- Full profile: `read_linkedin_export` reads LinkedIn's data-export ZIP or folder locally.
- `preview_post` covers every post kind; all post tools share one publish path.

## 0.1.0 — 2026-11-10

- First release: `auth_status`, `get_my_profile`, `preview_post`, `create_text_post`, `create_link_post`, `create_image_post`, `delete_post`.
- CLI: `serve` (default), `auth`, `status`, `logout`.
- Local OAuth sign-in with a loopback callback; token stored with `0600` permissions.
