import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { validateRouteIntent } from "../src/agi-auth.mjs";

const NOW = Date.parse("2026-08-15T16:00:00.000Z");

const context = {
  issuer: "https://autogive.app",
  subject: "synthetic-user",
  tokenId: "synthetic-token",
  audience: "fund-intel",
  client_id: "hacker-dojo",
  tenant_id: "hacker-dojo",
  project_id: "project-robotics",
  scope: "project",
  roles: ["tenant_director"],
  capabilities: ["project:read", "allocation:approve"],
  issuedAt: "2026-08-15T15:59:00.000Z",
  expiresAt: "2026-08-15T16:05:00.000Z",
};

const intent = {
  intentId: "intent-project-review",
  audience: "fund-intel",
  action: "project.review",
  client_id: "hacker-dojo",
  tenant_id: "hacker-dojo",
  project_id: "project-robotics",
  requestedAt: "2026-08-15T16:00:00.000Z",
  expiresAt: "2026-08-15T16:05:00.000Z",
};

describe("AGI route-intent binding", () => {
  test("accepts an intent bound to the verified context and capability", () => {
    const validated = validateRouteIntent(context, intent, { now: NOW });
    assert.equal(validated?.requiredCapability, "project:read");
    assert.equal(validated?.project_id, "project-robotics");
  });

  test("rejects an unknown action even when the context is otherwise valid", () => {
    assert.equal(
      validateRouteIntent(context, { ...intent, action: "admin.delete" }, { now: NOW }),
      null,
    );
  });

  test("rejects an action without the required capability", () => {
    assert.equal(
      validateRouteIntent(
        { ...context, capabilities: ["project:read"] },
        { ...intent, action: "allocation.approve" },
        { now: NOW },
      ),
      null,
    );
  });

  test("rejects mismatched tenant, project, and audience", () => {
    assert.equal(
      validateRouteIntent(context, { ...intent, tenant_id: "other-tenant", client_id: "other-tenant" }, { now: NOW }),
      null,
    );
    assert.equal(
      validateRouteIntent(context, { ...intent, project_id: "project-ai-lab" }, { now: NOW }),
      null,
    );
    assert.equal(
      validateRouteIntent(
        { ...context, audience: "impact-relay" },
        { ...intent, audience: "impact-relay" },
        { now: NOW },
      ),
      null,
    );
  });

  test("rejects expired, future, and overlong intents", () => {
    assert.equal(
      validateRouteIntent(
        context,
        { ...intent, expiresAt: "2026-08-15T15:59:59.000Z" },
        { now: NOW },
      ),
      null,
    );
    assert.equal(
      validateRouteIntent(
        context,
        { ...intent, requestedAt: "2026-08-15T16:01:00.000Z" },
        { now: NOW },
      ),
      null,
    );
    assert.equal(
      validateRouteIntent(
        context,
        { ...intent, expiresAt: "2026-08-15T16:06:00.000Z" },
        { now: NOW },
      ),
      null,
    );
  });
});
