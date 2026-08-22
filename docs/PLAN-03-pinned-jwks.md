# Plan: pinned non-production JWKS fixtures (planned integration #3)

**Status:** the committed non-production JWKS fixture path is **implemented** (`fixtures/jwks/non-prod-jwks.json` + `fixtures/jwks/pinned-context.jwt`, verified in `tests/jwt-fixture.test.mjs`; the private key was generated offline and never committed). The live-issuer **config + fetch** path is **implemented** (`src/live-jwks.mjs`, `tests/live-jwks.test.mjs`): skip when `AGI_AUTH_*` are unset; fail closed on incomplete/insecure config, an unresolvable JWKS URL, an invalid key set, or private key material. Verifying a token minted by a real AGI edge issuer remains gated on that issuer existing.

## Goal

Replace the per-run, in-memory RSA keypair in `tests/jwt-verification.test.mjs` with a **pinned, reviewable non-production JWKS fixture**, and add a gated acceptance path that verifies against the AGI edge issuer's published **non-production** JWKS once it exists. The verifier `verifyAgIAuthContextJwt(token, jwks, { issuer, audience, now })` (`src/agi-auth.mjs`) already accepts a caller-provided JWKS and never fetches a key set - so both paths plug into the existing function without changing it.

## Prerequisite (the gate)

A non-production AGI edge issuer with a stable, publishable configuration:

- `AGI_AUTH_ISSUER` - exact HTTPS issuer (e.g. `https://autogive.app`)
- `AGI_AUTH_AUDIENCES` - explicit comma-separated allowlist (e.g. `fund-intel,impact-relay`)
- `AGI_AUTH_JWKS_URL` - HTTPS JWKS endpoint (public keys only)

See `refs/auth-config.example.json` for the non-secret shape. Until the issuer exists, only the committed-fixture path is buildable.

## Approach

1. **Committed public JWKS fixture (buildable now).** Generate a non-production RSA keypair offline. Commit **only** the public JWKS as `fixtures/jwks/non-prod-jwks.json` with a stable `kid`. Never commit the private key.
2. **Signing synthetic tokens.** Prefer minting test tokens at runtime with a keypair whose public half matches the fixture `kid`, kept deterministic per run (as today), so no private key is stored. If a fixed non-production private key is unavoidable, inject it as a CI secret (e.g. `AGI_TEST_SIGNING_KEY`) used only to mint synthetic tokens - never committed, never logged.
3. **Live-issuer acceptance (gated).** `readLiveIssuerConfig` / `fetchLiveJwks` implement the contract. When `AGI_AUTH_*` are unset, the gated test skips so default CI stays deterministic and offline. When they are set, the helper fetches the issuer JWKS and **fails closed** (no weaker fallback) if the URL is unresolvable or the body is not a public RS256 JWKS. Verifying a token minted by the issuer's non-production signing path still waits on that issuer.
4. Feed the fixture (or fetched) JWKS straight into `verifyAgIAuthContextJwt`. The injected-fetch test already wires the committed public fixture through `fetchLiveJwks` into the verifier.

## Fail-closed behavior (already enforced by the verifier)

Missing issuer/audience/JWKS, an unresolvable `kid`, a non-RS256 alg, a bad signature, or an expired/replayed token all return `null` (reject). The gated live path must additionally fail closed when the JWKS URL cannot be resolved.

## Security rules

No private keys, tokens, or live JWKS responses committed. Use GitHub Actions OIDC + short-lived credentials for any live fetch. Redact token and key material from CI output. A security failure blocks acceptance - never fall back to a weaker mode.

## Definition of done

- `fixtures/jwks/non-prod-jwks.json` committed (public only); a test verifies a pinned token against it (`tests/jwt-fixture.test.mjs`). Done.
- A gated live-issuer test that skips when `AGI_AUTH_*` are unset and fails closed when they are set but the JWKS cannot be used (`src/live-jwks.mjs`). Done for config + fetch. Live token verification still waits on the edge issuer.
- No secrets or private keys in the repo or CI logs.
