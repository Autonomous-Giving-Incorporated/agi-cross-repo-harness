// Classify GitHub Actions `uses:` refs. A ref is pinned only when it names an
// immutable 40-char commit SHA. Mutable tags (`@v4`, `@v4.4.0`) and branches
// (`@main`) fail closed. Local `./` actions are allowed (they live in-repo).

const USES_RE = /^\s*(?:-\s+)?uses:\s*['"]?([^'"\s#]+)['"]?/gm;
const SHA_RE = /^[0-9a-f]{40}$/i;

export function extractUses(workflowText) {
  const refs = [];
  USES_RE.lastIndex = 0;
  let match;
  while ((match = USES_RE.exec(workflowText)) !== null) {
    refs.push(match[1]);
  }
  return refs;
}

export function classifyUses(ref) {
  if (ref.startsWith("./") || ref.startsWith(".github/")) return "local";
  if (ref.startsWith("docker://")) {
    return ref.includes("@sha256:") ? "pinned" : "unpinned";
  }
  const at = ref.lastIndexOf("@");
  if (at < 0) return "invalid";
  const rev = ref.slice(at + 1);
  return SHA_RE.test(rev) ? "pinned" : "unpinned";
}

export function auditWorkflow(path, workflowText) {
  const findings = [];
  for (const ref of extractUses(workflowText)) {
    const kind = classifyUses(ref);
    if (kind === "pinned" || kind === "local") continue;
    findings.push({ path, ref, kind });
  }
  return findings;
}
