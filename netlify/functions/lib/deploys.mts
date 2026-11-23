// Which committed paths cause a production deploy (docs/04 §1, build_plan D9).
// DEPLOY_PATHS must equal the path list in the `ignore` command in netlify.toml: a unit test
// (tests/unit/deploys.test.mjs) parses netlify.toml and fails if they differ. Order is the same too.
// A skipped build is expected to cost 0 credits (UNVERIFIED, docs/03 §8.2).
export const DEPLOY_PATHS: readonly string[] = Object.freeze([
  "public",
  "netlify",
  "netlify.toml",
  "package.json",
  "package-lock.json",
  "scripts",
  ".claude/agents",
  ".claude/skills",
  "knowledge",
]);

// True when `path` is one of the deploy paths or inside a folder on the list. Git paths are case-sensitive.
export function deploysOnPath(path: string): boolean {
  if (typeof path !== "string" || path === "") return false;
  return DEPLOY_PATHS.some((p) => path === p || path.startsWith(p + "/"));
}

// A commit deploys when any changed path does. An empty list means nothing changed, so no deploy.
export function deploysOnCommit(paths: readonly string[]): boolean {
  return Array.isArray(paths) && paths.some(deploysOnPath);
}
