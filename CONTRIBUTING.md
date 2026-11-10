# Contributing

Thanks for helping! Bug reports, docs fixes and new tools are all welcome.

1. Fork and clone, then `npm install` (Node 20+).
2. Create a branch: `git switch -c feat/short-name`.
3. Make your change with tests. Tests stub `fetch` — please don't add tests that call LinkedIn for real.
4. Run `npm run typecheck && npm run lint && npm test`.
5. Open a pull request describing what changed and why.

## Adding a tool

- Put LinkedIn API calls in `src/linkedin/` and the MCP tool in `src/tools/`.
- Only use endpoints available to self-serve apps (OpenID Connect + Share on LinkedIn). Anything that scrapes or automates linkedin.com won't be accepted.
- Mark write tools with `readOnlyHint: false` (and `destructiveHint: true` if they remove data) so clients ask before running them.
