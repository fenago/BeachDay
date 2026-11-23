import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// promote-super-admin.sql is what Dr. Lee pastes; the test fills in the placeholder the way he would.
const PROMOTE = readFileSync(new URL('./promote-super-admin.sql', import.meta.url), 'utf8');
const step = (n) => PROMOTE.split(`-- STEP ${n}`)[1].split('-- STEP ')[0].replace(/^[^\n]*\n/, '');  // drop the heading line
const promote = (id) => db.query(step(2).replaceAll('<USER_ID>', id));

// Minimal stand-ins for what Supabase provides: roles, auth.users, auth.uid().
const STUBS = `
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz,
    last_sign_in_at timestamptz, email_change text default '', email_change_sent_at timestamptz,
    raw_user_meta_data jsonb default '{}');
  create table auth.identities (id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade, provider text not null);
  create type auth.factor_type as enum ('totp', 'webauthn', 'phone');
  create type auth.factor_status as enum ('unverified', 'verified');
  create table auth.mfa_factors (id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade, friendly_name text,
    factor_type auth.factor_type not null, status auth.factor_status not null, created_at timestamptz not null default now());
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth, public to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`;
const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
let db;
const asUser = async (id, fn) => {           // behave like the API: role authenticated + a JWT sub
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${id}', false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
};

before(async () => {
  db = new PGlite();
  await db.exec(STUBS);
  await db.exec(readFileSync(new URL('./profiles.sql', import.meta.url), 'utf8'));
  await db.exec(`insert into auth.users (id, email) values ('${A}', 'a@example.com');`);
  await db.exec(`insert into auth.users (id, email, raw_user_meta_data) values ('${B}', 'b@example.com', '{"role":"super_admin"}');`);
});

test('trigger creates a profile with role user; user_metadata role is ignored', async () => {
  const { rows } = await db.query('select id, role from public.profiles order by id');
  assert.deepEqual(rows.map((r) => r.role), ['user', 'user']);
});
test('a user reads only their own row', async () => {
  const rows = await asUser(A, async () => (await db.query('select id from public.profiles')).rows);
  assert.deepEqual(rows.map((r) => r.id), [A]);
});
test('anon reads nothing (no grant)', async () => {
  await db.exec('set role anon');
  try { await assert.rejects(db.query('select * from public.profiles'), /permission denied/); } finally { await db.exec('reset role'); }
});
test('a user cannot update their own role (privilege denied)', async () => {
  await asUser(A, async () => {
    await assert.rejects(db.query(`update public.profiles set role = 'super_admin' where id = '${A}'`), /permission denied/);
  });
  assert.equal((await db.query(`select role from public.profiles where id='${A}'`)).rows[0].role, 'user');
});
test('a user cannot insert a profile or delete one', async () => {
  await asUser(A, async () => {
    await assert.rejects(db.query(`insert into public.profiles (id, role) values (gen_random_uuid(), 'super_admin')`), /permission denied/);
    await assert.rejects(db.query(`delete from public.profiles where id = '${A}'`), /permission denied/);
  });
});
test('role check constraint rejects unknown roles', async () => {
  await assert.rejects(db.query(`update public.profiles set role = 'owner' where id = '${A}'`), /check constraint/);
});
test('the trigger function is not executable by API roles', async () => {
  await asUser(A, async () => {
    await assert.rejects(db.query('select public.handle_new_user()'), /permission denied/);
  });
});
test('promotion refuses a user whose email is not confirmed (0 rows changed)', async () => {
  const r = await promote(A);                       // A has email_confirmed_at = null
  assert.equal(r.affectedRows, 0);
  assert.equal((await db.query(`select role from public.profiles where id='${A}'`)).rows[0].role, 'user');
});
test('step 1 of the promotion file lists confirmation, last sign-in and every identity', async () => {
  await db.exec(`insert into auth.identities (user_id, provider) values ('${A}', 'email'), ('${A}', 'google');`);
  const step1 = step(1).replaceAll('<EMAIL>', 'a@example.com');
  const { rows } = await db.query(step1);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].id, rows[0].email_confirmed_at, [...rows[0].providers].sort()], [A, null, ['email', 'google']]);
});
test('step 1 also lists every MFA factor, so a factor he did not enrol is visible before promotion', async () => {
  const step1 = step(1).replaceAll('<EMAIL>', 'a@example.com');
  assert.equal((await db.query(step1)).rows[0].mfa_factors, null, 'no factors yet');
  await db.exec(`insert into auth.mfa_factors (user_id, factor_type, status, created_at) values
    ('${A}', 'totp', 'verified', '2026-11-20T10:00:00Z'), ('${A}', 'totp', 'unverified', '2026-11-21T10:00:00Z');`);
  assert.deepEqual((await db.query(step1)).rows[0].mfa_factors, ['totp verified 2026-11-20', 'totp unverified 2026-11-21']);
});
test('step 1 also shows a pending email change (new address and when it was requested)', async () => {
  const step1 = step(1).replaceAll('<EMAIL>', 'a@example.com');
  let r = (await db.query(step1)).rows[0];
  assert.deepEqual([r.pending_email_change, r.email_change_sent_at], [null, null], 'none pending');
  await db.exec(`update auth.users set email_change = 'attacker@example.net', email_change_sent_at = '2026-11-22T09:00:00Z' where id = '${A}'`);
  r = (await db.query(step1)).rows[0];
  assert.equal(r.pending_email_change, 'attacker@example.net');
  assert.ok(r.email_change_sent_at);
  await db.exec(`update auth.users set email_change = '', email_change_sent_at = null where id = '${A}'`);
});
test('Dr. Lee by hand: a confirmed user is promoted (1 row); the user then sees super_admin', async () => {
  await db.exec(`update auth.users set email_confirmed_at = now() where id = '${A}'`);
  assert.equal((await promote(A)).affectedRows, 1);
  const rows = await asUser(A, async () => (await db.query('select role from public.profiles')).rows);
  assert.deepEqual(rows, [{ role: 'super_admin' }]);
});
test('promotion cannot be run by an API user (privilege denied)', async () => {
  await asUser(B, async () => {
    await assert.rejects(promote(B), /permission denied/);
  });
});
test('deleting the auth user cascades to the profile', async () => {
  await db.exec(`delete from auth.users where id = '${B}'`);
  assert.equal((await db.query('select count(*)::int as n from public.profiles')).rows[0].n, 1);
});
