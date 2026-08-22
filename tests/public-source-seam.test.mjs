import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { verifyPublicSource } from "../src/public-source-seam.mjs";

// Deterministic clock: fixtures dated 2026-08-22 are fresh; 2026-08-08 is 14d stale.
const NOW = Date.parse("2026-08-22T00:00:00Z");

function load(name) {
  const url = new URL(`../fixtures/public-sources/${name}`, import.meta.url);
  const raw = readFileSync(url, "utf8");
  return { raw, doc: JSON.parse(raw) };
}

function verify(sourceId, name) {
  const { raw, doc } = load(name);
  return verifyPublicSource(sourceId, doc, raw, { now: NOW });
}

describe("public-source seam - security (fail closed)", () => {
  test("accepts a live-ready Portfolio Signals public-campaign", () => {
    const r = verify("portfolio-signals-public-campaign", "portfolio-signals.live-ready.json");
    assert.equal(r.security, "PASS", r.errors.join("; "));
    assert.equal(r.live, "READY");
  });

  test("accepts a live-ready Impact Relay public-impact", () => {
    const r = verify("impact-relay-public-impact", "impact-relay.live-ready.json");
    assert.equal(r.security, "PASS", r.errors.join("; "));
    assert.equal(r.live, "READY");
  });

  test("fails closed on donor-identity residue and a true privacy flag", () => {
    const r = verify("impact-relay-public-impact", "impact-relay.privacy-violation.json");
    assert.equal(r.security, "FAIL");
    assert.ok(r.errors.some((e) => e.includes("donorNamesAllowed")));
    assert.ok(r.errors.some((e) => e.includes("donor-identity residue")));
  });

  test("fails closed on an authority mismatch", () => {
    const { raw, doc } = load("portfolio-signals.live-ready.json");
    const r = verifyPublicSource(
      "portfolio-signals-public-campaign",
      { ...doc, authority: "public_aggregate_only" },
      raw,
      { now: NOW },
    );
    assert.equal(r.security, "FAIL");
    assert.ok(r.errors.some((e) => e.includes("authority must be 'advisory_only'")));
  });

  test("fails closed when the privacy classification is wrong", () => {
    const { raw, doc } = load("impact-relay.live-ready.json");
    const r = verifyPublicSource(
      "impact-relay-public-impact",
      { ...doc, privacy: { ...doc.privacy, classification: "internal" } },
      raw,
      { now: NOW },
    );
    assert.equal(r.security, "FAIL");
  });
});

describe("public-source seam - liveness (dormant is safe)", () => {
  test("Portfolio Signals dormant: safe but stale + execution blocked", () => {
    const r = verify("portfolio-signals-public-campaign", "portfolio-signals.dormant.json");
    assert.equal(r.security, "PASS", r.errors.join("; "));
    assert.equal(r.live, "DORMANT");
    assert.ok(r.livenessReasons.some((x) => x.startsWith("stale_")));
    assert.ok(r.livenessReasons.includes("execution_blocked"));
  });

  test("Impact Relay dormant: safe but stale + no verified outcome", () => {
    const r = verify("impact-relay-public-impact", "impact-relay.dormant.json");
    assert.equal(r.security, "PASS", r.errors.join("; "));
    assert.equal(r.live, "DORMANT");
    assert.ok(r.livenessReasons.includes("no_verified_outcome"));
  });

  test("freshness is deterministic: a fresh doc read far later is stale", () => {
    const { raw, doc } = load("impact-relay.live-ready.json");
    const later = Date.parse("2026-09-30T00:00:00Z");
    const r = verifyPublicSource("impact-relay-public-impact", doc, raw, { now: later });
    assert.equal(r.security, "PASS");
    assert.equal(r.live, "DORMANT");
    assert.ok(r.livenessReasons.some((x) => x.startsWith("stale_")));
  });
});
