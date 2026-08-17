# AGI cross-repository harness

See `README.md` for the security model and integration contract. This is a synthetic,
security-focused Node.js test harness — there are no runtime services, no build step,
and no application server to launch. The test suite in `tests/` is the deliverable.

## Cursor Cloud specific instructions

- Runtime: Node.js `>=22` (see `package.json` `engines`). The VM already provides Node 22.x.
- No third-party dependencies: `src/agi-auth.mjs` and the tests use only the Node standard
  library (`node:crypto`, `node:test`, `node:fs`). `npm install` is a no-op refresh.
- Test / "run" the harness with `npm test` (runs `node --test tests/*.test.mjs`). There is
  no separate app to start, no dev server, and no lint or build script defined.
- The JWT verification test mints an ephemeral in-memory RS256 key pair per run; no secrets,
  keys, or JWKS responses are stored. Do not add secrets to source control (see `.gitignore`,
  which blocks `*.pem`/`*.key`/`*.jwt` and `.env*`).
- The env var names in `README.md` (`AGI_AUTH_ISSUER`, `AGI_AUTH_AUDIENCES`, `AGI_AUTH_JWKS_URL`)
  are a future integration contract and are NOT required to run the current tests.
