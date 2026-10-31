// Moves the per-milestone patch notes out of the repo root into docs/changelog.
// Safe to run more than once. Run from the repo root: node scripts/tidy-docs.mjs
import { existsSync, mkdirSync, readdirSync, renameSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const target = join(root, "docs", "changelog");
mkdirSync(target, { recursive: true });
let moved = 0;
for (const name of readdirSync(root)) {
  if (!/^(PATCH-NOTES-|README-M\d|PACTPAY-M\d)/i.test(name) || !name.endsWith(".md")) continue;
  const destination = join(target, name);
  if (existsSync(destination)) { console.log(`skip (already there): ${name}`); continue; }
  renameSync(join(root, name), destination);
  moved += 1;
  console.log(`moved: ${name}`);
}
console.log(`Done. ${moved} file(s) moved to docs/changelog.`);
