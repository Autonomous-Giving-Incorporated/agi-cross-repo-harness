import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { verifyAgIAuthContextJwt } from "../src/agi-auth.mjs";

// Pinned non-production fixtures: a committed public JWKS and a synthetic
// auth-context token signed offline by the matching (never-committed) private
// key. This complements the ephemeral-key test with a stable, reviewable vector.
const jwks = JSON.parse(
  readFileSync(new URL("../fixtures/jwks/non-prod-jwks.json", import.meta.url), "utf8"),
);
const token = readFileSync(
  new URL("../fixtures/jwks/pinned-context.jwt", import.meta.url),
  "utf8",
).trim();

const ISSUER = "https://autogive.app";
const AUDIENCE = "fund-intel";
// The pinned token is valid 2026-08-22T00:00:00Z .. 00:05:00Z.
const WITHIN = Date.parse("2026-08-22T00:02:00.000Z");
const AFTER_EXPIRY = Date.parse("2026-08-22T01:00:00.000Z");

describe("pinned non-production JWKS fixture", () => {
  test("verifies the pinned token against the pinned public JWKS", async () => {
    const ctx = await verifyAgIAuthContextJwt(token, jwks, { issuer: ISSUER, audience: AUDIENCE, now: WITHIN });
    assert.ok(ctx, "expected a verified context");
    assert.equal(ctx.tenant_id, "hacker-dojo");
    assert.equal(ctx.client_id, ctx.tenant_id);
    assert.equal(ctx.project_id, "project-robotics");
  });

  test("fails closed on a wrong audience", async () => {
    const ctx = await verifyAgIAuthContextJwt(token, jwks, { issuer: ISSUER, audience: "impact-relay", now: WITHIN });
    assert.equal(ctx, null);
  });

  test("fails closed on a wrong issuer", async () => {
    const ctx = await verifyAgIAuthContextJwt(token, jwks, { issuer: "https://evil.example", audience: AUDIENCE, now: WITHIN });
    assert.equal(ctx, null);
  });

  test("fails closed once the token has expired", async () => {
    const ctx = await verifyAgIAuthContextJwt(token, jwks, { issuer: ISSUER, audience: AUDIENCE, now: AFTER_EXPIRY });
    assert.equal(ctx, null);
  });

  test("fails closed when the kid is not in the JWKS", async () => {
    const otherJwks = { keys: [{ ...jwks.keys[0], kid: "different-kid" }] };
    const ctx = await verifyAgIAuthContextJwt(token, otherJwks, { issuer: ISSUER, audience: AUDIENCE, now: WITHIN });
    assert.equal(ctx, null);
  });
});
