// Shared set-up for the handler tests: Tess's harness IN PROCESS (port 0) runs the REAL handlers with their real
// wiring (guard -> fake Supabase over MSW, github-read/write -> fake GitHub, Anthropic SDK -> fake Messages API,
// Blobs -> fake store). Nothing reaches a real host; fake secrets are built at runtime by the harness.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { startHarness } from "../../harness/server.mjs";
import { parseSse } from "../../helpers/sse.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const schemaDir = join(here, "..", "..", "contracts", "schemas");
const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
const schemas = {};
for (const f of readdirSync(schemaDir).filter((x) => x.endsWith(".schema.json"))) {
  const s = JSON.parse(readFileSync(join(schemaDir, f), "utf8"));
  ajv.addSchema(s);
  schemas[f.replace(".schema.json", "")] = s.$id;
}
/** Returns the ajv errors (empty array when valid). */
export function schemaErrors(name, value) {
  const v = ajv.getSchema(schemas[name]);
  return v(value) ? [] : v.errors.map((e) => `${e.instancePath} ${e.message}`);
}

export const ADMIN = "lee@example.test";
export const USER = "visitor@example.test";
export const PASSWORD = "correct horse battery staple";

export async function setup() {
  const h = await startHarness({ port: 0 });
  const base = h.url;
  return {
    h,
    base,
    async reset() {
      h.reset();
      h.clearDepsAdapters();
      h.supabase.addUser({ email: ADMIN, password: PASSWORD, role: "super_admin" });
      h.supabase.addUser({ email: USER, password: PASSWORD, role: "user" });
    },
    /** A fresh sign-in token (amr password now, last_sign_in_at now): passes the Approve step-up. */
    async token(email = ADMIN) {
      return (await h.supabase.signIn(email, PASSWORD)).access_token;
    },
    req(method, path, { token, body, headers = {}, raw } = {}) {
      const h2 = { ...headers };
      if (token) h2.authorization = `Bearer ${token}`;
      let b;
      if (raw !== undefined) b = raw;
      else if (body !== undefined) { b = JSON.stringify(body); h2["content-type"] ??= "application/json"; }
      if (method === "POST") { h2.origin ??= base; h2["sec-fetch-site"] ??= "same-origin"; }
      return new Request(`${base}${path}`, { method, headers: h2, body: b });
    },
    call(key, request, opts) {
      return h.callHandler(key, request, opts);
    },
    async settled() {
      await Promise.allSettled([...h.state.background]);
    },
    close: () => h.close(),
  };
}

export async function sse(res) {
  return parseSse(await res.text()).map((e) => e.data);
}

export const secHeadersOk = (res) =>
  res.headers.get("cache-control") === "no-store" &&
  res.headers.get("x-content-type-options") === "nosniff" &&
  ![...res.headers.keys()].some((k) => /^access-control-|^set-cookie$/i.test(k));
