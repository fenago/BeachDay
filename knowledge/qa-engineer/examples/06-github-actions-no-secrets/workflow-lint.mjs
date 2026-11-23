// Lint for .github/workflows/*.yml against the rules in docs/04 §4.7 (Vera) plus QA's extra hardening.
// lintWorkflow(text, { strict }) -> string[] of problems. strict=false accepts the literal placeholder <PIN-SHA>
// in `uses:` (the template); strict=true (the real workflow) demands a 40-hex commit SHA.
import { parse } from "yaml";

const SHA = /^[0-9a-f]{40}$/;
const SECRET_NAMES = /ANTHROPIC_API_KEY|GITHUB_TOKEN|GITHUB_READ_TOKEN|SUPABASE_SECRET|SERVICE_ROLE|NETLIFY_AUTH_TOKEN/i;

export function lintWorkflow(text, { strict = true } = {}) {
  const p = [];
  const wf = parse(text);
  const on = wf.on ?? wf[true]; // YAML 1.1 reads a bare `on` as true; yaml 2 keeps "on", this covers both
  const triggers = typeof on === "string" ? [on] : Array.isArray(on) ? on : Object.keys(on ?? {});

  // 1. the token is read-only, at the top and in every job
  const top = wf.permissions;
  if (!top || typeof top !== "object" || Object.keys(top).length !== 1 || top.contents !== "read") p.push("top-level permissions must be exactly { contents: read }");
  for (const [name, job] of Object.entries(wf.jobs ?? {})) {
    if (job.permissions !== undefined) {
      const bad = Object.entries(job.permissions ?? {}).filter(([k, v]) => !(k === "contents" && v === "read") && v !== "none");
      if (typeof job.permissions !== "object" || bad.length) p.push(`job ${name}: permissions may only be contents: read or none`);
    }
    if (!job["timeout-minutes"]) p.push(`job ${name}: set timeout-minutes (a hung job costs minutes)`);
  }

  // 2. triggers are an ALLOW-list: push to main, pull_request, workflow_dispatch. Anything else (schedule, pull_request_target,
  //    workflow_run, issue_comment, ...) is refused until a human and security-engineer add it here on purpose.
  for (const t of triggers) if (!["push", "pull_request", "workflow_dispatch"].includes(t)) p.push(`trigger ${t} is not on the allow-list (push to main, pull_request, workflow_dispatch)`);
  const pushBranches = on && typeof on === "object" ? on.push?.branches : undefined;
  if (triggers.includes("push") && !(Array.isArray(pushBranches) && pushBranches.length === 1 && pushBranches[0] === "main")) p.push("push trigger must be limited to branches: [main]");

  // 3. no secrets anywhere (repository variables, `vars.`, are allowed: they are plain text)
  if (/\bgithub\.token\b/.test(text)) p.push("workflow references github.token (the job token must not be passed on)");
  if (/\bsecrets\./.test(text) || /secrets\s*:\s*inherit/.test(text)) p.push("workflow references secrets");
  if (SECRET_NAMES.test(text.replace(/^\s*#.*$/gm, ""))) p.push("workflow names a Beach Day secret variable");

  // 4. steps
  for (const [name, job] of Object.entries(wf.jobs ?? {})) {
    for (const [i, s] of (job.steps ?? []).entries()) {
      const at = `job ${name} step ${i + 1}`;
      if (s.uses) {
        const [action, ref = ""] = String(s.uses).split("@");
        const placeholder = ref === "<PIN-SHA>";
        if (!SHA.test(ref) && !(placeholder && !strict)) p.push(`${at}: ${action} is not pinned to a full commit SHA`);
        if (/^actions\/checkout$/.test(action) && s.with?.["persist-credentials"] !== false) p.push(`${at}: checkout must set persist-credentials: false (keeps the token out of .git/config, where a test could read it)`);
      }
      // every launcher occurrence is checked, not every line: `npx --no-install a && npx b` must still fail
      if (s.run) for (const m of s.run.matchAll(/\b(npx|npm\s+exec|pnpm\s+dlx|yarn\s+dlx|bunx)\b(\s+(--no-install|--no)\b)?/g)) if (!m[2] || /dlx|bunx|exec/.test(m[1])) p.push(`${at}: ${m[1]} may download an unpinned package; use npx --no-install with a devDependency`);
      if (s.run && /\$\{\{/.test(s.run)) p.push(`${at}: no \${{ }} inside run (pass values through env and quote "$VAR": script-injection guard)`);
    }
  }
  return p;
}
