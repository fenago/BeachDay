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
test('forgot password: /recover with our reset redirect', async () => {
  const { auth, log } = setup();
  await auth.forgot('a@example.com');
  assert.equal(log[0].path, '/auth/v1/recover');
  assert.equal(log[0].query.redirect_to, 'https://beachday.example/console?reset=1');
});
test('log out: our button revokes only this session (scope=local)', async () => {
  const { auth, log } = setup();
  await auth.sb.auth.setSession({ access_token: fakeJwt(), refresh_token: 'r' });
  log.length = 0;
  await auth.logOut();
  assert.equal(log.find((c) => c.path === '/auth/v1/logout')?.query.scope, 'local');
});
test('log out: the library default is GLOBAL scope (every device); we override it on purpose', async () => {
  const { auth, log } = setup();
  // Give the client a session so signOut() reaches the server.
  await auth.sb.auth.setSession({ access_token: fakeJwt(), refresh_token: 'r' });
  log.length = 0;
  await auth.sb.auth.signOut();
  const logout = log.find((c) => c.path === '/auth/v1/logout');
  assert.equal(logout?.query.scope, 'global');
});
function fakeJwt() {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b({ alg: 'ES256', typ: 'JWT' })}.${b({ sub: 'u', exp: Math.floor(Date.now() / 1000) + 3600, aud: 'authenticated' })}.sig`;
}
