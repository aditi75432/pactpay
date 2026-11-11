// Cross-platform test runner: lists test files itself so it works on Windows (cmd/PowerShell don't expand globs).
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "test");
const files = readdirSync(dir).filter((name) => name.endsWith(".test.mjs")).sort().map((name) => join(dir, name));
const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], { stdio: "inherit", cwd: root });
process.exit(result.status ?? 1);
