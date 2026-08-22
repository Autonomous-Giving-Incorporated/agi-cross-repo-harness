import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { auditWorkflow, classifyUses, extractUses } from "../src/action-pins.mjs";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "action-pins");

describe("action pin classifier", () => {
  test("accepts a 40-char commit SHA", () => {
    assert.equal(
      classifyUses("actions/checkout@11d5960a326750d5838078e36cf38b85af677262"),
      "pinned",
    );
  });

  test("rejects mutable tags and branches", () => {
    assert.equal(classifyUses("actions/checkout@v4"), "unpinned");
    assert.equal(classifyUses("actions/checkout@v4.4.0"), "unpinned");
    assert.equal(classifyUses("actions/checkout@main"), "unpinned");
  });

  test("accepts local composite actions", () => {
    assert.equal(classifyUses("./.github/actions/foo"), "local");
  });

  test("requires a digest on docker:// images", () => {
    assert.equal(classifyUses("docker://alpine:3.20"), "unpinned");
    assert.equal(
      classifyUses("docker://alpine@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
      "pinned",
    );
  });
});

describe("workflow audit", () => {
  test("a fully SHA-pinned workflow is clean", () => {
    const text = readFileSync(join(fixtures, "pinned.yml"), "utf8");
    assert.deepEqual(auditWorkflow("pinned.yml", text), []);
    assert.equal(extractUses(text).length, 2);
  });

  test("fails closed on a mutable tag", () => {
    const text = readFileSync(join(fixtures, "unpinned.yml"), "utf8");
    const findings = auditWorkflow("unpinned.yml", text);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].ref, "actions/checkout@v7");
    assert.equal(findings[0].kind, "unpinned");
  });
});
