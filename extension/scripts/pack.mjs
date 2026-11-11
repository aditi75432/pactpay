// Copies the extension's runtime files into ../apps/web/public/guard-extension/ so the deployed app can serve them
// at /api/guard/extension (with its own address written into config.js). Run after any change:  npm run pack
// Optional: PACTPAY_URL=https://your-app.onrender.com npm run pack   also sets the default address in extension/config.js
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "../apps/web/public/guard-extension");
if (process.env.PACTPAY_URL) {
  const url = process.env.PACTPAY_URL.replace(/\/+$/, "");
  writeFileSync(resolve(root, "config.js"), `/* Which PactPay server this extension talks to. Change it here, or later in the popup under Advanced. */\nself.PACTPAY_CONFIG = { baseUrl: ${JSON.stringify(url)} };\n`);
  console.log("Default server set to", url);
}
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const file of ["manifest.json", "background.js", "content.js", "extract.js", "popup.html", "popup.css", "popup.js", "README.md"]) cpSync(resolve(root, file), resolve(out, file));
cpSync(resolve(root, "icons"), resolve(out, "icons"), { recursive: true });
console.log("Packed extension into", out);
