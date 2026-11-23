// lib/allowlist shape: decide whether an agent may propose a write to `path`.
// Order: shape/charset (allow-list of characters) -> segment rules -> DENY (case-insensitive) -> ALLOW (exact case).
// Validate the exact string that will be sent to GitHub; never decode/normalise and then re-check.

const MAX_PATH = 200;
// Strict character allow-list: ASCII letters, digits, "._-" and "/" only.
// Rejects by construction: "\" , NUL/control chars, "%" (encoded tricks), ":" (drive letters, NTFS streams),
// spaces, and all non-ASCII (homoglyphs such as Cyrillic "е", fullwidth "／", combining marks).
const SAFE_CHARS = /^[A-Za-z0-9._\-/]+$/;

// DENY wins. Tested against the lower-cased path so "Netlify.toml" or ".GitHub/" can't slip through.
const DENY = [
  /^netlify(\/|$)/,             // netlify/** (functions, incl. this file and approve)
  /^netlify\.toml$/,
  /^\.github(\/|$)/,           // workflows, actions, CODEOWNERS
  /^package(-lock)?\.json$/,    // dependency changes = supply chain
  /^scripts(\/|$)/,             // build scripts run with env access
  /(^|\/)\.env/,                // **/.env*
  /\.(pem|key)$/,               // **/*.pem, **/*.key
  /^\.git(\/|$)/, /(^|\/)\.gitmodules$/, /^\.claude\/settings/,
];

// ALLOW is exact-case: GitHub paths are case-sensitive, so "PUBLIC/x.html" is a different (unlisted) path.
const ALLOW = [
  /^public\/(?:[^/]+\/)*[^/]+\.(?:html|css|js|json|webmanifest|svg|png|txt)$/,
  /^public\/_headers$/,
  /^tests\/.+/,
  /^docs\/.+/,
  /^\.claude\/agents\/[^/]+\.md$/,
  /^\.claude\/skills\/.+\.md$/,
];

// Paths that are allowed but need a louder warning in the proposal card.
const SENSITIVE = [/^public\/_headers$/, /^\.claude\//, /^public\/sw\.js$/];

export function checkPath(path) {
  if (typeof path !== "string") return deny("not a string");
  if (path.length === 0 || path.length > MAX_PATH) return deny("length");
  if (!SAFE_CHARS.test(path)) return deny("characters outside [A-Za-z0-9._-/]");
  if (path.startsWith("/")) return deny("absolute path");
  const segs = path.split("/");
  if (segs.some((s) => s === "")) return deny("empty segment (// or trailing /)");
  if (segs.some((s) => s === "." || s === "..")) return deny("dot segment");
  if (segs.some((s) => s.endsWith("."))) return deny("segment ends with '.'");
  const lower = path.toLowerCase();
  if (DENY.some((r) => r.test(lower))) return deny("deny list");
  if (!ALLOW.some((r) => r.test(path))) return deny("not on allow list");
  return { ok: true, sensitive: SENSITIVE.some((r) => r.test(path)) };
}

/** Whole-proposal checks used at propose time AND again at approve time. */
export function checkProposal(files, { maxFiles = 20, maxBytes = 200 * 1024 } = {}) {
  const errors = [];
  if (!Array.isArray(files) || files.length === 0 || files.length > maxFiles) errors.push(`1-${maxFiles} files required`);
  const seen = new Set();
  for (const f of files ?? []) {
    const r = checkPath(f?.path);
    if (!r.ok) { errors.push(`${JSON.stringify(f?.path)}: ${r.reason}`); continue; }
    const key = f.path.toLowerCase();
    if (seen.has(key)) errors.push(`${f.path}: duplicate (case-insensitive)`);
    seen.add(key);
    if (f.mode !== undefined && f.mode !== "100644") errors.push(`${f.path}: mode ${f.mode} not allowed`);
    if (typeof f.content !== "string") { errors.push(`${f.path}: content must be text`); continue; }
    if (Buffer.byteLength(f.content, "utf8") > maxBytes) errors.push(`${f.path}: larger than ${maxBytes} bytes`);
    if (f.content.includes("\u0000")) errors.push(`${f.path}: NUL byte (binary?)`);
  }
  return { ok: errors.length === 0, errors };
}

const deny = (reason) => ({ ok: false, reason });
