/**
 * Fails the Functions build if compiled output omits the AI permission key.
 * Prevents stale `functions/lib` from appearing successful after a source update.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const required = "canUseZelveroAI";
const targets = [
  path.join(root, "lib", "permissions.js"),
  path.join(root, "lib", "shared", "permissions.js"),
];

const missing = [];
for (const file of targets) {
  if (!fs.existsSync(file)) {
    missing.push(`${file} (file missing)`);
    continue;
  }
  const text = fs.readFileSync(file, "utf8");
  if (!text.includes(required)) {
    missing.push(`${file} (missing ${required})`);
  }
}

if (missing.length) {
  console.error(
    "[verify-permissions-build] Stale or incomplete Functions build:\n" +
      missing.map((m) => `  - ${m}`).join("\n") +
      "\nRebuild from source; do not hand-edit lib/.",
  );
  process.exit(1);
}

console.log(
  `[verify-permissions-build] OK — ${required} present in lib/permissions.js and lib/shared/permissions.js`,
);
