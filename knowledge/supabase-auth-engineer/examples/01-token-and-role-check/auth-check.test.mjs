import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign, randomUUID } from 'node:crypto';
import { AuthClient, isAuthRetryableFetchError } from '@supabase/auth-js';
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
const goodClaims = (over = {}, url = URL_) => ({
  iss: `${url}/auth/v1`, aud: 'authenticated', role: 'authenticated', sub: 'user-1',
  exp: now() + 600, iat: now(), is_anonymous: false, ...over,
});

const projectKey = newKey();
// Mock network: JWKS for our project, PostgREST for profiles, Auth /user. Counts calls.
function mockFetch({ profiles = { 'user-1': 'super_admin' }, jwks = [projectKey.jwk], restStatus = 200, restBody, jwksStatus = 200, userStatus = 401, restHang = false } = {}) {
  const calls = [];
  const f = async (input, init = {}) => {
    const u = new URL(typeof input === 'string' ? input : input.url);
    calls.push(`${init.method ?? 'GET'} ${u.pathname}`);
    if (u.pathname === '/auth/v1/.well-known/jwks.json')
      return jwksStatus === 200 ? Response.json({ keys: jwks }) : new Response('upstream', { status: jwksStatus });
    if (u.pathname === '/auth/v1/user')
      return Response.json({ code: userStatus, error_code: 'bad_jwt', msg: 'invalid JWT' }, { status: userStatus });
    if (u.pathname === '/rest/v1/profiles') {
      if (restHang) return new Promise((_, reject) => {
        // A real pending socket keeps the event loop alive; AbortSignal.timeout's own timer is unref'd in Node.
        const keepAlive = setTimeout(() => reject(new Error('mock: never aborted')), 10_000);
        init.signal?.addEventListener('abort', () => { clearTimeout(keepAlive); reject(init.signal.reason); });
      });
      if (restStatus !== 200) return new Response('{"message":"x"}', { status: restStatus });
      if (restBody !== undefined) return new Response(restBody, { status: 200 });
      const id = u.searchParams.get('id').replace('eq.', '');
      const auth = new Headers(init.headers).get('authorization');
      assert.match(auth, /^Bearer ey/, 'role lookup must use the user token, not the key');
      assert.equal(new Headers(init.headers).get('apikey'), KEY);
      return Response.json(id in profiles ? [{ role: profiles[id] }] : []);
    }
    return new Response('not found', { status: 404 });
  };
  f.calls = calls;
  return f;
}
const req = (token) => new Request('https://site.example/api/x', { headers: token ? { authorization: `Bearer ${token}` } : {} });
const run = (f, token, extra = {}) => makeRequireSuperAdmin({ url: URL_, publishableKey: KEY, fetchImpl: f, ...extra })(req(token));
const view = (r) => [r.ok, r.status, r.reason];
let coldN = 0;
const coldUrl = () => `https://cold${++coldN}x.supabase.co`;  // new project ref = empty JWKS cache slot

