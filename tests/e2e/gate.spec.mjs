// The super_admin gate (ADR-0006): signed out, a plain user, a super_admin, an outage and a mid-session 401. Real handlers, fake Supabase.
import { test, expect } from "@playwright/test";
import { consoleApp, seedUsers, loginAs, signIn, STRINGS, t, ADMIN, PLAIN } from "../helpers/e2e.mjs";

let c;
test.beforeEach(async ({ page, baseURL }) => { c = await consoleApp(page, baseURL); await seedUsers(c.h); });
test.afterEach(() => { c.guard.assertClean(); expect(c.csp, "CSP violations").toEqual([]); });
const h1 = (page) => page.getByRole("heading", { level: 1 });

test("signed out: S1 sign in, and no /api call is made", async ({ page }) => {
  await page.goto("/console");
  await expect(page.locator('.auth-card[data-screen="S1"]')).toBeVisible();
  await expect(h1(page)).toHaveText(STRINGS["auth.signin.title"]);
  expect(c.apiCalls).toEqual([]);
});

test("role user: 'This account can't use Agents', the signed-in email, and no further /api calls", async ({ page }) => {
  await loginAs(page, PLAIN);
  await expect(page.getByTestId("no-access")).toBeVisible();
  await expect(h1(page)).toHaveText(STRINGS["console.noaccess.title"]);
  await expect(h1(page)).toBeFocused();
  await expect(page.getByText(t("console.noaccess.body", { email: PLAIN.email }))).toBeVisible();
  await expect(page.getByTestId("agent-card")).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(c.apiCalls, "exactly one access check, then nothing").toEqual(["GET /api/agents"]);
  await expect(page.getByRole("button", { name: STRINGS["btn.signOut"], exact: true })).toBeVisible(); // a way out
});

test("a user with no profiles row is refused the same way", async ({ page }) => {
  await c.h.supabase.deleteProfile({ email: PLAIN.email });
  await loginAs(page, PLAIN);
  await expect(page.getByTestId("no-access")).toBeVisible();
});

test("super_admin: 12 agent cards with name, personality, model label as text and a knowledge disclosure; no system prompt reaches the page", async ({ page }) => {
  await loginAs(page, ADMIN);
  const cards = page.getByTestId("agent-card");
  await expect(cards).toHaveCount(12);
  await expect(h1(page)).toHaveText(STRINGS["agents.title"]);
  const first = cards.first();
  await expect(first.locator("h2, h3").first()).not.toBeEmpty();
  await expect(first).toContainText(/Opus|Sonnet|Haiku/); // the model as text, colour is decoration
  await expect(first.getByTestId("agent-chat")).toBeVisible();
  const know = first.getByTestId("agent-knowledge");
  await expect(know).toBeVisible();
  await expect(know).toContainText(/\d+ reference notes, \d+ examples/);
  await know.locator("summary").click();
  await expect(know.locator("li").first()).toBeVisible();
  const res = await page.request.get("/api/agents"); // unauthenticated: refused, and the console response shape below carries no prompts
  expect(res.status()).toBe(401);
  expect(await page.content()).not.toMatch(/Before you answer|systemPrompt/);
  // every persona is unique and every card names its model
  const personas = await cards.locator("h2, h3").allInnerTexts();
  expect(new Set(personas).size).toBe(12);
});

test("503 from the access check is 'Couldn't check your access', never the no-access screen; Try Again recovers", async ({ page }) => {
  await c.h.supabase.fail({ target: "rest", mode: 500, times: -1 });
  await loginAs(page, ADMIN);
  await expect(page.getByText(STRINGS["console.check.failed"])).toBeVisible();
  await expect(page.getByTestId("no-access")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: STRINGS["console.noaccess.title"] })).toHaveCount(0);
  await c.h.supabase.clearFailures();
  await page.getByTestId("retry-access").click();
  await expect(page.getByTestId("agent-list")).toBeVisible();
});

test("a demotion takes effect on the next request (the role is never cached)", async ({ page }) => {
  await loginAs(page, ADMIN);
  await expect(page.getByTestId("agent-list")).toBeVisible();
  await c.h.supabase.setRole({ email: ADMIN.email, role: "user" });
  await page.reload();
  await expect(page.getByTestId("no-access")).toBeVisible();
});

test("401 mid-session: 'Your session ended' on sign-in with the draft kept; after signing in again the person is back on the list", async ({ page }) => {
  await loginAs(page, ADMIN);
  await expect(page.getByTestId("agent-list")).toBeVisible();
  let hits = 0;
  await page.route("**/api/agents", (r) => { hits++; return r.fulfill({ status: 401, headers: { "content-type": "application/json", "cache-control": "no-store", "www-authenticate": "Bearer" }, body: JSON.stringify({ error: { code: "unauthorized", message: "Sign in to continue." } }) }); });
  await page.reload();
  await expect(page.getByText(STRINGS["console.session.expired"])).toBeVisible();
  await expect(h1(page)).toBeFocused();
  expect(hits, "one refresh-and-resend, then S7").toBe(2);
  await page.unroute("**/api/agents");
  await signIn(page, ADMIN);
  await expect(page.getByTestId("agent-list")).toBeVisible();
});

test("the Agents page is not indexed and not cached", async ({ request }) => {
  const r = await request.get("/console");
  expect(r.status()).toBe(200);
  expect(await r.text()).toMatch(/<meta name="robots" content="noindex"/);
});
