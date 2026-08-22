// Evidence attachment verification (harness layer 5, synthetic/deterministic).
//
// Verifies the Impact Relay evidence path against the canonical CONTRACT-004
// evidence shape (schemas/CONTRACT-004-evidence.json, vendored from pinned Specs):
//   - the record is schema-valid (UUID ids, URI artifact, RFC 3339 capturedAt);
//   - it attaches only to an authorized allocation;
//   - the evidence chain is append-only (evidenceId never re-used);
//   - it carries no donor identity (aggregate-safe).
//
// Synthetic doubles only - no network, no production evidence, no real URIs.
// Fails closed on any violation.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const evidenceSchema = JSON.parse(
  readFileSync(join(root, "schemas", "CONTRACT-004-evidence.json"), "utf8"),
);
const validateEvidence = ajv.compile(evidenceSchema);

const BANNED_SUBSTRINGS = ["donor", "attendee", "\"email\"", "\"phone\""];

// Validate an evidence record against CONTRACT-004 plus a donor-identity scan.
export function validateEvidenceRecord(evidence) {
  const schemaOk = validateEvidence(evidence);
  const errors = (validateEvidence.errors || []).map(
    (err) => `${err.instancePath || "/"} ${err.message}`,
  );
  if (evidence && typeof evidence === "object") {
    const blob = JSON.stringify(evidence).toLowerCase();
    for (const banned of BANNED_SUBSTRINGS) {
      if (blob.includes(banned.toLowerCase())) {
        errors.push("evidence must not carry donor identity");
        break;
      }
    }
  }
  return { valid: schemaOk && errors.length === 0, errors };
}

// Verify an incoming evidence record attaches to an authorized allocation and
// extends an append-only chain. Returns { ok, errors: string[] }.
//   authorizedAllocations: [{ allocationId, authorized: boolean }]
//   existing:              prior evidence records (for append-only checking)
export function verifyEvidenceAttachment({ authorizedAllocations, existing = [], evidence }) {
  const errors = [];

  const record = validateEvidenceRecord(evidence);
  if (!record.valid) errors.push(...record.errors);

  // Authorization: allocationId must be an explicitly authorized allocation.
  const authorizedIds = new Set(
    (authorizedAllocations || []).filter((a) => a && a.authorized).map((a) => a.allocationId),
  );
  if (evidence && !authorizedIds.has(evidence.allocationId)) {
    errors.push("evidence.allocationId is not an authorized allocation");
  }

  // Append-only: an evidenceId must never be re-used (no mutation/replay).
  const existingIds = new Set((existing || []).map((e) => e && e.evidenceId));
  if (evidence && existingIds.has(evidence.evidenceId)) {
    errors.push("evidenceId already exists; the evidence chain is append-only");
  }

  return { ok: errors.length === 0, errors };
}
