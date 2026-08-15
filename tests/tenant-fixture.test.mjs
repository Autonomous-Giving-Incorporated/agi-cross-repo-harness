import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const fixture = JSON.parse(
  await readFile(new URL("../fixtures/hacker-dojo-tenant.json", import.meta.url), "utf8"),
);

test("Hacker Dojo uses one shared client and tenant identity", () => {
  assert.equal(fixture.client_id, "hacker-dojo");
  assert.equal(fixture.tenant_id, fixture.client_id);
});

test("Hacker Dojo contains independently scoped projects", () => {
  assert.ok(fixture.projects.length >= 3);
  const ids = fixture.projects.map((project) => project.project_id);
  assert.equal(new Set(ids).size, ids.length);
  for (const project of fixture.projects) {
    assert.match(project.project_id, /^project-/);
    assert.ok(project.name);
    assert.ok(project.need);
    assert.equal(project.currency, "USD");
  }
});

test("fixture contains no donor identity or private evidence fields", () => {
  const serialized = JSON.stringify(fixture).toLowerCase();
  for (const forbidden of ["donor", "email", "private_evidence", "service_role", "secret"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("approval vocabulary supports default single and optional dual policy", () => {
  const allowed = new Set(["single", "dual"]);
  assert.equal(allowed.has("single"), true);
  assert.equal(allowed.has("dual"), true);
  assert.equal(allowed.has("automatic"), false);
});

test("fixture states preserve approval before allocation intent", () => {
  for (const project of fixture.projects) {
    if (project.allocation_status === "approved") {
      assert.equal(project.recommendation_status, "approved");
    }
  }
});
