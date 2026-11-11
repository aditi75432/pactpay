import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildZip, crc32 } from "../../apps/web/lib/zip.ts";

test("crc32 matches the standard check value", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
});

test("buildZip makes an archive that unzip accepts and extracts byte for byte", () => {
  const big = Buffer.from("x".repeat(5000));
  const bin = Buffer.from([0, 1, 2, 3, 250, 251, 252]);
  const zip = buildZip([{ path: "a/config.js", data: Buffer.from('self.X = "é";') }, { path: "a/big.txt", data: big }, { path: "a/icons/i.png", data: bin }]);
  const dir = mkdtempSync(join(tmpdir(), "zip-"));
  writeFileSync(join(dir, "t.zip"), zip);
  try { execFileSync("unzip", ["-t", join(dir, "t.zip")], { stdio: "pipe" }); }
  catch (e) { if (e.code === "ENOENT") return; throw e; }
  execFileSync("unzip", ["-q", join(dir, "t.zip"), "-d", join(dir, "out")]);
  assert.equal(readFileSync(join(dir, "out/a/config.js"), "utf8"), 'self.X = "é";');
  assert.deepEqual(readFileSync(join(dir, "out/a/big.txt")), big);
  assert.deepEqual(readFileSync(join(dir, "out/a/icons/i.png")), bin);
});

test("buildZip refuses unsafe paths", () => {
  assert.throws(() => buildZip([{ path: "../x", data: Buffer.from("x") }]));
  assert.throws(() => buildZip([{ path: "/etc/x", data: Buffer.from("x") }]));
});
