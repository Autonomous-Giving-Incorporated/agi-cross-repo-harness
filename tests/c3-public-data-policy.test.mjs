import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { extractPolicyStatus, verifyC3Policy } from "../src/c3-public-data-policy.mjs";

const PROPOSED_CONTRACTS = `export const PUBLIC_DATA_POLICY_STATUS = "PROPOSED" as const;\n`;
const PROPOSED_MARKDOWN = `# Public-data policy (PROPOSED)

**Status: PROPOSED.** This is a decision packet, not an approval.

| Seat | Human | Date (UTC) | Decision | Signature |
|------|-------|------------|----------|-----------|
| Leadership | | | | |
`;

describe("C3 public-data policy status", () => {
  test("accepts the unsigned PROPOSED packet", () => {
    const r = verifyC3Policy({
      contractsTs: PROPOSED_CONTRACTS,
      policyMarkdown: PROPOSED_MARKDOWN,
    });
    assert.equal(r.security, "PASS", r.errors.join("; "));
    assert.equal(r.status, "PROPOSED");
    assert.equal(extractPolicyStatus(PROPOSED_CONTRACTS), "PROPOSED");
  });

  test("accepts the pre-packet PROPOSED draft (no sign-off table)", () => {
    const r = verifyC3Policy({
      contractsTs: PROPOSED_CONTRACTS,
      policyMarkdown: "**Status: PROPOSED.** Not approved.\n",
    });
    assert.equal(r.security, "PASS", r.errors.join("; "));
  });

  test("fails closed when the machine status is flipped", () => {
    const r = verifyC3Policy({
      contractsTs: `export const PUBLIC_DATA_POLICY_STATUS = "approved" as const;\n`,
      policyMarkdown: PROPOSED_MARKDOWN,
    });
    assert.equal(r.security, "FAIL");
    assert.ok(r.errors.some((e) => e.includes("PUBLIC_DATA_POLICY_STATUS")));
  });

  test("fails closed when markdown claims APPROVED", () => {
    const r = verifyC3Policy({
      contractsTs: PROPOSED_CONTRACTS,
      policyMarkdown: "**Status: APPROVED.** Signed.\n",
    });
    assert.equal(r.security, "FAIL");
  });

  test("fails closed when leadership signs but status stays PROPOSED", () => {
    const r = verifyC3Policy({
      contractsTs: PROPOSED_CONTRACTS,
      policyMarkdown: PROPOSED_MARKDOWN.replace(
        "| Leadership | | | | |",
        "| Leadership | Danny | 2026-08-22 | approve | scrimshawlife-ctrl approve |",
      ),
    });
    assert.equal(r.security, "FAIL");
    assert.ok(r.errors.some((e) => e.includes("leadership sign-off")));
  });

  test("fails closed when the status export is missing", () => {
    const r = verifyC3Policy({
      contractsTs: "export const INTEGRATION_CONTRACT_VERSION = \"2026-08-02\";\n",
      policyMarkdown: PROPOSED_MARKDOWN,
    });
    assert.equal(r.security, "FAIL");
    assert.ok(r.errors.some((e) => e.includes("missing PUBLIC_DATA_POLICY_STATUS")));
  });
});
