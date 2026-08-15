# AGI cross-repository harness

Private integration harness for the AGI control plane, Fund-Intel Hacker Dojo tenant implementation, and Impact Relay evidence path.

This repository is intentionally synthetic and security-focused. It does not contain application secrets, production data, donor records, private evidence, or deployable product code.

## Current slice

The scaffold validates the local Hacker Dojo multi-project fixture and establishes the test boundary for the next cross-repository checks:

- shared `client_id` / `tenant_id` identity;
- unique project scope beneath Hacker Dojo;
- no donor identity in public fixtures;
- optional single/dual approval policy vocabulary;
- stable revision and synthetic-fixture evidence expectations.
- signed RS256 AGI auth context verification against an ephemeral test key and local JWKS.
- route-intent binding to verified tenant, project, audience, expiry, and capability context.

## Planned integrations

1. Pin a released Specs version.
2. Pin AGI, Fund-Intel, and Impact Relay revisions in CI.
3. Replace the ephemeral key test with pinned non-production JWKS fixtures when the AGI edge issuer is configured.
4. Add tenant-isolation tests against synthetic Supabase/preview environments.
5. Add allocation, optional dual-approval, delegation, evidence, and public-projection acceptance tests.

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
