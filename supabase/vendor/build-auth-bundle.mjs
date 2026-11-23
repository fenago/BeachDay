// Rebuilds public/vendor/supabase-auth-js-<version>.mjs from the installed, pinned @supabase/auth-js.
// Run by a human (public/vendor/** is denied to agents): `node supabase/vendor/build-auth-bundle.mjs`.
// tests/unit/vendor-version.test.mjs rebuilds in memory with the same options and fails if the bytes differ.
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
export const AUTH_JS_VERSION = JSON.parse(
  readFileSync(`${root}node_modules/@supabase/auth-js/package.json`, "utf8"),
).version;
export const BUNDLE_PATH = `${root}public/vendor/supabase-auth-js-${AUTH_JS_VERSION}.mjs`;

export const BUILD_OPTIONS = Object.freeze({
  entryPoints: [fileURLToPath(new URL("./entry-auth.js", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "none",
  absWorkingDir: root,
  logLevel: "silent",
});

export async function buildBundle() {
  const out = await build({ ...BUILD_OPTIONS, write: false });
  return Buffer.from(out.outputFiles[0].contents);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const bytes = await buildBundle();
  writeFileSync(BUNDLE_PATH, bytes);
  // auth-js (MIT) plus tslib (0BSD), which esbuild inlines from auth-js's helpers.
  const tslibVersion = JSON.parse(readFileSync(`${root}node_modules/tslib/package.json`, "utf8")).version;
  writeFileSync(`${root}public/vendor/LICENSE-supabase-auth-js.txt`,
    `supabase-auth-js-${AUTH_JS_VERSION}.mjs bundles @supabase/auth-js ${AUTH_JS_VERSION} and tslib ${tslibVersion}.\n\n` +
    `=== @supabase/auth-js ${AUTH_JS_VERSION} ===\n${readFileSync(`${root}node_modules/@supabase/auth-js/LICENSE`, "utf8")}\n` +
    `=== tslib ${tslibVersion} ===\n${readFileSync(`${root}node_modules/tslib/LICENSE.txt`, "utf8")}`);
  console.log(`wrote ${BUNDLE_PATH} bytes=${bytes.length} sha256=${createHash("sha256").update(bytes).digest("hex")}`);
}
