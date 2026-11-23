// Review-gate router: maps changed file paths to the reviewers they require,
// per the table in .claude/skills/change-proposal-protocol/SKILL.md ("Review gates").
// Pure function, no dependencies (Node 22+). See README.md for the path mapping decisions.

/** Convert a small glob (**, *, {a,b}) to an anchored RegExp. */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // "**/" matches zero or more directories; a trailing "**" matches anything
        if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
      } else {
        re += '[^/]*';
      }
    } else if (c === '{') {
      const end = glob.indexOf('}', i);
      re += '(?:' + glob.slice(i + 1, end).split(',').map(escape).join('|') + ')';
      i = end;
    } else {
      re += escape(c);
    }
  }
  return new RegExp('^' + re + '$');
}
const escape = (s) => s.replace(/[.+?^$()|[\]\\]/g, '\\$&');

/**
 * Gate rules. `table` quotes the row of the skill's review-gate table each rule implements.
 * `blocking` marks reviewers who can block (security-engineer, per the skill).
 */
export const GATES = [
  {
    id: 'functions-config',
    table: '`netlify/functions/**`, `netlify.toml`, `_headers`, env vars',
    paths: ['netlify/functions/**', 'netlify.toml', 'public/_headers', '**/.env*'],
    reviewers: ['security-engineer', 'netlify-engineer'],
  },
  {
    id: 'console-security',
    table: 'Console auth, allow-list, rate limits, GitHub code',
    paths: [
      'netlify/functions/{login,logout,approve}.mts',
      'netlify/functions/proposals/**',
      'netlify/functions/lib/{auth,allowlist,ratelimit,github}.mts',
      'public/js/console/{auth,approve}.js',
    ],
    reviewers: ['security-engineer'],
    blocking: ['security-engineer'],
  },
  {
    id: 'scoring',
    table: 'Scoring thresholds or verdict wording',
    paths: ['public/js/score.js', 'public/js/score-config.js', 'public/js/copy/verdicts.js'],
    reviewers: ['open-meteo-integrator', 'ux-designer-apple-hig'],
  },
  {
    id: 'visual',
    table: 'Visual tokens/components',
    paths: ['public/css/**'],
    reviewers: ['ui-designer-apple-liquid-glass', 'qa-engineer'],
  },
  {
    id: 'pwa',
    table: 'Service worker / manifest',
    paths: ['public/sw.js', 'public/manifest.webmanifest', 'public/offline.html', 'public/icons/**'],
    reviewers: ['pwa-mobile-engineer', 'qa-engineer'],
  },
  {
    id: 'agents',
    table: '`.claude/agents/**`, `.claude/skills/**`',
    paths: ['.claude/agents/**', '.claude/skills/**'],
    reviewers: ['agent-builder', 'orchestrator'],
  },
  {
    id: 'production',
    table: 'Anything going to production',
    // Paths that trigger a Netlify production deploy: exactly the paths in the `[build] ignore`
    // command in docs/03 (`-- public netlify scripts .claude netlify.toml package.json package-lock.json`).
    // `.claude` is included because the Console's agents.json is built from it.
    paths: ['public/**', 'netlify/**', 'scripts/**', '.claude/**', 'netlify.toml', 'package.json', 'package-lock.json'],
    reviewers: ['qa-engineer'],
  },
];

const COMPILED = GATES.map((g) => ({ ...g, res: g.paths.map(globToRegExp) }));

/** Normalise a repo-relative path; returns null for anything unsafe or non-relative. */
export function normalisePath(p) {
  if (typeof p !== 'string' || p === '') return null;
  if (p.includes('\\') || p.startsWith('/') || /^[a-zA-Z]:/.test(p)) return null;
  const parts = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') return null; // never resolve traversal; reject it
    parts.push(seg);
  }
  return parts.join('/');
}

/**
 * Map changed paths to required reviewers.
 * @param {string[]} changedPaths repo-relative paths
 * @returns {{reviewers: string[], blocking: string[], gates: {id:string, table:string, paths:string[]}[],
 *           deploys: boolean, invalid: string[]}}
 */
export function requiredReviewers(changedPaths) {
  const reviewers = new Set();
  const blocking = new Set();
  const gates = new Map();
  const invalid = [];
  for (const raw of changedPaths) {
    const p = normalisePath(raw);
    if (p === null) { invalid.push(raw); continue; }
    for (const g of COMPILED) {
      if (!g.res.some((re) => re.test(p))) continue;
      g.reviewers.forEach((r) => reviewers.add(r));
      (g.blocking || []).forEach((r) => blocking.add(r));
      if (!gates.has(g.id)) gates.set(g.id, { id: g.id, table: g.table, paths: [] });
      gates.get(g.id).paths.push(p);
    }
  }
  // Invalid paths are themselves a security concern: send them to security-engineer.
  if (invalid.length) { reviewers.add('security-engineer'); blocking.add('security-engineer'); }
  const order = ['security-engineer', 'netlify-engineer', 'open-meteo-integrator', 'ux-designer-apple-hig',
    'ui-designer-apple-liquid-glass', 'pwa-mobile-engineer', 'agent-builder', 'orchestrator', 'qa-engineer'];
  const sort = (arr) => [...arr].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return {
    reviewers: sort(reviewers),
    blocking: sort(blocking),
    gates: [...gates.values()],
    deploys: gates.has('production'),
    invalid,
  };
}

// CLI: node review-gates.mjs path1 path2 ...   (or pipe `git diff --name-only`)
if (import.meta.url === `file://${process.argv[1]}`) {
  let paths = process.argv.slice(2);
  if (paths.length === 0 && !process.stdin.isTTY) {
    const { readFileSync } = await import('node:fs');
    paths = readFileSync(0, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
  }
  console.log(JSON.stringify(requiredReviewers(paths), null, 2));
}
