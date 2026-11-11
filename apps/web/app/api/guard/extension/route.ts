import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { buildZip, type ZipEntry } from "../../../../lib/zip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILES = ["manifest.json", "background.js", "content.js", "extract.js", "popup.html", "popup.css", "popup.js", "README.md"];

/** The address the shopper used to reach this app, so the downloaded extension points back at the same deployment. */
function publicOrigin(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host") || url.host;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || (local ? "http" : "https");
  return `${proto === "http" || proto === "https" ? proto : "https"}://${host}`;
}

/**
 * GET /api/guard/extension: the PactPay Guard extension as a zip, with this deployment's address written into
 * config.js. Deploy PactPay anywhere and its /extension page hands out an extension that already talks to it.
 */
export async function GET(request: Request) {
  const dir = path.join(process.cwd(), "public", "guard-extension");
  try {
    const entries: ZipEntry[] = [];
    for (const name of FILES) entries.push({ path: `pactpay-guard/${name}`, data: await readFile(path.join(dir, name)) });
    const icons = await readdir(path.join(dir, "icons"));
    for (const icon of icons.filter((file) => file.endsWith(".png")).sort()) entries.push({ path: `pactpay-guard/icons/${icon}`, data: await readFile(path.join(dir, "icons", icon)) });
    const config = `self.PACTPAY_CONFIG = { baseUrl: ${JSON.stringify(publicOrigin(request))} };\n`;
    entries.push({ path: "pactpay-guard/config.js", data: Buffer.from(config, "utf8") });
    const zip = buildZip(entries);
    return new Response(new Uint8Array(zip), {
      headers: {
        "content-type": "application/zip",
        "content-disposition": 'attachment; filename="pactpay-guard-extension.zip"',
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    console.error("Extension download failed", error instanceof Error ? error.message : "unknown error");
    return new Response("The extension files aren't available on this server. Run `cd extension && npm run pack` and redeploy, or load the extension/ folder from the repository.", { status: 500 });
  }
}
