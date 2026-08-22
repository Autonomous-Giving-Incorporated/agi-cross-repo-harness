import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { verifyDownstreamHandoff } from "../src/downstream-handoff.mjs";

const fundIntelIntent = {
  intentId: "intent-1",
  audience: "fund-intel",
  action: "project.review",
  client_id: "hacker-dojo",
  tenant_id: "hacker-dojo",
  project_id: "project-robotics",
};

const impactRelayIntent = {
  ...fundIntelIntent,
  intentId: "intent-2",
  audience: "impact-relay",
  action: "evidence.read",
};

describe("downstream least-context hand-off", () => {
  test("accepts a minimal Fund-Intel hand-off bound to the intent", () => {
    const r = verifyDownstreamHandoff(fundIntelIntent, {
      intentId: "intent-1",
      audience: "fund-intel",
      action: "project.review",
      client_id: "hacker-dojo",
      tenant_id: "hacker-dojo",
      project_id: "project-robotics",
      correlationId: "corr-1",
      requestedCapability: "project:read",
    });
    assert.equal(r.ok, true, r.errors.join("; "));
  });

  test("accepts an Impact Relay hand-off carrying allocationId for evidence", () => {
    const r = verifyDownstreamHandoff(impactRelayIntent, {
      intentId: "intent-2",
      audience: "impact-relay",
      action: "evidence.read",
      client_id: "hacker-dojo",
      tenant_id: "hacker-dojo",
      project_id: "project-robotics",
      allocationId: "alloc-1",
    });
    assert.equal(r.ok, true, r.errors.join("; "));
  });

  test("rejects allocationId handed to Fund-Intel (over-scoped for that audience)", () => {
    const r = verifyDownstreamHandoff(fundIntelIntent, {
      intentId: "intent-1",
      audience: "fund-intel",
      action: "project.review",
      client_id: "hacker-dojo",
      tenant_id: "hacker-dojo",
      project_id: "project-robotics",
      allocationId: "alloc-1",
    });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes("over-scoped")));
  });

  test("rejects donor-identity residue in any hand-off", () => {
    const r = verifyDownstreamHandoff(impactRelayIntent, {
      intentId: "intent-2",
      audience: "impact-relay",
      action: "evidence.read",
      client_id: "hacker-dojo",
      tenant_id: "hacker-dojo",
      project_id: "project-robotics",
      donorEmail: "someone@example.com",
    });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes("donor-identity")));
  });

  test("rejects a cross-tenant hand-off", () => {
    const r = verifyDownstreamHandoff(fundIntelIntent, {
      intentId: "intent-1",
      audience: "fund-intel",
      action: "project.review",
      client_id: "hacker-dojo",
      tenant_id: "other-tenant",
      project_id: "project-robotics",
      correlationId: "corr-1",
    });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes("tenant")));
  });

  test("rejects a cross-project hand-off", () => {
    const r = verifyDownstreamHandoff(fundIntelIntent, {
      intentId: "intent-1",
      audience: "fund-intel",
      action: "project.review",
      client_id: "hacker-dojo",
      tenant_id: "hacker-dojo",
      project_id: "project-ai-lab",
      correlationId: "corr-1",
    });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes("project")));
  });

  test("rejects an unknown audience", () => {
    const r = verifyDownstreamHandoff(
      { ...fundIntelIntent, audience: "unknown" },
      { audience: "unknown", tenant_id: "hacker-dojo", project_id: "project-robotics" },
    );
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes("unauthorized audience")));
  });
});
