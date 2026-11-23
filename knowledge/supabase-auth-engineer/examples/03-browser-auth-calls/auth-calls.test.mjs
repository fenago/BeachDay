import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeAuth } from './auth-calls.mjs';

const URL_ = 'https://abcdefgh.supabase.co';
function setup() {
  const log = [];
  const fetchImpl = async (input, init = {}) => {
    const u = new URL(typeof input === 'string' ? input : input.url);
    const body = init.body ? JSON.parse(init.body) : undefined;
    log.push({ method: init.method ?? 'GET', path: u.pathname, query: Object.fromEntries(u.searchParams), body, apikey: new Headers(init.headers).get('apikey') });
    if (u.pathname === '/auth/v1/token' && u.searchParams.get('grant_type') === 'refresh_token') return Response.json(sessionBody());
    if (u.pathname === '/auth/v1/verify') return Response.json(sessionBody());
    return Response.json({}, { status: 200 });
  };
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  return { log, auth: makeAuth({ url: URL_, publishableKey: 'sb_publishable_TESTONLY', siteOrigin: 'https://beachday.example', fetchImpl, storage }) };
}

test('Google: signInWithOAuth builds the provider URL on the project, with PKCE and our redirect', async () => {
  const { auth, log } = setup();
  const { data, error } = await auth.google();
  assert.equal(error, null);
  const u = new URL(data.url);
  assert.equal(u.origin + u.pathname, `${URL_}/auth/v1/authorize`);
  assert.equal(u.searchParams.get('provider'), 'google');
  assert.equal(u.searchParams.get('redirect_to'), 'https://beachday.example/console');
  assert.equal(u.searchParams.get('code_challenge_method'), 's256');
  assert.ok(u.searchParams.get('code_challenge'));
  assert.equal(log.length, 0, 'building the URL makes no network call');
});
test('log in: password grant, publishable key on the apikey header', async () => {
  const { auth, log } = setup();
  await auth.logIn('a@example.com', 'correct horse battery');
  assert.deepEqual([log[0].method, log[0].path, log[0].query.grant_type, log[0].apikey], ['POST', '/auth/v1/token', 'password', 'sb_publishable_TESTONLY']);
});
test('sign up: /signup with email redirect and PKCE challenge', async () => {
  const { auth, log } = setup();
  await auth.signUp('a@example.com', 'correct horse battery');
  assert.equal(log[0].path, '/auth/v1/signup');
  assert.equal(log[0].query.redirect_to, 'https://beachday.example/console');
  assert.ok(log[0].body.code_challenge);
});
test('forgot password: /recover with the one exact /console redirect (the token_hash link carries type=recovery)', async () => {
  const { auth, log } = setup();
  await auth.forgot('a@example.com');
  assert.equal(log[0].path, '/auth/v1/recover');
  assert.equal(log[0].query.redirect_to, 'https://beachday.example/console');
});
test('every redirect the client sends is the single allow-list entry, with no query or hash', async () => {
  const { auth, log } = setup();
  await auth.signUp('a@example.com', 'correct horse battery');
  await auth.forgot('a@example.com');
  await auth.resendConfirmation('a@example.com');
  const g = new URL((await auth.google()).data.url).searchParams.get('redirect_to');
  const sent = [...log.map((c) => c.query.redirect_to), g];
  assert.deepEqual([...new Set(sent)], ['https://beachday.example/console']);
});
test('log out: our button revokes only this session (scope=local)', async () => {
  const { auth, log } = setup();
  await auth.client.setSession({ access_token: fakeJwt(), refresh_token: 'r' });
  log.length = 0;
  await auth.logOut();
  assert.equal(log.find((c) => c.path === '/auth/v1/logout')?.query.scope, 'local');
});
test('log out: the library default is GLOBAL scope (every device); we override it on purpose', async () => {
  const { auth, log } = setup();
  // Give the client a session so signOut() reaches the server.
  await auth.client.setSession({ access_token: fakeJwt(), refresh_token: 'r' });
  log.length = 0;
  await auth.client.signOut();
  const logout = log.find((c) => c.path === '/auth/v1/logout');
  assert.equal(logout?.query.scope, 'global');
});
function fakeJwt(ttl = 3600) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b({ alg: 'ES256', typ: 'JWT' })}.${b({ sub: 'u', exp: Math.floor(Date.now() / 1000) + ttl, aud: 'authenticated' })}.sig`;
}
const sessionBody = (ttl = 600) => ({ access_token: fakeJwt(ttl), refresh_token: 'r2', expires_in: ttl, expires_at: Math.floor(Date.now() / 1000) + ttl, token_type: 'bearer', user: { id: 'u', aud: 'authenticated' } });
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

test('Console client: autoRefreshToken is on, so a token near expiry is refreshed without a request from the page', async () => {
  const { auth, log } = setup();
  await auth.client.setSession({ access_token: fakeJwt(60), refresh_token: 'r' });   // 60 s left: inside the library's 90 s margin
  await tick(50);                                                                         // first ticker run is on the next loop turn
  auth.client.stopAutoRefresh();
  assert.ok(log.some((c) => c.path === '/auth/v1/token' && c.query.grant_type === 'refresh_token'), 'the ticker refreshed the session');
});
test('ensureFresh(120): refreshes when less than 120 s are left (docs/04 4.1), and not otherwise', async () => {
  const { auth, log } = setup();
  auth.client.stopAutoRefresh();
  await auth.client.setSession({ access_token: fakeJwt(3600), refresh_token: 'r' });
  auth.client.stopAutoRefresh();
  log.length = 0;
  await auth.ensureFresh(120);
  assert.equal(log.filter((c) => c.query.grant_type === 'refresh_token').length, 0, 'an hour left: no refresh');
  await auth.client.setSession({ access_token: fakeJwt(100), refresh_token: 'r' });
  auth.client.stopAutoRefresh();
  log.length = 0;
  const token = await auth.ensureFresh(120);
  assert.equal(log.filter((c) => c.query.grant_type === 'refresh_token').length, 1, '100 s left: one refresh');
  assert.ok(token.startsWith('ey'));
});
test('email link with token_hash: verifyOtp POSTs /verify and needs no code verifier (works in any browser)', async () => {
  const { auth, log } = setup();
  const { error } = await auth.confirmFromEmail('pkce_abc123', 'email');
  auth.client.stopAutoRefresh();
  assert.equal(error, null);
  assert.deepEqual([log[0].method, log[0].path, log[0].body.token_hash, log[0].body.type], ['POST', '/auth/v1/verify', 'pkce_abc123', 'email']);
});
test('email link: an unknown type is refused before any network call', async () => {
  const { auth, log } = setup();
  const { error } = await auth.confirmFromEmail('x', 'magiclink');
  assert.ok(error);
  assert.equal(log.length, 0);
});
test('resend confirmation: POST /resend with type signup and our redirect', async () => {
  const { auth, log } = setup();
  await auth.resendConfirmation('a@example.com');
  assert.deepEqual([log[0].path, log[0].body.type, log[0].body.email], ['/auth/v1/resend', 'signup', 'a@example.com']);
  assert.equal(log[0].query.redirect_to, 'https://beachday.example/console');
});
test('OBSERVED: a PKCE ?code= opened in another browser (no stored verifier) fails locally with pkce_code_verifier_not_found', async () => {
  const { auth, log } = setup();                                   // fresh storage = a different browser or an iOS home-screen app
  const { data, error } = await auth.client.exchangeCodeForSession('some-code');
  assert.equal(data.session, null);
  assert.equal(error?.code, 'pkce_code_verifier_not_found');
  assert.equal(log.length, 0, 'no network call was made');
});