// ---- 401: identity ----
test('no token -> 401, and no network call is made', async () => {
  const f = mockFetch();
  assert.deepEqual(await run(f, null), { ok: false, status: 401, reason: 'no_token' });
  assert.equal(f.calls.length, 0);
});
test('Basic auth or two-part token -> 401 no_token', async () => {
  assert.equal((await makeRequireSuperAdmin({ url: URL_, publishableKey: KEY, fetchImpl: mockFetch() })(
    new Request('https://site.example/api/x', { headers: { authorization: 'Basic abc' } }))).reason, 'no_token');
  assert.equal((await run(mockFetch(), 'a.b')).reason, 'no_token');
});
test('garbage three-part token -> 401', async () => {
  assert.deepEqual(view(await run(mockFetch(), 'not.a-jwt.at-all')), [false, 401, 'invalid_token']);
});
test('expired token -> 401', async () => {
  const t = sign(projectKey, goodClaims({ exp: now() - 5 }));
  assert.deepEqual(view(await run(mockFetch(), t)), [false, 401, 'invalid_token']);
});
test('bad signature (right kid, tampered payload) -> 401', async () => {
  const t = sign(projectKey, goodClaims({ sub: 'user-1' }));
  const [h, p, s] = t.split('.');
  const forged = JSON.parse(Buffer.from(p, 'base64url'));
  forged.sub = 'user-2';
  const r = await run(mockFetch({ profiles: { 'user-2': 'super_admin' } }), `${h}.${b64u(JSON.stringify(forged))}.${s}`);
  assert.deepEqual(view(r), [false, 401, 'invalid_token']);
});
test('token signed by another project (unknown kid) -> 401 (auth-js falls back to GET /user, which says 401)', async () => {
  const other = newKey();
  const f = mockFetch();
  assert.deepEqual(view(await run(f, sign(other, goodClaims()))), [false, 401, 'invalid_token']);
  assert.ok(f.calls.includes('GET /auth/v1/user'), 'OBSERVED: unknown kid makes getClaims call the Auth server');
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
test('PostgREST says 401 for the token -> 401', async () => {
  assert.deepEqual(view(await run(mockFetch({ restStatus: 401 }), sign(projectKey, goodClaims()))), [false, 401, 'profile_rejected_token']);
});

// ---- 403: role ----
test('role user -> 403', async () => {
  const r = await run(mockFetch({ profiles: { 'user-1': 'user' } }), sign(projectKey, goodClaims()));
  assert.deepEqual(view(r), [false, 403, 'not_super_admin']);
});
test('role claim in the JWT or user_metadata is ignored', async () => {
  const t = sign(projectKey, goodClaims({ user_metadata: { role: 'super_admin' }, app_metadata: { role: 'super_admin' }, role: 'super_admin' }));
  assert.equal((await run(mockFetch({ profiles: { 'user-1': 'user' } }), t)).status, 403);
});
test('no profile row -> 403', async () => {
  assert.equal((await run(mockFetch({ profiles: {} }), sign(projectKey, goodClaims()))).reason, 'no_profile');
});

// ---- 503: the check could not run (fail closed, never "no access") ----
test('profile lookup 500 -> 503', async () => {
  assert.deepEqual(view(await run(mockFetch({ restStatus: 500 }), sign(projectKey, goodClaims()))), [false, 503, 'unavailable']);
});
test('profile lookup other 4xx (e.g. missing grant, 403) -> 503, not "no access"', async () => {
  assert.deepEqual(view(await run(mockFetch({ restStatus: 403 }), sign(projectKey, goodClaims()))), [false, 503, 'unavailable']);
});
test('profile lookup returns non-JSON -> 503', async () => {
  assert.deepEqual(view(await run(mockFetch({ restBody: '<html>' }), sign(projectKey, goodClaims()))), [false, 503, 'unavailable']);
});
test('profile lookup hangs -> 503 after the timeout', async () => {
  const r = await run(mockFetch({ restHang: true }), sign(projectKey, goodClaims()), { timeoutMs: 50 });
  assert.deepEqual(view(r), [false, 503, 'unavailable']);
});
test('JWKS unreachable on a cold instance -> 503', async () => {
  const cold = coldUrl();
  const f = async () => { throw new TypeError('network down'); };
  const t = sign(projectKey, goodClaims({}, cold));
  const r = await makeRequireSuperAdmin({ url: cold, publishableKey: KEY, fetchImpl: f })(req(t));
  assert.deepEqual(view(r), [false, 503, 'unavailable']);
});
test('JWKS endpoint 502 on a cold instance -> 503', async () => {
  const cold = coldUrl();
  const t = sign(projectKey, goodClaims({}, cold));
  const r = await makeRequireSuperAdmin({ url: cold, publishableKey: KEY, fetchImpl: mockFetch({ jwksStatus: 502 }) })(req(t));
  assert.deepEqual(view(r), [false, 503, 'unavailable']);
});
test('OBSERVED: auth-js keeps the JWKS in a module-wide cache (keyed by storageKey), so a warm instance still verifies when the network drops', async () => {
  // Earlier tests warmed the cache for URL_. The JWKS fetch is never attempted here; only the profile lookup fails.
  const f = async () => { throw new TypeError('network down'); };
  const r = await run(f, sign(projectKey, goodClaims()));
  assert.deepEqual(view(r), [false, 503, 'unavailable']); // got past getClaims, then failed closed at the role check
});
test('OBSERVED: auth-js returns network and 5xx failures as { error } (AuthRetryableFetchError); it does not throw', async () => {
  const auth = new AuthClient({ url: `${URL_}/auth/v1`, headers: { apikey: KEY }, persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
    fetch: async () => { throw new TypeError('network down'); } });
  const res = await auth.getUser(sign(projectKey, goodClaims()));   // the Approve step-up call
  assert.equal(res.data.user, null);
  assert.equal(isAuthRetryableFetchError(res.error), true, 'map this to 503, not 401');
  assert.equal(res.error.status, 0);
});

// ---- allow ----
test('super_admin with valid token -> ok', async () => {
  const r = await run(mockFetch(), sign(projectKey, goodClaims()));
  assert.deepEqual([r.ok, r.userId], [true, 'user-1']);
});
