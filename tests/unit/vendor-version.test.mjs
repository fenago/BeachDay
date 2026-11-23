// The vendored browser auth bundle and the functions' auth-js are the same pinned version (ADR-0006,
// secure-by-design "a test asserts the two Supabase versions match"), and the bundle is what the pin builds.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { buildBundle, AUTH_JS_VERSION, BUNDLE_PATH } from "../../supabase/vendor/build-auth-bundle.mjs";
import { AUTH_JS_VERSION as CLIENT_VERSION } from "../../public/js/console/auth.js";

const root = new URL("../../", import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
const vendorDir = new URL("public/vendor/", root);
const bundle = readFileSync(BUNDLE_PATH);
const text = bundle.toString("utf8");
const sha = (b) => createHash("sha256").update(b).digest("hex");

describe("one pinned @supabase/auth-js version everywhere", () => {
  it("package.json pins an exact version (no range)", () => {
    expect(pkg.dependencies["@supabase/auth-js"]).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it("installed = package.json = vendored filename = the import in auth.js", () => {
    const pinned = pkg.dependencies["@supabase/auth-js"];
    expect(AUTH_JS_VERSION).toBe(pinned);
    expect(CLIENT_VERSION).toBe(pinned);
    expect(readdirSync(vendorDir).filter((f) => f.endsWith(".mjs"))).toEqual([`supabase-auth-js-${pinned}.mjs`]);
    const src = readFileSync(new URL("public/js/console/auth.js", root), "utf8");
    expect(src).toContain(`from "../../vendor/supabase-auth-js-${pinned}.mjs"`);
  });
  it("no supabase-js (full client) is a dependency", () => {
    expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })).not.toContain("@supabase/supabase-js");
  });
});

describe("the vendored file is exactly what the pin builds, and fits the CSP", () => {
  it("a fresh in-memory rebuild is byte-identical", async () => {
    expect(sha(await buildBundle())).toBe(sha(bundle));
  }, 30_000);
  it("no bare import specifiers (loads without a bundler or import map)", () => {
    const bare = [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"'./][^"']*)["']/g)].map((m) => m[1]);
    expect(bare).toEqual([]);
  });
  it("no eval( or new Function( (script-src 'self' with no 'unsafe-eval')", () => {
    expect(text).not.toMatch(/\beval\(|new Function\(/);
  });
  it("no secret-looking literal (sb_secret_, a full JWT, a private key)", () => {
    expect(text).not.toMatch(/sb_secret_[A-Za-z0-9_-]{20,}/);
    expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/);
    expect(text).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/);
  });
  it("exports AuthClient and isAuthRetryableFetchError, with the methods the Console calls", async () => {
    const mod = await import(new URL(`public/vendor/supabase-auth-js-${AUTH_JS_VERSION}.mjs`, root).href);
    expect(Object.keys(mod).sort()).toEqual(["AuthClient", "isAuthRetryableFetchError"]);
    const c = new mod.AuthClient({ url: "https://bdlocaltest.supabase.co/auth/v1", persistSession: false, autoRefreshToken: false,
      fetch: async () => Response.json({}) });
    for (const m of ["signUp", "signInWithPassword", "signInWithOAuth", "exchangeCodeForSession", "verifyOtp", "resend",
      "resetPasswordForEmail", "updateUser", "signOut", "getSession", "refreshSession", "onAuthStateChange"]) {
      expect(typeof c[m], m).toBe("function");
    }
    for (const m of ["listFactors", "enroll", "challengeAndVerify"]) expect(typeof c.mfa[m], `mfa.${m}`).toBe("function");
  });
  it("the licence file names the bundled packages and carries their licences", () => {
    const lic = readFileSync(new URL("LICENSE-supabase-auth-js.txt", vendorDir), "utf8");
    expect(lic).toContain(`@supabase/auth-js ${AUTH_JS_VERSION}`);
    expect(lic).toContain("MIT License");
    expect(lic).toMatch(/=== tslib /);
  });
});
