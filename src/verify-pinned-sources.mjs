// Runner: verify the AGI-consumed public documents at their pinned revisions.
//
// Fetches the real Portfolio Signals and Impact Relay public documents at the
// SHAs recorded in refs/versions.json and runs the public-source seam verifier
// (src/public-source-seam.mjs) against them. Also fetches the pinned AGI
// C3 policy files and fails closed if they leave PROPOSED without a coordinated
// status flip. Pinned SHAs are immutable, so the fetched content is deterministic.
//
// Exit non-zero (fail closed) on any SECURITY violation or when a pinned source
// cannot be verified (unfetchable/malformed). A DORMANT-but-safe seam exits 0 -
// the AGI consumer falls closed to its deterministic fixture.
//
// Logs are redacted: source ids, short SHAs, field names, and reason codes only.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyC3Policy } from "./c3-public-data-policy.mjs";
import { verifyPublicSource } from "./public-source-seam.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const versions = JSON.parse(readFileSync(join(root, "refs", "versions.json"), "utf8"));

const SOURCES = [
  {
    id: "portfolio-signals-public-campaign",
    repo: "Autonomous-Giving-Incorporated/Portfolio-Signals",
    sha: versions.fundIntel,
    path: "data/public-campaign.json",
  },
  {
    id: "impact-relay-public-impact",
    repo: "Autonomous-Giving-Incorporated/Impact-Relay",
    sha: versions.impactRelay,
    path: "data/public-impact.json",
  },
];

async function fetchPinned(source, attempts = 3) {
  const url = `https://raw.githubusercontent.com/${source.repo}/${source.sha}/${source.path}`;
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url);
      if (res.status === 200) return await res.text();
      // 404 at a pinned SHA is a real, deterministic problem - do not retry.
      if (res.status === 404) throw new Error(`HTTP 404 at pinned rev`);
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
  }
  throw lastError ?? new Error("unfetchable");
}

async function main() {
  const results = [];
  let blocking = 0;

  for (const source of SOURCES) {
    let raw;
    try {
      raw = await fetchPinned(source);
    } catch (err) {
      blocking += 1;
      results.push({ id: source.id, sha: source.sha.slice(0, 8), outcome: "UNVERIFIABLE", detail: String(err.message || err) });
      continue;
    }
    let doc;
    try {
      doc = JSON.parse(raw);
    } catch {
      blocking += 1;
      results.push({ id: source.id, sha: source.sha.slice(0, 8), outcome: "SECURITY FAIL", detail: "invalid JSON" });
      continue;
    }
    const r = verifyPublicSource(source.id, doc, raw);
    if (r.security !== "PASS") blocking += 1;
    results.push({
      id: source.id,
      sha: source.sha.slice(0, 8),
      outcome: r.security === "PASS" ? `SECURITY PASS / ${r.live}` : "SECURITY FAIL",
      detail: r.security === "PASS" ? r.livenessReasons.join(", ") : r.errors.join("; "),
    });
  }

  const c3Source = {
    repo: "Autonomous-Giving-Incorporated/Autonomous-Giving-Incorporated",
    sha: versions.agi,
  };
  try {
    const [contractsTs, policyMarkdown] = await Promise.all([
      fetchPinned({ ...c3Source, path: "integration/contracts.ts" }),
      fetchPinned({ ...c3Source, path: "docs/PUBLIC_DATA_POLICY.md" }),
    ]);
    const c3 = verifyC3Policy({ contractsTs, policyMarkdown });
    if (c3.security !== "PASS") blocking += 1;
    results.push({
      id: "agi-c3-public-data-policy",
      sha: c3Source.sha.slice(0, 8),
      outcome: c3.security === "PASS" ? "SECURITY PASS / PROPOSED" : "SECURITY FAIL",
      detail: c3.security === "PASS" ? c3.status : c3.errors.join("; "),
    });
  } catch (err) {
    blocking += 1;
    results.push({
      id: "agi-c3-public-data-policy",
      sha: String(c3Source.sha || "").slice(0, 8),
      outcome: "UNVERIFIABLE",
      detail: String(err.message || err),
    });
  }

  console.log("== Pinned public-source seam verification ==");
  for (const r of results) {
    console.log(`  [${r.outcome}] ${r.id}@${r.sha}${r.detail ? `  ${r.detail}` : ""}`);
  }

  if (blocking > 0) {
    console.log(`\nBLOCKED: ${blocking} pinned source(s) failed security or could not be verified. Fail closed.`);
    process.exit(1);
  }
  console.log("\nOK: all pinned sources are safe. Liveness is informational (dormant is a safe, fail-closed state).");
}

main().catch((err) => {
  console.error(`harness runner error: ${err.message || err}`);
  process.exit(1);
});
