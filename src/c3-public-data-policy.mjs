// C3 public-data policy status (fail closed).
//
// The AGI decision packet stays PROPOSED until named humans fill the
// four-seat sign-off table and flip PUBLIC_DATA_POLICY_STATUS in the
// same change. This verifier rejects invented approval.
//
// Pure functions only; no network. Callers supply the AGI
// integration/contracts.ts text and docs/PUBLIC_DATA_POLICY.md text.

const APPROVED_MARKERS = [
  /PUBLIC_DATA_POLICY_STATUS\s*=\s*"(?!PROPOSED)[^"]+"/,
  /Status:\s*\*\*APPROVED\*\*/i,
  /\*\*Status:\s*APPROVED\.\*\*/i,
];

export function extractPolicyStatus(contractsTs) {
  const match = String(contractsTs).match(
    /PUBLIC_DATA_POLICY_STATUS\s*=\s*"([^"]+)"/,
  );
  return match ? match[1] : null;
}

export function verifyC3Policy({ contractsTs, policyMarkdown }) {
  const errors = [];
  const contracts = String(contractsTs ?? "");
  const markdown = String(policyMarkdown ?? "");

  const status = extractPolicyStatus(contracts);
  if (!status) {
    errors.push("missing PUBLIC_DATA_POLICY_STATUS");
  } else if (status !== "PROPOSED") {
    errors.push(`PUBLIC_DATA_POLICY_STATUS is '${status}', expected PROPOSED`);
  }

  if (!/\*\*Status:\s*PROPOSED\.\*\*/.test(markdown) && !/Status:\s*\*\*PROPOSED\*\*/.test(markdown)) {
    errors.push("policy markdown missing PROPOSED status banner");
  }

  for (const marker of APPROVED_MARKERS) {
    if (marker.test(contracts) || marker.test(markdown)) {
      errors.push("approved marker present without a coordinated C3 flip");
      break;
    }
  }

  const leadership = markdown.match(/\|\s*Leadership\s*\|\s*([^|]*)\|/);
  if (leadership && leadership[1].trim() !== "") {
    errors.push("leadership sign-off cell is filled while status stays PROPOSED");
  }

  return {
    security: errors.length === 0 ? "PASS" : "FAIL",
    status: status ?? "missing",
    errors,
  };
}
