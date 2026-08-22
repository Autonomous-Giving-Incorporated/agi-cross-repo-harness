// Lifecycle and approval verification (harness layer 4, synthetic/deterministic).
//
// Enforces the control-plane lifecycle and delegation contract using synthetic
// doubles only - no network, no production auth, no real tokens. Grounded in the
// project lifecycle vocabulary (fixtures/hacker-dojo-tenant.json) and the
// CONTRACT-011 delegation policy schema.
//
// Two capabilities:
//   verifyLifecycleOrdering(project)      - Recommendation precedes Approval
//                                           precedes Allocation precedes Delegation
//                                           precedes verified Impact.
//   evaluateAllocationApproval({...})     - single vs dual approval, threshold-
//                                           triggered dual, distinct authorized
//                                           approvers, tenant/project/correlation
//                                           binding, and idempotent de-duplication.
//
// Both fail closed: an unmet prerequisite or an unsatisfied approval requirement
// blocks execution.

// --- Lifecycle ordering ---

// Prerequisite chain expressed as "if this reached state, the earlier stage must
// already be in its required state". Conservative and matches the fixtures.
const ORDERING_RULES = [
  { when: ["allocation_status", "approved"], requires: ["recommendation_status", "approved"] },
  { when: ["delegation_status", "authorized"], requires: ["allocation_status", "approved"] },
  { when: ["impact_status", "verified"], requires: ["delegation_status", "authorized"] },
];

export function verifyLifecycleOrdering(project) {
  const errors = [];
  if (!project || typeof project !== "object") {
    return { ok: false, errors: ["project is not an object"] };
  }
  for (const rule of ORDERING_RULES) {
    const [whenField, whenValue] = rule.when;
    const [reqField, reqValue] = rule.requires;
    if (project[whenField] === whenValue && project[reqField] !== reqValue) {
      errors.push(`${whenField}='${whenValue}' requires ${reqField}='${reqValue}'`);
    }
  }
  return { ok: errors.length === 0, errors };
}

// --- Allocation approval ---

// An approval only counts when it is bound to the same tenant, project, and
// correlation as the action it authorizes. This enforces tenant/project isolation
// and prevents replaying an approval issued for a different context.
function approvalMatchesAction(approval, action) {
  return (
    approval &&
    typeof approval === "object" &&
    approval.tenant_id === action.tenant_id &&
    approval.project_id === action.project_id &&
    approval.correlationId === action.correlationId
  );
}

function approverHasRequiredRole(approval, requiredRoles) {
  const roles = Array.isArray(approval.roles) ? approval.roles : [];
  return roles.some((role) => requiredRoles.includes(role));
}

// Evaluate whether an allocation action is authorized under a delegation policy
// and a set of approval records. Returns:
//   { authorized, mode, required, satisfiedBy: string[], reasons: string[] }
export function evaluateAllocationApproval({ policy, action, approvals }) {
  const reasons = [];

  if (!policy || !action) {
    return { authorized: false, mode: "unknown", required: 0, satisfiedBy: [], reasons: ["policy and action are required"] };
  }

  // Policy must govern the action's tenant (and project when project-scoped).
  if (policy.tenant_id !== action.tenant_id) {
    reasons.push("policy tenant does not govern this action");
  }
  if (policy.project_id && policy.project_id !== action.project_id) {
    reasons.push("policy project scope does not match the action project");
  }

  const requiredRoles = Array.isArray(policy.requiredApproverRoles) ? policy.requiredApproverRoles : [];

  // Effective mode: explicit dual, or single escalated to dual when the action
  // amount reaches the policy threshold.
  const overThreshold =
    typeof policy.amountThreshold === "number" &&
    typeof action.amount === "number" &&
    action.amount >= policy.amountThreshold;
  const mode = policy.approvalMode === "dual" || overThreshold ? "dual" : "single";
  const required = mode === "dual" ? 2 : 1;

  // Keep only approvals bound to this action and held by a required role, then
  // de-duplicate by approver id (idempotency: one principal cannot count twice).
  const seen = new Set();
  const satisfiedBy = [];
  for (const approval of approvals || []) {
    if (!approvalMatchesAction(approval, action)) continue;
    if (!approverHasRequiredRole(approval, requiredRoles)) continue;
    if (seen.has(approval.approverId)) continue;
    seen.add(approval.approverId);
    satisfiedBy.push(approval.approverId);
  }

  if (satisfiedBy.length < required) {
    reasons.push(`${mode} approval needs ${required} distinct authorized approver(s); have ${satisfiedBy.length}`);
  }

  const authorized = reasons.length === 0;
  return { authorized, mode, required, satisfiedBy, reasons };
}
