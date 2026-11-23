// public.profiles: the migration and the by-hand promotion file, run in pglite (Postgres in WASM).
// Supabase's roles, auth.users, auth.identities, auth.mfa_factors and auth.uid() are stand-ins, so this proves
// the SQL's logic and grants, not the hosted project (pre-launch test (i) does that, docs/04 §4.2).
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const MIGRATION = readFileSync(new URL("../../supabase/migrations/20261123000000_profiles.sql", import.meta.url), "utf8");
const PROMOTE = readFileSync(new URL("../../supabase/manual/promote-super-admin.sql", import.meta.url), "utf8");
const step = (n) => PROMOTE.split(`-- STEP ${n}`)[1].split("-- STEP ")[0].replace(/^[^\n]*\n/, "");

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
  -- Supabase's default privileges hand API roles everything on new public tables; the migration must undo that.
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
`;
const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
let db;
const asUser = async (id, fn) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${id}', false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
};
const promote = (id) => db.query(step(2).replaceAll("<USER_ID>", id));
const step1 = () => step(1).replaceAll("<EMAIL>", "a@example.com");

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUBS);
  await db.exec(MIGRATION);
  await db.exec(`insert into auth.users (id, email) values ('${A}', 'a@example.com');`);
  await db.exec(`insert into auth.users (id, email, raw_user_meta_data) values ('${B}', 'b@example.com', '{"role":"super_admin"}');`);
}, 60_000);

describe("profiles migration: the no paths", () => {
  it("anon reads nothing (no grant)", async () => {
    await db.exec("set role anon");
    try { await expect(db.query("select * from public.profiles")).rejects.toThrow(/permission denied/); }
    finally { await db.exec("reset role"); }
  });
  it("a user cannot update their own role, even with Supabase's default grants (privilege denied)", async () => {
    await asUser(A, async () => {
      await expect(db.query(`update public.profiles set role = 'super_admin' where id = '${A}'`)).rejects.toThrow(/permission denied/);
    });
    expect((await db.query(`select role from public.profiles where id='${A}'`)).rows[0].role).toBe("user");
  });
  it("a user cannot insert a profile or delete one", async () => {
    await asUser(A, async () => {
      await expect(db.query(`insert into public.profiles (id, role) values (gen_random_uuid(), 'super_admin')`)).rejects.toThrow(/permission denied/);
      await expect(db.query(`delete from public.profiles where id = '${A}'`)).rejects.toThrow(/permission denied/);
    });
  });
  it("anon cannot write either", async () => {
    await db.exec("set role anon");
    try {
      await expect(db.query(`update public.profiles set role = 'super_admin'`)).rejects.toThrow(/permission denied/);
      await expect(db.query(`insert into public.profiles (id) values ('${A}')`)).rejects.toThrow(/permission denied/);
    } finally { await db.exec("reset role"); }
  });
  it("the trigger function is not executable by API roles", async () => {
    await asUser(A, async () => {
      await expect(db.query("select public.handle_new_user()")).rejects.toThrow(/permission denied/);
    });
  });
  it("the role check constraint rejects unknown roles", async () => {
    await expect(db.query(`update public.profiles set role = 'owner' where id = '${A}'`)).rejects.toThrow(/check constraint/);
  });
  it("RLS is on and the only policy is select-own-row for authenticated", async () => {
    const rls = await db.query("select relrowsecurity from pg_class where oid = 'public.profiles'::regclass");
    expect(rls.rows[0].relrowsecurity).toBe(true);
    const pol = await db.query("select cmd, roles::text[] as roles from pg_policies where schemaname='public' and tablename='profiles'");
    expect(pol.rows).toEqual([{ cmd: "SELECT", roles: ["authenticated"] }]);
  });
  it("promotion refuses a user whose email is not confirmed (0 rows changed)", async () => {
    expect((await promote(A)).affectedRows).toBe(0);
    expect((await db.query(`select role from public.profiles where id='${A}'`)).rows[0].role).toBe("user");
  });
  it("promotion cannot be run by an API user (privilege denied)", async () => {
    await db.exec(`update auth.users set email_confirmed_at = now() where id = '${B}'`);
    await asUser(B, async () => { await expect(promote(B)).rejects.toThrow(/permission denied/); });
    expect((await db.query(`select role from public.profiles where id='${B}'`)).rows[0].role).toBe("user");
  });
});

describe("profiles migration: the yes paths", () => {
  it("the trigger creates a profile with role user; a role in user_metadata is ignored", async () => {
    const { rows } = await db.query("select role from public.profiles order by id");
    expect(rows.map((r) => r.role)).toEqual(["user", "user"]);
  });
  it("a user reads only their own row", async () => {
    const rows = await asUser(A, async () => (await db.query("select id from public.profiles")).rows);
    expect(rows.map((r) => r.id)).toEqual([A]);
  });
  it("step 1 lists confirmation, last sign-in, identities, MFA factors and a pending email change", async () => {
    await db.exec(`insert into auth.identities (user_id, provider) values ('${A}', 'email'), ('${A}', 'google');`);
    let r = (await db.query(step1())).rows;
    expect(r.length).toBe(1);
    expect([r[0].id, r[0].email_confirmed_at, [...r[0].providers].sort(), r[0].mfa_factors, r[0].pending_email_change])
      .toEqual([A, null, ["email", "google"], null, null]);
    await db.exec(`insert into auth.mfa_factors (user_id, factor_type, status, created_at) values
      ('${A}', 'totp', 'verified', '2026-11-20T10:00:00Z');`);
    await db.exec(`update auth.users set email_change = 'attacker@example.net', email_change_sent_at = now() where id = '${A}'`);
    r = (await db.query(step1())).rows;
    expect(r[0].mfa_factors).toEqual(["totp verified 2026-11-20"]);
    expect(r[0].pending_email_change).toBe("attacker@example.net");
    await db.exec(`update auth.users set email_change = '', email_change_sent_at = null where id = '${A}'`);
  });
  it("Dr. Lee by hand: a confirmed user is promoted (1 row); the user then sees super_admin", async () => {
    await db.exec(`update auth.users set email_confirmed_at = now() where id = '${A}'`);
    expect((await promote(A)).affectedRows).toBe(1);
    const rows = await asUser(A, async () => (await db.query("select role from public.profiles")).rows);
    expect(rows).toEqual([{ role: "super_admin" }]);
  });
  it("deleting the auth user cascades to the profile", async () => {
    await db.exec(`delete from auth.users where id = '${B}'`);
    expect((await db.query("select count(*)::int as n from public.profiles")).rows[0].n).toBe(1);
  });
});

describe("files stay what they claim to be", () => {
  it("the migration never mentions the service_role key or user metadata, and never grants writes", () => {
    const code = MIGRATION.replace(/--[^\n]*/g, "");
    expect(code).not.toMatch(/service_role|raw_user_meta_data|user_metadata/i);
    expect(code).not.toMatch(/grant\s+(all|insert|update|delete)/i);
    expect(code).not.toMatch(/super_admin'\s*(where|;)/i); // no promotion inside the migration
  });
  it("the promotion file is not in migrations/ and says so", () => {
    expect(PROMOTE).toMatch(/^-- NOT A MIGRATION/);
  });
});
