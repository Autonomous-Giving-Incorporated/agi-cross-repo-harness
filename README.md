# AGI cross-repository harness

Private integration harness for the AGI control plane, Portfolio Signals Hacker Dojo tenant implementation, and Impact Relay evidence path.

This repository is intentionally synthetic and security-focused. It does not contain application secrets, production data, donor records, private evidence, or deployable product code.

## Current slice

The scaffold validates the local Hacker Dojo multi-project fixture and establishes the test boundary for the next cross-repository checks:

- shared `client_id` / `tenant_id` identity;
- unique project scope beneath Hacker Dojo;
- no donor identity in public fixtures;
- optional single/dual approval policy vocabulary;
- stable revision and synthetic-fixture evidence expectations.
- signed RS256 AGI auth context verification against an ephemeral test key and local JWKS, plus a pinned non-production JWKS fixture + synthetic token vector (`fixtures/jwks/`, verified in `tests/jwt-fixture.test.mjs`; no private key committed). Live-issuer config/fetch (`src/live-jwks.mjs`) skips when `AGI_AUTH_*` are unset and fails closed on incomplete, insecure, unresolvable, or private-material JWKS.
- route-intent binding to verified tenant, project, audience, expiry, and capability context.
- ajv validation of pinned CONTRACT-008–012 schemas (synthetic payloads only).
- public-source seam verification for the documents the AGI public workbench actually consumes (Portfolio Signals `data/public-campaign.json`, authority `advisory_only`; Impact Relay `data/public-impact.json`, authority `public_aggregate_only`): authority, privacy classification/flags, and donor-identity residue **fail closed**, while freshness and VERIFIED-outcome are reported as liveness (a dormant seam is safe — the AGI consumer falls back to its deterministic fixture). See `src/public-source-seam.mjs`.
- lifecycle and approval verification (`src/lifecycle.mjs`): recommendation precedes approval precedes allocation precedes delegation precedes verified impact; single vs dual approval; amount-threshold-triggered dual; distinct authorized approvers; tenant/project/correlation binding; and idempotent de-duplication. Synthetic doubles only — no production auth.
- downstream least-context hand-off verification (`src/downstream-handoff.mjs`): confirms each audience (Fund-Intel, Impact Relay) receives only its allowlisted routing context, bound to the verified intent's tenant/project, with over-scoped fields and any donor-identity residue rejected.
- evidence-attachment verification (`src/evidence-attachment.mjs`): validates records against the canonical CONTRACT-004 evidence shape (`schemas/CONTRACT-004-evidence.json`, vendored from pinned Specs), and confirms evidence attaches only to an authorized allocation, extends an append-only chain (no re-used `evidenceId`), and carries no donor identity.
- data-level tenant isolation (`sql/tenant-isolation-slice.sql` + `scripts/verify-tenant-isolation.sh`): a disposable Postgres service carries a synthetic replica of the AGI platform RLS slice (SECURITY DEFINER helpers + read/write policies reproduced verbatim). Probes prove **read** isolation (a tenant reads only its own rows) and **write** isolation with the privilege/MFA gate (a director writes only its own tenant and only with MFA/aal2; cross-tenant writes and board_viewer writes are denied). Runs in the `tenant-isolation` CI job.
- consumer revision pin in `refs/versions.json` (docs pin, not READY).
- suite-wide GitHub Actions SHA-pin guard (`src/action-pins.mjs` + `src/verify-pinned-actions.mjs`): every `uses:` at the pinned consumer revisions must name a 40-char commit SHA. Mutable tags fail closed.
- C3 public-data policy status (`src/c3-public-data-policy.mjs`): AGI `PUBLIC_DATA_POLICY_STATUS` and `docs/PUBLIC_DATA_POLICY.md` must stay **PROPOSED**. Invented approval fails closed. The `pinned-sources` job fetches the pinned AGI revision.

## Planned integrations

