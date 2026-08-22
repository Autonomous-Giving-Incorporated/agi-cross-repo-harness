# AGI cross-repository harness

See `README.md` for the security model and integration contract. This is a synthetic,
security-focused Node.js test harness — there are no runtime services, no build step,
and no application server to launch. The test suite in `tests/` is the deliverable.

## Cursor Cloud specific instructions

- Runtime: Node.js `>=22` (see `package.json` `engines`). The VM already provides Node 22.x.
- Refresh dependencies with `npm ci` (`ajv` / `ajv-formats` for schema tests). Auth tests
  still mint an ephemeral in-memory RS256 key pair; do not add secrets.
- Test / "run" the harness with `npm test` (runs `node --test tests/*.test.mjs`). There is
  no separate app to start, no dev server, and no lint or build script defined.
- Network jobs (CI only): `npm run verify:pinned-sources` and `npm run verify:pinned-actions`.
  The actions pin-guard uses `GITHUB_TOKEN` in CI for GitHub API rate limits.
  `verify:pinned-sources` also checks the pinned AGI C3 policy files; they must stay PROPOSED.
- The JWT verification test mints an ephemeral in-memory RS256 key pair per run; no secrets,
  keys, or JWKS responses are stored. Do not add secrets to source control (see `.gitignore`,
  which blocks `*.pem`/`*.key`/`*.jwt` and `.env*`).
- The env var names in `README.md` (`AGI_AUTH_ISSUER`, `AGI_AUTH_AUDIENCES`, `AGI_AUTH_JWKS_URL`)
  are a harness integration contract, not repo secrets. They are NOT required to run
  `npm test`. When unset, `tests/live-jwks.test.mjs` skips the live fetch. When set,
  that test fetches the JWKS and fails closed if the config is incomplete/insecure
  or the URL is unresolvable. Do not log JWKS or token material. Do not enable auth
  on the AGI static public Worker.
