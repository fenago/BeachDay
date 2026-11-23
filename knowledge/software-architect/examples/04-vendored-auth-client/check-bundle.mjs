// Usage: node check-bundle.mjs <bundle.mjs>
// Checks a vendored browser bundle against ADR-0006: self-contained ESM (no bare imports),
// no eval/new Function (CSP script-src 'self' without 'unsafe-eval'), reports size and sha256,
// and that the auth methods the Console needs exist. Sign-in runs against a fake fetch: no network.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createHash as sha } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const file = process.argv[2];
const src = readFileSync(file);
const text = src.toString('utf8');
let fail = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fail++; };
const bare = [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"'./][^"']*)["']/g)].map((m) => m[1]);
ok(bare.length === 0, `no bare import specifiers${bare.length ? ': ' + [...new Set(bare)].join(', ') : ''}`);
ok(!/\beval\(|new Function\(/.test(text), 'no eval( or new Function( (no unsafe-eval needed)');
console.log(`INFO  bytes=${src.length} gzip=${gzipSync(src).length} sha256=${sha('sha256').update(src).digest('hex')}`);
const mod = await import(pathToFileURL(file).href);
const PROJECT = 'https://example-ref.supabase.co';
const seen = [];
const fakeFetch = async (url, init) => {
  const u = new URL(url); seen.push(`${init?.method || 'GET'} ${u.origin}${u.pathname}`);
  return new Response(JSON.stringify({ access_token: 'x.y.z', token_type: 'bearer', expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r',
    user: { id: '00000000-0000-0000-0000-000000000001', aud: 'authenticated', email: 'a@example.com' } }),
    { status: 200, headers: { 'content-type': 'application/json' } });
};
const auth = new mod.AuthClient({ url: `${PROJECT}/auth/v1`, headers: { apikey: 'sb_publishable_xxxx' },
  fetch: fakeFetch, persistSession: false, autoRefreshToken: false });
for (const m of ['signUp', 'signInWithPassword', 'signInWithOAuth', 'signOut', 'resetPasswordForEmail', 'updateUser',
  'reauthenticate', 'getSession', 'getClaims', 'onAuthStateChange', 'exchangeCodeForSession'])
  ok(typeof auth[m] === 'function', `AuthClient#${m}`);
const { data, error } = await auth.signInWithPassword({ email: 'a@example.com', password: 'placeholder-not-real' });
ok(!error && data?.user?.id, 'signInWithPassword resolves against the fake fetch');
ok(seen.length === 1 && seen[0] === `POST ${PROJECT}/auth/v1/token`, `only call: ${seen.join(', ')}`);
console.log(fail ? `${fail} check(s) failed` : 'ALL BUNDLE CHECKS PASSED');
process.exit(fail ? 1 : 0);
