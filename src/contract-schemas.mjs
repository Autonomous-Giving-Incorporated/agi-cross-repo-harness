import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const CONTRACT_FILES = {
  "CONTRACT-008": "CONTRACT-008-auth-context.json",
  "CONTRACT-009": "CONTRACT-009-tenant-project-context.json",
  "CONTRACT-010": "CONTRACT-010-route-intent.json",
  "CONTRACT-011": "CONTRACT-011-delegation-policy.json",
  "CONTRACT-012": "CONTRACT-012-public-projection.json",
};

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const validators = Object.fromEntries(
  Object.entries(CONTRACT_FILES).map(([id, file]) => {
    const schema = JSON.parse(readFileSync(join(root, "schemas", file), "utf8"));
    return [id, ajv.compile(schema)];
  }),
);

function identityAligned(payload) {
  if (!payload || typeof payload !== "object") return false;
  if (payload.client_id !== payload.tenant_id) return false;
  return true;
}

function publicSafe(payload) {
  if (!payload || typeof payload !== "object") return false;
  const banned = ["donorEmail", "donor_id", "email", "phone", "attendeeNames"];
  return banned.every((key) => !(key in payload));
}

export function validateContract(contractId, payload) {
  const validate = validators[contractId];
  if (!validate) {
    return { valid: false, errors: [`unknown contract ${contractId}`] };
  }
  const schemaOk = validate(payload);
  const errors = (validate.errors || []).map(
    (err) => `${err.instancePath || "/"} ${err.message}`,
  );
  if (!identityAligned(payload)) {
    errors.push("client_id must equal tenant_id");
  }
  if (contractId === "CONTRACT-012" && !publicSafe(payload)) {
    errors.push("public projection must not include donor identity");
  }
  return { valid: schemaOk && errors.length === 0, errors };
}
