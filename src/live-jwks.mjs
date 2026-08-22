// Gated live-issuer JWKS fetch for PLAN-03.
//
// The verifier in src/agi-auth.mjs never fetches a key set. This helper is the
// only network path: it reads AGI_AUTH_* at runtime, fetches a public JWKS, and
// returns a fail-closed result. Default CI leaves the env unset and skips.
//
// Never logs tokens, JWKS bodies, or key material. Never commits a live
// response. Never falls back to a weaker mode.

const PRIVATE_JWK_FIELDS = ["d", "p", "q", "dp", "dq", "qi", "oth", "k"];

function trim(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function isHttpsUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.hostname.length > 0
    );
  } catch {
    return false;
  }
}

function hasPrivateMaterial(key) {
  return PRIVATE_JWK_FIELDS.some((field) => key && key[field]);
}

function isUsablePublicRsaSigKey(key) {
  return Boolean(
    key &&
      key.kty === "RSA" &&
      key.alg === "RS256" &&
      key.use === "sig" &&
      trim(key.kid) &&
      trim(key.n) &&
      trim(key.e) &&
      !hasPrivateMaterial(key),
  );
}

/**
 * Read the live-issuer contract from env.
 * - all three unset → skipped (default CI stays offline)
 * - any set but incomplete / non-HTTPS → rejected (fail closed)
 */
export function readLiveIssuerConfig(env = process.env) {
  const issuer = trim(env.AGI_AUTH_ISSUER);
  const audiencesRaw = trim(env.AGI_AUTH_AUDIENCES);
  const jwksUrl = trim(env.AGI_AUTH_JWKS_URL);
  if (!issuer && !audiencesRaw && !jwksUrl) {
    return { status: "skipped" };
  }
  if (!issuer || !audiencesRaw || !jwksUrl) {
    return { status: "rejected", reason: "incomplete_config" };
  }
  const audiences = audiencesRaw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (audiences.length === 0) {
    return { status: "rejected", reason: "incomplete_config" };
  }
  if (!isHttpsUrl(issuer) || !isHttpsUrl(jwksUrl)) {
    return { status: "rejected", reason: "insecure_url" };
  }
  return { status: "ready", issuer, audiences, jwksUrl };
}

/**
 * Fetch a public JWKS. Fail closed on insecure URLs, network errors,
 * non-OK responses, malformed sets, or any private key material.
 */
export async function fetchLiveJwks(jwksUrl, { fetchImpl = fetch } = {}) {
  if (!isHttpsUrl(jwksUrl)) {
    return { status: "rejected", reason: "insecure_url" };
  }

  try {
    const res = await fetchImpl(jwksUrl, { method: "GET", redirect: "error" });
    if (!res?.ok) {
      return { status: "rejected", reason: "unresolvable" };
    }

    let body;
    try {
      body = await res.json();
    } catch {
      return { status: "rejected", reason: "invalid_jwks" };
    }

    if (!body || !Array.isArray(body.keys) || body.keys.length === 0) {
      return { status: "rejected", reason: "invalid_jwks" };
    }
    if (body.keys.some(hasPrivateMaterial)) {
      return { status: "rejected", reason: "private_material" };
    }
    if (!body.keys.some(isUsablePublicRsaSigKey)) {
      return { status: "rejected", reason: "invalid_jwks" };
    }

    return { status: "ok", jwks: { keys: body.keys } };
  } catch {
    return { status: "rejected", reason: "unresolvable" };
  }
}
