import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { describe, test } from "node:test";
import { verifyAgIAuthContextJwt } from "../src/agi-auth.mjs";

const NOW = Date.parse("2026-08-15T16:00:00.000Z");
const ISSUER = "https://autogive.app";
const AUDIENCE = "fund-intel";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const jwk = { ...publicKey.export({ format: "jwk" }), alg: "RS256", kid: "test-key", use: "sig" };

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function makeToken(overrides = {}) {
  const header = { alg: "RS256", kid: "test-key", typ: "JWT" };
  const payload = {
    issuer: ISSUER,
    subject: "synthetic-user",
    tokenId: "synthetic-token",
    audience: AUDIENCE,
    client_id: "hacker-dojo",
    tenant_id: "hacker-dojo",
    project_id: "project-robotics",
    scope: "project",
    roles: ["tenant_director"],
    capabilities: ["project:read", "allocation:approve"],
    issuedAt: "2026-08-15T15:59:00.000Z",
    expiresAt: "2026-08-15T16:05:00.000Z",
    ...overrides,
  };
  const encodedHeader = encode(header);
  const encodedPayload = encode(payload);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = sign("RSA-SHA256", Buffer.from(signingInput), privateKey).toString(
    "base64url",
  );
  return `${signingInput}.${signature}`;
}

const options = { issuer: ISSUER, audience: AUDIENCE, now: NOW };
const jwks = { keys: [jwk] };

describe("AGI JWKS auth context verification", () => {
  test("accepts a signed, correctly scoped context", async () => {
    const context = await verifyAgIAuthContextJwt(makeToken(), jwks, options);
    assert.equal(context?.tenant_id, "hacker-dojo");
    assert.equal(context?.project_id, "project-robotics");
    assert.deepEqual(context?.capabilities, ["project:read", "allocation:approve"]);
  });

  test("rejects a tampered payload", async () => {
    const token = makeToken();
    const segments = token.split(".");
    segments[1] = encode({ ...JSON.parse(Buffer.from(segments[1], "base64url")), tenant_id: "other" });
    assert.equal(await verifyAgIAuthContextJwt(segments.join("."), jwks, options), null);
  });

  test("rejects an unknown key id and wrong issuer", async () => {
    assert.equal(
      await verifyAgIAuthContextJwt(makeToken(), { keys: [{ ...jwk, kid: "other-key" }] }, options),
      null,
    );
    assert.equal(
      await verifyAgIAuthContextJwt(makeToken({ issuer: "https://evil.example" }), jwks, options),
      null,
    );
  });

  test("rejects expired, mismatched-audience, and mismatched-tenant contexts", async () => {
    assert.equal(
      await verifyAgIAuthContextJwt(
        makeToken({ expiresAt: "2026-08-15T15:59:59.000Z" }),
        jwks,
        options,
      ),
      null,
    );
    assert.equal(
      await verifyAgIAuthContextJwt(makeToken({ audience: "impact-relay" }), jwks, options),
      null,
    );
    assert.equal(
      await verifyAgIAuthContextJwt(makeToken({ tenant_id: "other-tenant" }), jwks, options),
      null,
    );
  });

  test("rejects an algorithm downgrade", async () => {
    const token = makeToken();
    const segments = token.split(".");
    segments[0] = encode({ alg: "none", kid: "test-key", typ: "JWT" });
    assert.equal(await verifyAgIAuthContextJwt(segments.join("."), jwks, options), null);
  });
});
