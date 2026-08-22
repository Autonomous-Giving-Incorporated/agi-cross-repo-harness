import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { evaluateAllocationApproval, verifyLifecycleOrdering } from "../src/lifecycle.mjs";
import { validateContract } from "../src/contract-schemas.mjs";

const tenant = JSON.parse(
  readFileSync(new URL("../fixtures/hacker-dojo-tenant.json", import.meta.url), "utf8"),
);

// A CONTRACT-011-valid single-approval policy for Hacker Dojo, with a threshold
// above which a second approver is required.
const singlePolicy = {
  policyId: "policy-hd-1",
  client_id: "hacker-dojo",
  tenant_id: "hacker-dojo",
  approvalMode: "single",
  requiredApproverRoles: ["tenant_director", "finance_approver"],
  amountThreshold: 1000,
  currency: "USD",
  updatedAt: "2026-08-22T00:00:00.000Z",
};

const dualPolicy = {
  ...singlePolicy,
  policyId: "policy-hd-2",
  approvalMode: "dual",
};

function action(overrides = {}) {
  return {
    actionId: "action-1",
    client_id: "hacker-dojo",
    tenant_id: "hacker-dojo",
    project_id: "project-robotics",
    type: "allocation.execute",
    amount: 250,
    currency: "USD",
    correlationId: "corr-1",
    idempotencyKey: "idem-1",
    ...overrides,
  };
}

function approval(id, overrides = {}) {
  return {
    approverId: id,
    roles: ["tenant_director"],
    tenant_id: "hacker-dojo",
    project_id: "project-robotics",
    correlationId: "corr-1",
    approvedAt: "2026-08-22T00:01:00.000Z",
    ...overrides,
  };
}

describe("lifecycle ordering", () => {
  test("the tenant fixture satisfies recommendation->allocation->delegation ordering", () => {
    for (const project of tenant.projects) {
      const r = verifyLifecycleOrdering(project);
      assert.equal(r.ok, true, `${project.project_id}: ${r.errors.join("; ")}`);
    }
  });

  test("rejects allocation approved before recommendation approved", () => {
    const r = verifyLifecycleOrdering({
      recommendation_status: "proposed",
      allocation_status: "approved",
      delegation_status: "pending",
      impact_status: "pending",
    });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes("recommendation_status='approved'")));
  });

  test("rejects verified impact before delegation authorized", () => {
    const r = verifyLifecycleOrdering({
      recommendation_status: "approved",
      allocation_status: "approved",
      delegation_status: "pending",
      impact_status: "verified",
    });
    assert.equal(r.ok, false);
  });
});

describe("allocation approval - single and dual", () => {
  test("the delegation policies are CONTRACT-011 valid", () => {
    assert.equal(validateContract("CONTRACT-011", singlePolicy).valid, true);
    assert.equal(validateContract("CONTRACT-011", dualPolicy).valid, true);
  });

  test("single mode authorizes with one required-role approver", () => {
    const r = evaluateAllocationApproval({ policy: singlePolicy, action: action(), approvals: [approval("dir-1")] });
    assert.equal(r.authorized, true, r.reasons.join("; "));
    assert.equal(r.mode, "single");
  });

  test("dual mode stays blocked until a second distinct approver acts", () => {
    const one = evaluateAllocationApproval({ policy: dualPolicy, action: action(), approvals: [approval("dir-1")] });
    assert.equal(one.authorized, false);
    assert.equal(one.mode, "dual");

    const two = evaluateAllocationApproval({
      policy: dualPolicy,
      action: action(),
      approvals: [approval("dir-1"), approval("fin-1", { roles: ["finance_approver"] })],
    });
    assert.equal(two.authorized, true, two.reasons.join("; "));
  });

  test("an amount at/over threshold escalates single policy to dual", () => {
    const r = evaluateAllocationApproval({
      policy: singlePolicy,
      action: action({ amount: 2500 }),
      approvals: [approval("dir-1")],
    });
    assert.equal(r.mode, "dual");
    assert.equal(r.authorized, false);
  });

  test("idempotency: the same approver cannot satisfy dual approval twice", () => {
    const r = evaluateAllocationApproval({
      policy: dualPolicy,
      action: action(),
      approvals: [approval("dir-1"), approval("dir-1")],
    });
    assert.equal(r.authorized, false);
    assert.equal(r.satisfiedBy.length, 1);
  });

  test("tenant/project/correlation isolation: mismatched approvals do not count", () => {
    const crossTenant = evaluateAllocationApproval({
      policy: singlePolicy,
      action: action(),
      approvals: [approval("dir-1", { tenant_id: "other-tenant" })],
    });
    assert.equal(crossTenant.authorized, false);

    const crossProject = evaluateAllocationApproval({
      policy: singlePolicy,
      action: action(),
      approvals: [approval("dir-1", { project_id: "project-ai-lab" })],
    });
    assert.equal(crossProject.authorized, false);

    const wrongCorrelation = evaluateAllocationApproval({
      policy: singlePolicy,
      action: action(),
      approvals: [approval("dir-1", { correlationId: "corr-2" })],
    });
    assert.equal(wrongCorrelation.authorized, false);
  });

  test("an approver without a required role does not count", () => {
    const r = evaluateAllocationApproval({
      policy: singlePolicy,
      action: action(),
      approvals: [approval("member-1", { roles: ["member"] })],
    });
    assert.equal(r.authorized, false);
  });
});
