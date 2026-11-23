// POST /api/login — Agent Console password gate (Functions v2 syntax).
// Shows: config.path + method + rateLimit (one of our 2 Free-plan rules),
// own security headers, input validation, secrets only from process.env,
// and a signed session cookie set through context.cookies.
import { createHmac, scryptSync, timingSafeEqual, randomUUID } from "node:crypto";
import { json } from "./lib/http.mjs";

const SESSION_SECONDS = 12 * 60 * 60; // 12 h, matches docs/04

// CONSOLE_PASSWORD_HASH format: "scrypt$<salt base64>$<hash base64>"
function passwordMatches(password, stored) {
  const [alg, saltB64, hashB64] = String(stored ?? "").split("$");
  if (alg !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = scryptSync(password, Buffer.from(saltB64, "base64"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function signSession(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export default async (req, context) => {
  // config.method already limits this to POST in production; keep the check
  // so a direct invocation (tests, netlify dev) behaves the same.
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" }, { allow: "POST" });

  const hash = process.env.CONSOLE_PASSWORD_HASH;
  const secret = process.env.SESSION_SECRET;
  if (!hash || !secret) return json(500, { error: "not_configured" }); // never echo env values

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }
  const password = typeof body?.password === "string" ? body.password : "";
  if (password.length < 1 || password.length > 200) return json(400, { error: "invalid_input" });

  if (!passwordMatches(password, hash)) return json(401, { error: "wrong_password" });

  const exp = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  context.cookies.set({
    name: "bd_session",
    value: signSession({ sid: randomUUID(), exp }, secret),
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/api",
    maxAge: SESSION_SECONDS,
  });
  return json(200, { ok: true, exp });
};

export const config = {
  path: "/api/login",
  method: "POST",
  // Free plan: 2 code-based rules per project; aggregateBy per domain & IP.
  // windowSize is in seconds (max 180). Over the limit Netlify returns 429.
  rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
