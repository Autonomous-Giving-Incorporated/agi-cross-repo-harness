// Runner: assert every GitHub Actions `uses:` at the pinned consumer revisions
// names an immutable commit SHA. Mutable tags (`@v4`) fail closed.
//
// Scans this repo's workflows locally, then fetches workflow files from AGI,
// Portfolio Signals, Impact Relay, and Specs at the SHAs in refs/versions.json.
// Specs contract pin (`specs`) stays at v2.0.0; workflow scan uses `specsMain`.
//
// Logs are redacted: repo ids, short SHAs, workflow paths, and uses refs only.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { auditWorkflow } from "./action-pins.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const versions = JSON.parse(readFileSync(join(root, "refs", "versions.json"), "utf8"));

const CONSUMERS = [
  {
    id: "agi",
    repo: "Autonomous-Giving-Incorporated/Autonomous-Giving-Incorporated",
    sha: versions.agi,
  },
  {
    id: "portfolio-signals",
    repo: "Autonomous-Giving-Incorporated/Portfolio-Signals",
    sha: versions.fundIntel,
  },
  {
    id: "impact-relay",
    repo: "Autonomous-Giving-Incorporated/Impact-Relay",
    sha: versions.impactRelay,
  },
  {
    id: "specs",
    repo: "Autonomous-Giving-Incorporated/Autonomous-Giving-Specs",
    sha: versions.specsMain,
  },
];

function authHeaders() {
  const headers = { "User-Agent": "agi-cross-repo-harness", Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

async function fetchJson(url, attempts = 3) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url, { headers: authHeaders() });
      if (res.status === 200) return await res.json();
      if (res.status === 404) throw new Error(`HTTP 404 ${url}`);
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
  }
  throw lastError ?? new Error(`unfetchable ${url}`);
}

async function fetchText(url, attempts = 3) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url, { headers: authHeaders() });
      if (res.status === 200) return await res.text();
      if (res.status === 404) throw new Error(`HTTP 404`);
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
  }
  throw lastError ?? new Error("unfetchable");
}

function scanLocalWorkflows() {
  const dir = join(root, ".github", "workflows");
  const findings = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".yml") && !name.endsWith(".yaml")) continue;
    const path = `.github/workflows/${name}`;
    findings.push(...auditWorkflow(path, readFileSync(join(dir, name), "utf8")));
  }
  return findings;
}

async function listWorkflowPaths(consumer) {
  const url = `https://api.github.com/repos/${consumer.repo}/git/trees/${consumer.sha}?recursive=1`;
  const tree = await fetchJson(url);
  if (!Array.isArray(tree.tree)) throw new Error("malformed git tree");
  return tree.tree
    .filter((entry) => entry.type === "blob" && /^\.github\/workflows\/[^/]+\.ya?ml$/.test(entry.path))
    .map((entry) => entry.path);
}

async function scanConsumer(consumer) {
  const paths = await listWorkflowPaths(consumer);
  const findings = [];
  for (const path of paths) {
    const raw = await fetchText(`https://raw.githubusercontent.com/${consumer.repo}/${consumer.sha}/${path}`);
    findings.push(...auditWorkflow(path, raw));
  }
  return { paths: paths.length, findings };
}

async function main() {
  const rows = [];
  let blocking = 0;

  const local = scanLocalWorkflows();
  rows.push({
    id: "harness",
    sha: "local",
    workflows: "local",
    outcome: local.length === 0 ? "PINNED" : "UNPINNED",
    detail: local.map((f) => `${f.path} ${f.ref}`).join("; "),
  });
  if (local.length) blocking += 1;

  for (const consumer of CONSUMERS) {
    if (!consumer.sha || /REPLACE_WITH/i.test(consumer.sha)) {
      blocking += 1;
      rows.push({ id: consumer.id, sha: "unset", workflows: 0, outcome: "UNVERIFIABLE", detail: "missing pin" });
      continue;
    }
    try {
      const { paths, findings } = await scanConsumer(consumer);
      if (findings.length) blocking += 1;
      rows.push({
        id: consumer.id,
        sha: consumer.sha.slice(0, 8),
        workflows: paths,
        outcome: findings.length === 0 ? "PINNED" : "UNPINNED",
        detail: findings.map((f) => `${f.path} ${f.ref}`).join("; "),
      });
    } catch (err) {
      blocking += 1;
      rows.push({
        id: consumer.id,
        sha: consumer.sha.slice(0, 8),
        workflows: 0,
        outcome: "UNVERIFIABLE",
        detail: String(err.message || err),
      });
    }
  }

  console.log("== Pinned GitHub Actions verification ==");
  for (const r of rows) {
    const extra = r.detail ? `  ${r.detail}` : "";
    console.log(`  [${r.outcome}] ${r.id}@${r.sha}  workflows=${r.workflows}${extra}`);
  }

  if (blocking > 0) {
    console.log(`\nBLOCKED: ${blocking} consumer(s) have unpinned or unverifiable actions. Fail closed.`);
    process.exit(1);
  }
  console.log("\nOK: all scanned workflows pin actions to commit SHAs.");
}

main().catch((err) => {
  console.error(`harness runner error: ${err.message || err}`);
  process.exit(1);
});
