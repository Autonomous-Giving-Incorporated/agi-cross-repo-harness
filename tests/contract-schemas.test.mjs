import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { validateContract } from "../src/contract-schemas.mjs";

const versions = JSON.parse(readFileSync(new URL("../refs/versions.json", import.meta.url), "utf8"));

const valid = {
  "CONTRACT-008": {
    issuer: "https://autogive.app",
    subject: "synthetic-user",
    tokenId: "synthetic-token",
    audience: "fund-intel",
    client_id: "hacker-dojo",
    tenant_id: "hacker-dojo",
    project_id: "project-robotics",
    roles: ["tenant_director"],
    capabilities: ["project:read"],
    issuedAt: "2026-08-15T15:59:00.000Z",
    expiresAt: "2026-08-15T16:05:00.000Z",
  },
  "CONTRACT-009": {
    client_id: "hacker-dojo",
    tenant_id: "hacker-dojo",
    project_id: "project-robotics",
    scope: "project",
  },
  "CONTRACT-010": {
    intentId: "intent-1",
    audience: "fund-intel",
    action: "allocation.approve",
    client_id: "hacker-dojo",
    tenant_id: "hacker-dojo",
    project_id: "project-robotics",
    requestedAt: "2026-08-15T15:59:00.000Z",
    expiresAt: "2026-08-15T16:05:00.000Z",
  },
  "CONTRACT-011": {
    policyId: "policy-1",
    client_id: "hacker-dojo",
    tenant_id: "hacker-dojo",
    approvalMode: "dual",
    requiredApproverRoles: ["tenant_director", "finance_approver"],
    updatedAt: "2026-08-15T15:59:00.000Z",
  },
  "CONTRACT-012": {
    projectionId: "proj-1",
    client_id: "hacker-dojo",
    tenant_id: "hacker-dojo",
    project_id: "project-robotics",
    authority: "public_aggregate_only",
    status: "verified",
    verificationStatus: "verified",
    summary: "Aggregate-only workshop attendance.",
    updatedAt: "2026-08-15T15:59:00.000Z",
  },
};

describe("pinned consumer revisions", () => {
  test("records explicit SHAs instead of placeholders", () => {
    assert.match(versions.agi, /^[0-9a-f]{40}$/);
    assert.match(versions.fundIntel, /^[0-9a-f]{40}$/);
    assert.match(versions.impactRelay, /^[0-9a-f]{40}$/);
    assert.notEqual(versions.specs, "REPLACE_WITH_RELEASE_SHA");
  });
});

describe("CONTRACT-008–012 schema validation", () => {
  for (const [id, payload] of Object.entries(valid)) {
    test(`accepts a valid ${id} payload`, () => {
      const result = validateContract(id, payload);
      assert.equal(result.valid, true, result.errors?.join("; "));
    });
  }

  test("rejects mismatched client_id and tenant_id on CONTRACT-008", () => {
    const result = validateContract("CONTRACT-008", {
      ...valid["CONTRACT-008"],
      tenant_id: "other-tenant",
    });
    assert.equal(result.valid, false);
  });

  test("rejects donor identity on CONTRACT-012", () => {
    const result = validateContract("CONTRACT-012", {
      ...valid["CONTRACT-012"],
      donorEmail: "someone@example.com",
    });
    assert.equal(result.valid, false);
  });

  test("rejects a project-scoped CONTRACT-009 without project_id", () => {
    const result = validateContract("CONTRACT-009", {
      client_id: "hacker-dojo",
      tenant_id: "hacker-dojo",
      scope: "project",
    });
    assert.equal(result.valid, false);
  });
});
