// lib/allowlist shape: decide whether an agent may propose a write to `path`.
// Order: shape/charset (allow-list of characters) -> segment rules -> DENY (case-insensitive) -> ALLOW (exact case).
// Validate the exact string that will be sent to GitHub; never decode/normalise and then re-check.

const MAX_PATH = 200;
// Strict character allow-list: ASCII letters, digits, "._-" and "/" only.
// Rejects by construction: "\" , NUL/control chars, "%" (encoded tricks), ":" (drive letters, NTFS streams),
// spaces, and all non-ASCII (homoglyphs such as Cyrillic "е", fullwidth "／", combining marks).
const SAFE_CHARS = /^[A-Za-z0-9._\-/]+$/;

// DENY wins. Tested against the lower-cased path so "Netlify.toml" or ".GitHub/" can't slip through.
// Canonical list: docs/04 §6 (ADR-0006 point 9 added vendor/, generated/, version.json).
const DENY = [
  /^public\/_headers$/,         // CSP and security headers
  /^public\/_redirects$/,
  /^public\/sw\.js$/,           // the service worker ...
  /^public\/sw(\/|$)/,          // ... and everything it may import (public/sw/**)
  /^public\/vendor(\/|$)/,      // vendored @supabase/auth-js
  /^public\/generated(\/|$)/,   // build output: config.js
  /^public\/version\.json$/,    // build output
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
// Text types only under public/ (docs/04 §6 TEXT_EXT). No png: proposals are UTF-8 text only.
const ALLOW = [
  /^public\/(?:[^/]+\/)*[^/]+\.(?:html|css|js|json|webmanifest|svg|txt|md)$/,
  /^tests\/.+/,
  /^docs\/.+/,
  /^\.claude\/agents\/[^/]+\.md$/,
  /^\.claude\/skills\/.+\.md$/,
];

// Allowed paths that need a louder warning in the proposal card, with the reason shown to the human.
const WARN = [
  [/^public\/.*\.(?:js|html)$/, "runs in the site origin, next to the Console's tokens"],
  [/^public\/(?:console\.html|js\/console\/)/, "Console code (deny recommended, open for Dr. Lee)"],
  [/^\.claude\//, "changes agent behaviour or model"],
  [/^tests\//, "runs as code in CI"],
];

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
  const warnings = WARN.filter(([r]) => r.test(path)).map(([, why]) => why);
  return { ok: true, sensitive: warnings.length > 0, warnings };
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
    // A lone surrogate is not valid UTF-8: GitHub would store U+FFFD, so the content hash, the reviewed diff
    // and the reconciler's blob SHA would no longer describe the bytes on main.
    if (!f.content.isWellFormed()) errors.push(`${f.path}: not valid UTF-8 (lone surrogate)`);
    if (Buffer.byteLength(f.content, "utf8") > maxBytes) errors.push(`${f.path}: larger than ${maxBytes} bytes`);
    if (f.content.includes("\u0000")) errors.push(`${f.path}: NUL byte (binary?)`);
  }
  return { ok: errors.length === 0, errors };
}

const deny = (reason) => ({ ok: false, reason });
