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

## Planned integrations

1. Pin a released Specs version.
2. Pin AGI, Fund-Intel, and Impact Relay revisions in CI.
3. Add AGI-issued JWT verification tests against a non-production JWKS.
4. Add tenant-isolation tests against synthetic Supabase/preview environments.
5. Add allocation, optional dual-approval, delegation, evidence, and public-projection acceptance tests.

## Security rules

- Never commit secrets, JWTs, private keys, real donor data, production receipts, or private evidence URLs.
- Use GitHub Actions OIDC and short-lived credentials for preview environments.
- Use protected environments and least-privilege repository access.
- Redact tokens and payloads from CI output.
- A security test failure blocks acceptance. It must not silently fall back to a weaker test mode.

The architecture authority is [ADR-014 in Autonomous-Giving-Specs](https://github.com/Autonomous-Giving-Incorporated/Autonomous-Giving-Specs/blob/main/adr/ADR-014-agi-control-plane.md).
