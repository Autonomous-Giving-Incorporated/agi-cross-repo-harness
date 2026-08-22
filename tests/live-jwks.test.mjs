import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { verifyAgIAuthContextJwt } from "../src/agi-auth.mjs";
import {
  fetchLiveJwks,
  isHttpsUrl,
  readLiveIssuerConfig,
} from "../src/live-jwks.mjs";

const fixtureJwks = JSON.parse(
  readFileSync(new URL("../fixtures/jwks/non-prod-jwks.json", import.meta.url), "utf8"),
);
const pinnedToken = readFileSync(
  new URL("../fixtures/jwks/pinned-context.jwt", import.meta.url),
  "utf8",
).trim();

const ISSUER = "https://autogive.app";
const AUDIENCE = "fund-intel";
const JWKS_URL = "https://issuer.example/.well-known/jwks.json";
const WITHIN = Date.parse("2026-08-22T00:02:00.000Z");

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => body,
  };
}

describe("live issuer config", () => {
  test("skips when AGI_AUTH_* are unset so default CI stays offline", () => {
    const config = readLiveIssuerConfig({});
    assert.equal(config.status, "skipped");
  });

  test("skips when values are only whitespace", () => {
    const config = readLiveIssuerConfig({
      AGI_AUTH_ISSUER: "  ",
      AGI_AUTH_AUDIENCES: "\t",
      AGI_AUTH_JWKS_URL: "",
    });
    assert.equal(config.status, "skipped");
  });

  test("fails closed on a partial config", () => {
    const config = readLiveIssuerConfig({ AGI_AUTH_JWKS_URL: JWKS_URL });
    assert.equal(config.status, "rejected");
    assert.equal(config.reason, "incomplete_config");
  });

  test("fails closed on a non-HTTPS issuer or JWKS URL", () => {
    assert.equal(isHttpsUrl("http://autogive.app"), false);
    assert.equal(isHttpsUrl("https://user:pass@autogive.app/jwks"), false);
    assert.equal(
      readLiveIssuerConfig({
        AGI_AUTH_ISSUER: "http://autogive.app",
        AGI_AUTH_AUDIENCES: AUDIENCE,
        AGI_AUTH_JWKS_URL: JWKS_URL,
      }).reason,
      "insecure_url",
    );
    assert.equal(
      readLiveIssuerConfig({
        AGI_AUTH_ISSUER: ISSUER,
        AGI_AUTH_AUDIENCES: AUDIENCE,
        AGI_AUTH_JWKS_URL: "http://issuer.example/jwks.json",
      }).reason,
      "insecure_url",
    );
  });

  test("accepts a complete HTTPS config", () => {
    const config = readLiveIssuerConfig({
      AGI_AUTH_ISSUER: ISSUER,
      AGI_AUTH_AUDIENCES: "fund-intel, impact-relay",
      AGI_AUTH_JWKS_URL: JWKS_URL,
    });
    assert.equal(config.status, "ready");
    assert.equal(config.issuer, ISSUER);
    assert.deepEqual(config.audiences, ["fund-intel", "impact-relay"]);
    assert.equal(config.jwksUrl, JWKS_URL);
  });
});

describe("live JWKS fetch (injected, network-free)", () => {
  test("fails closed when the URL cannot be resolved", async () => {
    const result = await fetchLiveJwks(JWKS_URL, {
      fetchImpl: async () => {
        throw new Error("getaddrinfo ENOTFOUND");
      },
    });
    assert.equal(result.status, "rejected");
    assert.equal(result.reason, "unresolvable");
  });

  test("fails closed on a non-OK JWKS response", async () => {
    const result = await fetchLiveJwks(JWKS_URL, {
      fetchImpl: async () => jsonResponse({ keys: [] }, { ok: false, status: 404 }),
    });
    assert.equal(result.status, "rejected");
    assert.equal(result.reason, "unresolvable");
  });

  test("fails closed on an empty or unusable key set", async () => {
    const empty = await fetchLiveJwks(JWKS_URL, {
      fetchImpl: async () => jsonResponse({ keys: [] }),
    });
    assert.equal(empty.reason, "invalid_jwks");

    const wrongAlg = await fetchLiveJwks(JWKS_URL, {
      fetchImpl: async () =>
        jsonResponse({
          keys: [{ ...fixtureJwks.keys[0], alg: "none" }],
        }),
    });
    assert.equal(wrongAlg.reason, "invalid_jwks");
  });

  test("fails closed when the JWKS includes private material", async () => {
    const result = await fetchLiveJwks(JWKS_URL, {
      fetchImpl: async () =>
        jsonResponse({
          keys: [{ ...fixtureJwks.keys[0], d: "private-exponent" }],
        }),
    });
    assert.equal(result.status, "rejected");
    assert.equal(result.reason, "private_material");
  });

  test("returns a public JWKS that verifies the pinned fixture token", async () => {
    const result = await fetchLiveJwks(JWKS_URL, {
      fetchImpl: async (url, init) => {
        assert.equal(url, JWKS_URL);
        assert.equal(init.method, "GET");
        assert.equal(init.redirect, "error");
        return jsonResponse(fixtureJwks);
      },
    });
    assert.equal(result.status, "ok");
    const ctx = await verifyAgIAuthContextJwt(pinnedToken, result.jwks, {
      issuer: ISSUER,
      audience: AUDIENCE,
      now: WITHIN,
    });
    assert.ok(ctx, "expected the fetched public JWKS to verify the pinned token");
    assert.equal(ctx.tenant_id, "hacker-dojo");
    assert.equal(ctx.project_id, "project-robotics");
  });
});

describe("gated live-issuer acceptance", () => {
  test("skips when unset; fails closed when set and the JWKS is unusable", async (t) => {
    const config = readLiveIssuerConfig(process.env);
    if (config.status === "skipped") {
      t.skip("AGI_AUTH_* unset; default CI stays offline");
      return;
    }
    assert.equal(
      config.status,
      "ready",
      `live issuer config rejected: ${config.reason ?? "unknown"}`,
    );
    const result = await fetchLiveJwks(config.jwksUrl);
    assert.equal(
      result.status,
      "ok",
      `live JWKS fetch failed closed: ${result.reason ?? "unknown"}`,
    );
  });
});
