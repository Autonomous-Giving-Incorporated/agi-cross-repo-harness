// Public-source seam verification (harness layers 1 + 5, control-plane-independent).
//
// Verifies the public documents the AGI public workbench actually consumes today:
//   - Portfolio Signals data/public-campaign.json  (authority: advisory_only)
//   - Impact Relay     data/public-impact.json      (authority: public_aggregate_only)
//
// These are the AGI-consumed public contracts (see the AGI repo
// docs/THREE_REPO_INTEGRATION.md), distinct from the canonical control-plane
// CONTRACT-012 projection validated in contract-schemas.mjs.
//
// Two result classes:
//   SECURITY (fail closed): unsafe or malformed seam - wrong authority, missing or
//     wrong privacy classification, a privacy flag not false, donor-identity residue,
//     or a missing required field. A security failure blocks acceptance.
//   LIVENESS (report only): the seam is safe but the live projection is dormant, so
//     the AGI consumer correctly falls closed to its deterministic fixture - stale
//     beyond the hard freshness window, no VERIFIED outcome, or a non-live execution
//     state. A dormant seam is a safe state, not a failure.
//
// Pure functions only; no network. Callers supply the parsed document and its raw
// text (raw text enables donor-identity residue scanning even inside nested fields).

const BANNED_SUBSTRINGS = [
  "donor_alice",
  "Alice Patron",
  '"donor_id"',
  '"donorEmail"',
  "donation_reference",
  "finance.operator",
  '"attendeeNames"',
  '"attendee_names"',
];

export const SOURCE_SPECS = {
  "portfolio-signals-public-campaign": {
    authority: "advisory_only",
    classification: "public_aggregate_only",
    requiredFields: ["updatedAt", "authority", "execution"],
    privacyFlagsFalse: [
      "piiAllowed",
      "rawRegistryAllowed",
      "donorHistoryAllowed",
      "privateNotesAllowed",
    ],
  },
  "impact-relay-public-impact": {
    authority: "public_aggregate_only",
    classification: "public_aggregate_only",
    requiredFields: ["updatedAt", "authority", "outcomes"],
    privacyFlagsFalse: [
      "piiAllowed",
      "donorNamesAllowed",
      "individualDonorAttributionAllowed",
      "operatorIdentityAllowed",
    ],
    verifiedOutcomeForLive: true,
  },
};

function ageInDays(updatedAt, now) {
  if (typeof updatedAt !== "string") return null;
  const parsed = Date.parse(updatedAt);
  if (Number.isNaN(parsed)) return null;
  return Math.floor((now - parsed) / 86_400_000);
}

function hasVerifiedOutcome(doc) {
  const outcomes = Array.isArray(doc.outcomes) ? doc.outcomes : [];
  return outcomes.some((o) => {
    const state = o?.evidenceState ?? o?.verificationStatus;
    return String(state).toUpperCase() === "VERIFIED";
  });
}

// Verify one public source document. Returns:
//   { id, security: "PASS"|"FAIL", errors: string[],
//     live: "READY"|"DORMANT", livenessReasons: string[] }
export function verifyPublicSource(sourceId, doc, rawText, options = {}) {
  const { hardFreshnessDays = 7, now = Date.now() } = options;
  const spec = SOURCE_SPECS[sourceId];
  const errors = [];

  if (!spec) {
    return { id: sourceId, security: "FAIL", errors: [`unknown source ${sourceId}`], live: "DORMANT", livenessReasons: [] };
  }
  if (!doc || typeof doc !== "object") {
    return { id: sourceId, security: "FAIL", errors: ["document is not an object"], live: "DORMANT", livenessReasons: [] };
  }

  // --- SECURITY ---
  for (const field of spec.requiredFields) {
    if (!(field in doc)) errors.push(`missing required field '${field}'`);
  }
  if (doc.authority !== spec.authority) {
    errors.push(`authority must be '${spec.authority}'`);
  }
  const privacy = (doc.privacy && typeof doc.privacy === "object") ? doc.privacy : {};
  if (privacy.classification !== spec.classification) {
    errors.push(`privacy.classification must be '${spec.classification}'`);
  }
  for (const flag of spec.privacyFlagsFalse) {
    if (privacy[flag] !== false) errors.push(`privacy.${flag} must be false`);
  }
  if (typeof rawText === "string") {
    for (const banned of BANNED_SUBSTRINGS) {
      if (rawText.includes(banned)) {
        errors.push("banned donor-identity residue detected");
        break;
      }
    }
  }

  // --- LIVENESS (report only) ---
  const livenessReasons = [];
  const age = ageInDays(doc.updatedAt, now);
  if (age === null) {
    livenessReasons.push("updatedAt_unparseable");
  } else if (age > hardFreshnessDays) {
    livenessReasons.push(`stale_${age}d_over_${hardFreshnessDays}d_hard`);
  }
  if (spec.verifiedOutcomeForLive && !hasVerifiedOutcome(doc)) {
    livenessReasons.push("no_verified_outcome");
  }
  const execState = doc.execution?.state;
  if (execState && execState !== "live") {
    livenessReasons.push(`execution_${execState}`);
  }

  return {
    id: sourceId,
    security: errors.length === 0 ? "PASS" : "FAIL",
    errors,
    live: livenessReasons.length === 0 ? "READY" : "DORMANT",
    livenessReasons,
  };
}
