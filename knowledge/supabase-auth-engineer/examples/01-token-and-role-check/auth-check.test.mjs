import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign, randomUUID } from 'node:crypto';
import { makeRequireSuperAdmin } from './auth-check.mjs';

const URL_ = 'https://abcdefgh.supabase.co';
const KEY = 'sb_publishable_TESTONLY';
const b64u = (b) => Buffer.from(b).toString('base64url');

function newKey() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const kid = randomUUID();
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'ES256', use: 'sig', key_ops: ['verify'] };
  return { privateKey, jwk, kid };
}
function sign(k, claims, { kid = k.kid } = {}) {
  const h = b64u(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid }));
  const p = b64u(JSON.stringify(claims));
  const sig = createSign('SHA256').update(`${h}.${p}`).sign({ key: k.privateKey, dsaEncoding: 'ieee-p1363' });
  return `${h}.${p}.${b64u(sig)}`;
}
const now = () => Math.floor(Date.now() / 1000);
const goodClaims = (over = {}) => ({
  iss: `${URL_}/auth/v1`, aud: 'authenticated', role: 'authenticated', sub: 'user-1',
  exp: now() + 600, iat: now(), is_anonymous: false, ...over,
});

const projectKey = newKey();
// Mock network: JWKS for our project, PostgREST for profiles. Counts calls.
function mockFetch({ profiles = { 'user-1': 'super_admin' }, jwks = [projectKey.jwk], restStatus = 200 } = {}) {
  const calls = [];
  const f = async (input, init = {}) => {
    const u = new URL(typeof input === 'string' ? input : input.url);
    calls.push(`${init.method ?? 'GET'} ${u.pathname}`);
    if (u.pathname === '/auth/v1/.well-known/jwks.json')
      return Response.json({ keys: jwks });
    if (u.pathname === '/rest/v1/profiles') {
      if (restStatus !== 200) return new Response('{}', { status: restStatus });
      const id = u.searchParams.get('id').replace('eq.', '');
      const auth = new Headers(init.headers).get('authorization');
      assert.match(auth, /^Bearer ey/, 'role lookup must use the user token, not the key');
      return Response.json(id in profiles ? [{ role: profiles[id] }] : []);
    }
    return new Response('not found', { status: 404 });
  };
  f.calls = calls;
  return f;
}
const req = (token) => new Request('https://site.example/api/x', { headers: token ? { authorization: `Bearer ${token}` } : {} });
const run = (f, token) => makeRequireSuperAdmin({ url: URL_, publishableKey: KEY, fetchImpl: f })(req(token));

test('no token -> 401, and no network call is made', async () => {
  const f = mockFetch();
  assert.deepEqual(await run(f, null), { ok: false, status: 401, reason: 'no_token' });
  assert.equal(f.calls.length, 0);
});
test('garbage token -> 401', async () => {
  assert.equal((await run(mockFetch(), 'not.a-jwt')).status, 401);
});
test('expired token -> 401', async () => {
  const t = sign(projectKey, goodClaims({ exp: now() - 5 }));
  assert.equal((await run(mockFetch(), t)).status, 401);
});
test('bad signature (right kid, tampered payload) -> 401', async () => {
  const t = sign(projectKey, goodClaims({ sub: 'user-1' }));
  const [h, p, s] = t.split('.');
  const forged = JSON.parse(Buffer.from(p, 'base64url'));
  forged.sub = 'user-2';
  assert.equal((await run(mockFetch({ profiles: { 'user-2': 'super_admin' } }), `${h}.${b64u(JSON.stringify(forged))}.${s}`)).status, 401);
});
test('token signed by another project (unknown key) -> 401', async () => {
  const other = newKey();
  assert.equal((await run(mockFetch(), sign(other, goodClaims()))).status, 401);
});
test('wrong project: valid signature but iss points elsewhere -> 401 wrong_project', async () => {
  const t = sign(projectKey, goodClaims({ iss: 'https://zzzzzzzz.supabase.co/auth/v1' }));
  assert.equal((await run(mockFetch(), t)).reason, 'wrong_project');
});
test('wrong audience -> 401', async () => {
  assert.equal((await run(mockFetch(), sign(projectKey, goodClaims({ aud: 'other' })))).reason, 'wrong_audience');
});
test('anonymous user -> 401', async () => {
  assert.equal((await run(mockFetch(), sign(projectKey, goodClaims({ is_anonymous: true })))).reason, 'anonymous');
});
test('role user -> 403', async () => {
  const r = await run(mockFetch({ profiles: { 'user-1': 'user' } }), sign(projectKey, goodClaims()));
  assert.deepEqual([r.ok, r.status, r.reason], [false, 403, 'not_super_admin']);
});
test('role claim in the JWT or user_metadata is ignored', async () => {
  const t = sign(projectKey, goodClaims({ user_metadata: { role: 'super_admin' }, app_metadata: { role: 'super_admin' }, role: 'super_admin' }));
  assert.equal((await run(mockFetch({ profiles: { 'user-1': 'user' } }), t)).status, 403);
});
test('no profile row -> 403', async () => {
  assert.equal((await run(mockFetch({ profiles: {} }), sign(projectKey, goodClaims()))).reason, 'no_profile');
});
test('profile lookup fails (500) -> 403, fails closed', async () => {
  assert.equal((await run(mockFetch({ restStatus: 500 }), sign(projectKey, goodClaims()))).reason, 'profile_lookup_failed');
});
test('JWKS unreachable -> 401, fails closed', async () => {
  const f = async () => { throw new TypeError('network down'); };
  assert.equal((await run(f, sign(projectKey, goodClaims()))).status, 401);
});
test('super_admin with valid token -> ok', async () => {
  const r = await run(mockFetch(), sign(projectKey, goodClaims()));
  assert.deepEqual([r.ok, r.userId], [true, 'user-1']);
});
