# Plan: tenant-isolation against a synthetic environment (planned integration #4)

**Status:** scaffolded plan. Gated on a synthetic Supabase/preview environment being provisioned. Do not add live-environment tests to default CI; they must be skipped unless the environment is configured.

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
- A CI job (separate, OIDC-gated) that provisions/points at the synthetic env, runs the isolation tests, and tears down.
- Default offline CI unaffected (tests skip without `SUPABASE_URL`).

## What unblocks it

A provisioned synthetic Supabase project (or preview-branch automation) plus OIDC federation for short-lived access. Until then this plan cannot be exercised.
