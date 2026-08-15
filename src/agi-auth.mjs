const textDecoder = new TextDecoder();

function decodeBase64Url(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const bytes = Uint8Array.from(Buffer.from(padded, "base64"));
    return bytes;
  } catch {
    return null;
  }
}

function decodeJsonSegment(segment) {
  const bytes = decodeBase64Url(segment);
  if (!bytes) return null;
  try {
    return JSON.parse(textDecoder.decode(bytes));
  } catch {
    return null;
  }
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoDate(value) {
  return nonEmpty(value) && Number.isFinite(Date.parse(value));
}

function hasStringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every(nonEmpty);
}

const ROUTE_ACTIONS = {
  "project.review": { audience: "fund-intel", capability: "project:read" },
  "recommendation.review": {
    audience: "fund-intel",
    capability: "recommendation:review",
  },
  "allocation.propose": {
    audience: "fund-intel",
    capability: "allocation:propose",
  },
  "allocation.approve": {
    audience: "fund-intel",
    capability: "allocation:approve",
  },
  "allocation.execute": {
    audience: "fund-intel",
    capability: "allocation:execute",
  },
  "delegation.authorize": {
    audience: "impact-relay",
    capability: "delegation:authorize",
  },
  "evidence.review": {
    audience: "impact-relay",
    capability: "evidence:review",
  },
  "impact.publish": { audience: "impact-relay", capability: "impact:publish" },
};

function validateAuthContextClaims(payload, { issuer, audience, now }) {
  if (!payload || typeof payload !== "object") return null;
  if (
    payload.issuer !== issuer ||
    payload.audience !== audience ||
    !nonEmpty(payload.subject) ||
    !nonEmpty(payload.tokenId) ||
    !nonEmpty(payload.client_id) ||
    !nonEmpty(payload.tenant_id) ||
    payload.client_id !== payload.tenant_id ||
    !hasStringArray(payload.roles) ||
    !hasStringArray(payload.capabilities) ||
    !isIsoDate(payload.issuedAt) ||
    !isIsoDate(payload.expiresAt)
  ) {
    return null;
  }

  const issuedAt = Date.parse(payload.issuedAt);
  const expiresAt = Date.parse(payload.expiresAt);
  if (issuedAt > now || expiresAt <= now || expiresAt <= issuedAt) return null;

  if (
    typeof payload.scope !== "string" ||
    !["tenant", "project"].includes(payload.scope) ||
    (payload.scope === "project" && !nonEmpty(payload.project_id))
  ) {
    return null;
  }

  return {
    issuer: payload.issuer,
    subject: payload.subject,
    tokenId: payload.tokenId,
    audience: payload.audience,
    client_id: payload.client_id,
    tenant_id: payload.tenant_id,
    ...(payload.project_id ? { project_id: payload.project_id } : {}),
    scope: payload.scope,
    roles: [...payload.roles],
    capabilities: [...payload.capabilities],
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
  };
}

/**
 * Verify an AGI-issued RS256 context using a caller-provided non-production JWKS.
 * This function never fetches a key set and never logs token material.
 */
export async function verifyAgIAuthContextJwt(
  token,
  jwks,
  { issuer, audience, now = Date.now() } = {},
) {
  if (!nonEmpty(token) || !issuer || !audience || !Array.isArray(jwks?.keys)) {
    return null;
  }

  const segments = token.split(".");
  if (segments.length !== 3 || segments.some((segment) => !segment)) return null;

  const header = decodeJsonSegment(segments[0]);
  const payload = decodeJsonSegment(segments[1]);
  const signature = decodeBase64Url(segments[2]);
  if (
    !header ||
    header.alg !== "RS256" ||
    !nonEmpty(header.kid) ||
    !payload ||
    !signature
  ) {
    return null;
  }

  const jwk = jwks.keys.find(
    (candidate) =>
      candidate &&
      candidate.kid === header.kid &&
      candidate.kty === "RSA" &&
      candidate.alg === "RS256" &&
      candidate.use === "sig",
  );
  if (!jwk) return null;

  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const validSignature = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      signature,
      new TextEncoder().encode(`${segments[0]}.${segments[1]}`),
    );
    if (!validSignature) return null;
  } catch {
    return null;
  }

  return validateAuthContextClaims(payload, { issuer, audience, now });
}

/**
 * Bind a proposed server-side route intent to an already verified AGI context.
 * The intent is not a credential and is accepted only for explicit actions.
 */
export function validateRouteIntent(
  context,
  intent,
  { now = Date.now(), maxTtlMs = 5 * 60 * 1000 } = {},
) {
  if (!context || !intent || typeof intent !== "object") return null;
  const actionPolicy = ROUTE_ACTIONS[intent.action];
  if (
    !actionPolicy ||
    intent.audience !== actionPolicy.audience ||
    context.audience !== intent.audience ||
    !nonEmpty(intent.intentId) ||
    !nonEmpty(intent.client_id) ||
    !nonEmpty(intent.tenant_id) ||
    intent.client_id !== intent.tenant_id ||
    intent.client_id !== context.client_id ||
    intent.tenant_id !== context.tenant_id ||
    !nonEmpty(intent.project_id) ||
    (context.project_id && context.project_id !== intent.project_id) ||
    !isIsoDate(intent.requestedAt) ||
    !isIsoDate(intent.expiresAt) ||
    !Array.isArray(context.capabilities) ||
    !context.capabilities.includes(actionPolicy.capability)
  ) {
    return null;
  }

  const requestedAt = Date.parse(intent.requestedAt);
  const expiresAt = Date.parse(intent.expiresAt);
  if (
    requestedAt > now ||
    expiresAt <= now ||
    expiresAt <= requestedAt ||
    expiresAt - requestedAt > maxTtlMs
  ) {
    return null;
  }

  return {
    intentId: intent.intentId,
    audience: intent.audience,
    action: intent.action,
    client_id: intent.client_id,
    tenant_id: intent.tenant_id,
    project_id: intent.project_id,
    requestedAt: intent.requestedAt,
    expiresAt: intent.expiresAt,
    requiredCapability: actionPolicy.capability,
  };
}
