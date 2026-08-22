// Downstream least-context hand-off verification (harness layer 3, synthetic).
//
// After AGI verifies a route-intent (src/agi-auth.mjs), it hands a minimal
// context to the downstream audience. This verifier confirms the hand-off carries
// ONLY the fields that audience is allowed to receive, is bound to the same
// tenant/project as the intent, and never leaks donor identity - i.e. Fund-Intel
// receives only what its workflow needs, and Impact Relay only authorized
// evidence/delegation context (design layer 3). Synthetic doubles only.
//
// Fails closed: an over-scoped field, a tenant/project mismatch, an unknown
// audience, or donor-identity residue blocks the hand-off.

// Fields common to every downstream hand-off (routing identity).
const COMMON_ALLOWED = new Set([
  "intentId",
  "audience",
  "action",
  "client_id",
  "tenant_id",
  "project_id",
  "correlationId",
]);

// Per-audience additional allowlist. Least privilege: only what each downstream
// needs for its owned workflow.
const AUDIENCE_ALLOWED = {
  "fund-intel": new Set([...COMMON_ALLOWED, "requestedCapability"]),
  "impact-relay": new Set([...COMMON_ALLOWED, "allocationId"]),
};

const BANNED_KEY_SUBSTRINGS = [
  "donor",
  "email",
  "phone",
  "registry",
  "secret",
  "private",
  "attendee",
  "notes",
];

function looksLikeDonorLeak(key) {
  const lower = key.toLowerCase();
  return BANNED_KEY_SUBSTRINGS.some((banned) => lower.includes(banned));
}

// Verify a downstream hand-off payload against a verified route-intent.
// Returns { ok, audience, errors: string[] }.
export function verifyDownstreamHandoff(intent, payload) {
  const errors = [];

  if (!intent || !payload || typeof payload !== "object") {
    return { ok: false, audience: undefined, errors: ["intent and payload are required"] };
  }

  const audience = payload.audience;
  const allowed = AUDIENCE_ALLOWED[audience];
  if (!allowed) {
    return { ok: false, audience, errors: [`unknown or unauthorized audience '${audience}'`] };
  }

  // The hand-off must target the intent's audience and stay in its tenant/project.
  if (payload.audience !== intent.audience) {
    errors.push(`hand-off audience '${payload.audience}' does not match intent audience '${intent.audience}'`);
  }
  if (payload.tenant_id !== intent.tenant_id) {
    errors.push("hand-off tenant does not match the verified intent");
  }
  if (payload.project_id !== intent.project_id) {
    errors.push("hand-off project does not match the verified intent");
  }

  // Least privilege: reject any key the audience is not allowed to receive, and
  // reject anything that looks like donor identity outright.
  for (const key of Object.keys(payload)) {
    if (looksLikeDonorLeak(key)) {
      errors.push(`donor-identity field '${key}' must never be handed downstream`);
      continue;
    }
    if (!allowed.has(key)) {
      errors.push(`field '${key}' is over-scoped for audience '${audience}'`);
    }
  }

  return { ok: errors.length === 0, audience, errors };
}
