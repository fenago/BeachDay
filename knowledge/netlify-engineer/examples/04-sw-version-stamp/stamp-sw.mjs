// scripts/stamp-sw.mjs (example; the real file would live at scripts/stamp-sw.mjs).
// Build step that makes every deploy change the bytes of /sw.js, so browsers
// see a new service worker and phones get updates (docs/03 §9).
//
// Reads  : public/sw.js containing the placeholder  __BUILD_VERSION__
// Writes : public/sw.js (placeholder replaced, in the build container only)
//          public/version.json  { version, commit, builtAt }  (for "Live" and smoke tests)
// Version: first 12 hex chars of COMMIT_REF; else `git rev-parse HEAD`; else a
//          timestamp ("t" + yyyymmddhhmmss). A fallback is used only so the
//          bytes still change; the build log says which source was used.
// Safety : prints ONE line and never prints env. Exits 1 (fails the build) if
//          the placeholder is missing, the file is missing, or the version
//          string is not [A-Za-z0-9._-]. Refuses to edit files outside a
//          Netlify build unless --force, so a local run cannot corrupt the repo.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";

export const PLACEHOLDER = "__BUILD_VERSION__";
const HEX40 = /^[0-9a-f]{40}$/;
const SAFE = /^[A-Za-z0-9._-]{1,64}$/;

export function pickVersion(env, git = defaultGit, now = () => new Date()) {
  const ref = env.COMMIT_REF;
  if (typeof ref === "string" && HEX40.test(ref)) return { version: ref.slice(0, 12), commit: ref, source: "COMMIT_REF" };
  const head = git();
  if (head && HEX40.test(head)) return { version: head.slice(0, 12), commit: head, source: "git" };
  const stamp = "t" + now().toISOString().replace(/\D/g, "").slice(0, 14);
  return { version: stamp, commit: null, source: "timestamp" };
}

function defaultGit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return null;
  }
}

// Returns { version, source, file }; throws on any problem (caller exits 1).
export function stamp({ file, env, git, now }) {
  const { version, commit, source } = pickVersion(env, git, now);
  if (!SAFE.test(version)) throw new Error("version string not safe");
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    throw new Error(`cannot read ${file}`);
  }
  if (!text.includes(PLACEHOLDER)) throw new Error(`${PLACEHOLDER} not found in ${file} (already stamped or removed)`);
  const out = text.split(PLACEHOLDER).join(version);
  if (out.includes(PLACEHOLDER)) throw new Error("placeholder still present after stamping");
  writeFileSync(file, out);
  const builtAt = (now ? now() : new Date()).toISOString();
  writeFileSync(join(dirname(file), "version.json"), JSON.stringify({ version, commit, builtAt }) + "\n");
  return { version, source, file };
}

// CLI: node scripts/stamp-sw.mjs [--file public/sw.js] [--force]
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const fi = args.indexOf("--file");
  const file = fi >= 0 ? args[fi + 1] : "public/sw.js";
  if (process.env.NETLIFY !== "true" && !args.includes("--force")) {
    console.error("stamp-sw: refusing to edit files outside a Netlify build (use --force)");
    process.exit(1);
  }
  try {
    const r = stamp({ file, env: process.env });
    console.log(`stamp-sw: version=${r.version} source=${r.source} file=${r.file}`);
  } catch (e) {
    console.error(`stamp-sw: ${e.message}`);
    process.exit(1);
  }
}
