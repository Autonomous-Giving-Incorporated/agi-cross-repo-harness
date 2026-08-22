# Plan: tenant-isolation against a synthetic environment (planned integration #4)

**Status: IMPLEMENTED (2026-08-22)** via a disposable Postgres service container that carries a synthetic replica of the AGI platform RLS slice. See "Implemented" below. A live Supabase run remains an optional future enhancement.

## Implemented (2026-08-22)

Supabase branching (the disposable path against the real AGI project) requires the Pro plan, and the org's free-project quota was already full, so we do **not** touch the production AGI database. Instead, the isolation test runs against a throwaway **Postgres service container** carrying `sql/tenant-isolation-slice.sql` - a synthetic replica whose SECURITY DEFINER helpers (`is_client_member`, `current_client_role`, `is_master_admin`, `current_session_aal`) and policies are reproduced **verbatim** from the AGI Supabase project (extracted read-only), with `auth.uid()`/`auth.jwt()` shimmed to read `request.jwt.claims` exactly as Supabase does.

- `scripts/verify-tenant-isolation.sh` applies the slice, then probes as the `authenticated` role with per-tenant JWT claims and asserts both **read** and **write** isolation, fail closed:
  - reads: tenant A sees its own rows (positive) and 0 cross-tenant rows (isolation), tenant B likewise, anonymous sees nothing;
  - writes + privilege/MFA gate: a director writes only its own tenant and **only with MFA/aal2** (a director without aal2 is denied), a cross-tenant write is denied, and a board_viewer cannot write at all.
- CI job `tenant-isolation` (`.github/workflows/ci.yml`) runs it against a `postgres:16` service - deterministic, synthetic, no secrets, no production access.

Verified locally and in CI: all ten checks pass ("TENANT ISOLATION VERIFIED").

### Optional future enhancement: live Supabase run

## Goal

Prove data-layer tenant/project isolation against a **synthetic** Supabase (or preview) environment: a tenant-scoped context reads only its own rows, a project-scoped context cannot read sibling projects, and cross-tenant reads return nothing. This complements the in-memory context/routing checks (`src/agi-auth.mjs`, `src/downstream-handoff.mjs`) by exercising real Row-Level Security (RLS), not just synthetic objects.

## Prerequisite (the gate)

A synthetic, disposable environment - never production:

- A Supabase project or preview branch seeded with **synthetic** data only (no donor records, no real evidence).
- RLS enabled on every tenant-scoped table, keyed off the JWT tenant/project claims.
- Short-lived access via GitHub Actions OIDC; **no static `service_role` key** committed or printed.

Env contract (provided at runtime only):

- `SUPABASE_URL` - synthetic project URL
- `SUPABASE_ANON_KEY` - anon key (RLS-enforced; not service_role)
- per-tenant synthetic JWTs minted through the harness auth path (reuse the `verifyAgIAuthContextJwt` context shape)

## Seed (synthetic)

Two tenants (`hacker-dojo`, `other-tenant`), >=2 projects each, rows tagged by `tenant_id` / `project_id`. RLS policy shape: `tenant_id = (auth.jwt() ->> 'tenant_id')`, with an additional project predicate for project-scoped reads.

## Tests (skipped unless `SUPABASE_URL` is set)

1. A `hacker-dojo` tenant-scoped token reads only `hacker-dojo` rows.
2. The same token reading `other-tenant` rows returns empty (RLS denies).
3. A `project-robotics`-scoped token cannot read `project-ai-lab` rows.
4. `service_role` is never used from CI; only anon + RLS. Presence of a service-role key in the test path is itself a failure.

## Fail-closed behavior

Any cross-tenant or cross-project read that returns data is a hard failure. Missing/disabled RLS is a hard failure. A missing environment **skips** (does not silently pass a weaker check).

## Security rules

Synthetic data only. OIDC + short-lived credentials; tear down the preview branch after the run. No `service_role` key, JWT, or row payload in CI logs.

## Definition of done

- A seed migration + RLS policies for the synthetic tenants/projects.
- A CI job (separate) that points at the synthetic env, runs the isolation tests, and fails closed.
- Default offline CI unaffected.

## What would unblock the live-Supabase variant

The Postgres-container test above already exercises the platform's RLS logic. To additionally run against a real Supabase project, either upgrade the org to Pro (enables disposable branches) or free a slot in the 2-project free quota; then point `DATABASE_URL` (or `SUPABASE_URL` + a read-only key) at that synthetic project. Not required for the check to pass.