1. Pin a released Specs version. **Started:** `refs/versions.json` records Specs v2.0.0 (`c089739`); product SHAs remain PS #52, IR #17, Specs #17, AGI #23, and harness #20. Later docs-only tips (PS #55, Specs #19) are observed, not product pins. `specsMain` is the Specs workflow-pin revision, not a Specs version bump. Not READY.
2. Pin AGI, Portfolio Signals, and Impact Relay revisions in CI. **Done:** `refs/versions.json` pins the SHAs (refreshed 2026-08-22), and the `pinned-sources` CI job (`npm run verify:pinned-sources`, see `src/verify-pinned-sources.mjs`) fetches the real Portfolio Signals / Impact Relay public documents at those pinned revisions and runs the seam verifier against them, failing closed on any security violation or unverifiable source. The `pinned-actions` CI job (`npm run verify:pinned-actions`) fetches each consumer's workflow files at those SHAs and fails closed if any `uses:` is a mutable tag or branch. Both network-dependent jobs are kept separate from the network-free unit tests. Unmerged draft SHAs are not recorded.
3. Replace the ephemeral key test with pinned non-production JWKS fixtures when the AGI edge issuer is configured. **Fixture path done:** committed public JWKS + pinned synthetic token vector (`fixtures/jwks/`) verified in `tests/jwt-fixture.test.mjs`. **Live-issuer skip/fail-closed fetch path done:** `src/live-jwks.mjs` + `tests/live-jwks.test.mjs`. Verifying a token minted by the live issuer remains gated; see [docs/PLAN-03-pinned-jwks.md](docs/PLAN-03-pinned-jwks.md) (config shape in `refs/auth-config.example.json`).
4. Add tenant-isolation tests against synthetic Supabase/preview environments. **Done:** the `tenant-isolation` CI job runs `scripts/verify-tenant-isolation.sh` against a disposable `postgres:16` service carrying a verbatim synthetic replica of the platform RLS slice (`sql/tenant-isolation-slice.sql`), proving read + write isolation (privileged writes require director role + MFA/aal2). A live-Supabase run is an optional future enhancement (see [docs/PLAN-04-tenant-isolation.md](docs/PLAN-04-tenant-isolation.md)).
5. Add allocation, optional dual-approval, delegation, evidence, and public-projection acceptance tests. **Done:** allocation lifecycle ordering + single/dual approval (`src/lifecycle.mjs`); downstream least-context delegation hand-off (`src/downstream-handoff.mjs`); evidence-attachment acceptance against the canonical CONTRACT-004 shape, append-only + authorized-allocation (`src/evidence-attachment.mjs`); and public-projection privacy (`src/public-source-seam.mjs`).

## Security rules

- Never commit secrets, JWTs, private keys, real donor data, production receipts, or private evidence URLs.
- Use GitHub Actions OIDC and short-lived credentials for preview environments.
- Use protected environments and least-privilege repository access.
- Redact tokens and payloads from CI output.
- A security test failure blocks acceptance. It must not silently fall back to a weaker test mode.

The architecture authority is [ADR-014 in Autonomous-Giving-Specs](https://github.com/Autonomous-Giving-Incorporated/Autonomous-Giving-Specs/blob/main/adr/ADR-014-agi-control-plane.md).

## Auth configuration boundary

Production auth is not enabled by this repository. The verification test generates
an ephemeral RSA key pair in memory and supplies its public JWK directly to the
verifier. No token, private key, or live JWKS response is stored in the repository.

When the AGI edge issuer is ready, the integration should provide configuration at
runtime only, using an issuer URL, an audience allowlist, and a JWKS URL or pinned
non-production key set. It must fail closed when any value is missing, when the key
cannot be resolved, or when the context does not match the requested tenant and
project. The expected logical configuration is:

```text
AGI_AUTH_ISSUER       # exact HTTPS issuer, for example https://autogive.app
AGI_AUTH_AUDIENCES    # explicit comma-separated audience allowlist
AGI_AUTH_JWKS_URL     # HTTPS JWKS endpoint, never a private key
```

These names are a harness integration contract, not a request to add secrets to
source control or to enable auth in the AGI static public Worker.
