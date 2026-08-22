import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { validateEvidenceRecord, verifyEvidenceAttachment } from "../src/evidence-attachment.mjs";

const ALLOCATION_ID = "c6c2e191-3000-4000-8000-000000000001";
const EVIDENCE_ID = "d6c2e191-3000-4000-8000-000000000001";

function evidence(overrides = {}) {
  return {
    evidenceId: EVIDENCE_ID,
    allocationId: ALLOCATION_ID,
    type: "delivery_photo",
    uri: "https://evidence.example/community-ai-lab/delivery-1",
    capturedAt: "2026-08-03T16:20:00Z",
    source: "Community AI Lab",
    ...overrides,
  };
}

const authorized = [{ allocationId: ALLOCATION_ID, authorized: true }];

describe("evidence record validation (CONTRACT-004)", () => {
  test("accepts the canonical evidence example", () => {
    assert.equal(validateEvidenceRecord(evidence()).valid, true);
  });

  test("rejects a non-UUID evidenceId", () => {
    assert.equal(validateEvidenceRecord(evidence({ evidenceId: "not-a-uuid" })).valid, false);
  });

  test("rejects a non-URI artifact location", () => {
    assert.equal(validateEvidenceRecord(evidence({ uri: "not a uri" })).valid, false);
  });

  test("rejects an unknown extra field (additionalProperties: false)", () => {
    assert.equal(validateEvidenceRecord(evidence({ donorEmail: "x@example.com" })).valid, false);
  });

  test("rejects donor identity residue in an allowed field", () => {
    assert.equal(validateEvidenceRecord(evidence({ source: "donor Alice Patron" })).valid, false);
  });
});

describe("evidence attachment (authorized allocation, append-only)", () => {
  test("accepts evidence attached to an authorized allocation with a fresh id", () => {
    const r = verifyEvidenceAttachment({ authorizedAllocations: authorized, existing: [], evidence: evidence() });
    assert.equal(r.ok, true, r.errors.join("; "));
  });

  test("rejects evidence attached to an unauthorized allocation", () => {
    const r = verifyEvidenceAttachment({
      authorizedAllocations: [{ allocationId: ALLOCATION_ID, authorized: false }],
      existing: [],
      evidence: evidence(),
    });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes("not an authorized allocation")));
  });

  test("rejects evidence for an allocation not in the authorized set", () => {
    const r = verifyEvidenceAttachment({
      authorizedAllocations: authorized,
      existing: [],
      evidence: evidence({ allocationId: "a0000000-0000-4000-8000-000000000999" }),
    });
    assert.equal(r.ok, false);
  });

  test("rejects a re-used evidenceId (append-only chain)", () => {
    const r = verifyEvidenceAttachment({
      authorizedAllocations: authorized,
      existing: [evidence()],
      evidence: evidence({ uri: "https://evidence.example/community-ai-lab/delivery-2" }),
    });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes("append-only")));
  });

  test("accepts a second, distinct evidence record appended to the chain", () => {
    const r = verifyEvidenceAttachment({
      authorizedAllocations: authorized,
      existing: [evidence()],
      evidence: evidence({
        evidenceId: "e7d3f202-3000-4000-8000-000000000002",
        uri: "https://evidence.example/community-ai-lab/delivery-2",
      }),
    });
    assert.equal(r.ok, true, r.errors.join("; "));
  });
});
