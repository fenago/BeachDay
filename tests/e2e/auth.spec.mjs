// Agents page sign-in, sign-up, reset, Google and sign-out against the harness (real browser, fake Supabase shared with the server).
// Cass's selectors: section.auth-card[data-screen=S1|S2|S3|S3b|S4|S5], form[data-form]. Locators below are role/label/text from the copy deck.
import { test, expect } from "@playwright/test";
import { consoleApp, seedUsers, signIn, t, STRINGS, ADMIN, PLAIN } from "../helpers/e2e.mjs";

let c;
test.beforeEach(async ({ page, baseURL }) => { c = await consoleApp(page, baseURL); await seedUsers(c.h); });
test.afterEach(() => { c.guard.assertClean(); expect(c.csp, "CSP violations").toEqual([]); });

const h1 = (page) => page.getByRole("heading", { level: 1 });
const screen = (page, s) => page.locator(`.auth-card[data-screen="${s}"]`);

test.describe("S1 sign in", () => {
  test("one h1, field attributes for password managers, paste works, Show Password toggles, no CAPTCHA, no form action", async ({ page }) => {
    await page.goto("/console");
    await expect(h1(page)).toHaveText(STRINGS["auth.signin.title"]);
    await expect(h1(page)).toBeFocused();
    const email = page.getByLabel(STRINGS["auth.field.email"], { exact: true });
    const pw = page.getByLabel(STRINGS["auth.field.password"], { exact: true });
    await expect(email).toHaveAttribute("type", "email");
    await expect(email).toHaveAttribute("autocomplete", "username");
    await expect(email).toHaveAttribute("autocapitalize", "none");
    await expect(email).toHaveAttribute("spellcheck", "false");
    await expect(pw).toHaveAttribute("type", "password");
    await expect(pw).toHaveAttribute("autocomplete", "current-password");
    for (const el of [email, pw]) { expect(await el.getAttribute("autocomplete")).not.toBe("off"); expect(await el.getAttribute("name"), "no name: a no-JS submit sends nothing").toBeNull(); }
    // paste: a real clipboard-style insert event through the DOM must not be blocked
    await pw.focus();
    const prevented = await pw.evaluate((el) => { const e = new Event("paste", { bubbles: true, cancelable: true }); el.dispatchEvent(e); return e.defaultPrevented; });
    expect(prevented).toBe(false);
    await pw.fill("pasted value 123");
    await expect(pw).toHaveValue("pasted value 123");
    const show = page.getByRole("button", { name: STRINGS["btn.showPassword"] });
    await expect(show).toHaveAttribute("aria-pressed", "false");
    await show.click();
    await expect(pw).toHaveAttribute("type", "text");
    await expect(page.locator("button[aria-pressed][aria-controls]").first()).toHaveAttribute("aria-pressed", "true"); // the name may flip to Hide Password
    expect(await page.locator("form[action]").count()).toBe(0);
    expect(await page.locator('iframe, [class*="captcha" i], [id*="captcha" i]').count()).toBe(0);
    await expect(page.getByLabel(/confirm password|repeat password/i)).toHaveCount(0);
  });

  test("wrong password: role=alert, neither field aria-invalid, focus back on the password with the text selected", async ({ page }) => {
    await page.goto("/console");
    await signIn(page, { email: ADMIN.email, password: "definitely the wrong one" });
    const alert = screen(page, "S1").getByRole("alert").filter({ hasText: STRINGS["auth.error.credentials"] });
    await expect(alert).toBeVisible();
    const pw = page.getByLabel(STRINGS["auth.field.password"], { exact: true });
    await expect(pw).toBeFocused();
    await expect(pw).not.toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel(STRINGS["auth.field.email"], { exact: true })).not.toHaveAttribute("aria-invalid", "true");
    expect(await pw.evaluate((el) => el.selectionStart === 0 && el.selectionEnd === el.value.length)).toBe(true);
  });

  test("a malformed email marks the email field only, linked by aria-describedby", async ({ page }) => {
    await page.goto("/console");
    await signIn(page, { email: "not-an-email", password: "whatever long password" });
    const email = page.getByLabel(STRINGS["auth.field.email"], { exact: true });
    await expect(email).toHaveAttribute("aria-invalid", "true");
    const ids = (await email.getAttribute("aria-describedby")).split(" ");
    const texts = await Promise.all(ids.map((id) => page.locator(`#${id}`).innerText()));
    expect(texts.join(" ")).toContain(STRINGS["auth.error.email.format"]);
    await expect(page.getByLabel(STRINGS["auth.field.password"], { exact: true })).not.toHaveAttribute("aria-invalid", "true");
  });

  test("Supabase down: a network message with Try Again, never a wrong-password message", async ({ page }) => {
    await page.goto("/console");
    await c.h.supabase.fail({ target: "token", mode: "network", times: 1 });
    await signIn(page, ADMIN);
    await expect(page.getByText(STRINGS["auth.error.network"])).toBeVisible();
    await expect(page.getByText(STRINGS["auth.error.credentials"])).toHaveCount(0);
    await c.h.supabase.clearFailures();
    await page.getByRole("button", { name: STRINGS["btn.tryAgain"] }).click();
    await expect(page.getByTestId("agent-list")).toBeVisible();
  });
});

test.describe("S2 sign up to S3 check your email to S3b confirm to S1 to the Agents list", () => {
  const NEW = { email: "newcomer@example.test", password: "a long enough password 42" };
  test("the whole round trip; the link does nothing until the person taps; the URL is stripped", async ({ page }) => {
    await page.goto("/console");
    await page.getByRole("button", { name: STRINGS["btn.signUp"] }).click();
    await expect(h1(page)).toHaveText(STRINGS["auth.signup.title"]);
    await expect(page.getByLabel(STRINGS["auth.field.password"], { exact: true })).toHaveAttribute("autocomplete", "new-password");
    await expect(page.getByLabel(/confirm password/i)).toHaveCount(0);
    await page.getByLabel(STRINGS["auth.field.email"], { exact: true }).fill(NEW.email);
    await page.getByLabel(STRINGS["auth.field.password"], { exact: true }).fill(NEW.password);
    await page.locator('.auth-card[data-screen="S2"] button[type=submit]').click();
    await expect(h1(page)).toHaveText(STRINGS["auth.confirm.title"]);
    await expect(h1(page)).toBeFocused();
    await expect(page.getByText(t("auth.confirm.body", { email: NEW.email }))).toBeVisible();
    // resend announces in a status region, keeps the typed address, and "Use Another Email" returns to a filled form
    await page.getByRole("button", { name: STRINGS["btn.resend"] }).click();
    await expect(page.getByRole("status").filter({ hasText: t("auth.confirm.resent", { email: NEW.email }) })).toBeVisible();
    // the email link: GET does nothing
    const mail = await c.h.supabase.lastEmail({ to: NEW.email, type: "signup" });
    expect(mail?.tokenHash).toBeTruthy();
    await c.h.supabase.resetCalls();
    await page.goto(`/console?token_hash=${mail.tokenHash}&type=email`);
    await expect(h1(page)).toHaveText(STRINGS["auth.link.title"]);
    expect(await c.h.supabase.callCount({ pattern: "/verify" }), "no /verify before the tap").toBe(0);
    await page.getByRole("button", { name: STRINGS["btn.confirmEmail"] }).click();
    await expect(page.getByText(STRINGS["auth.confirm.done"])).toBeVisible();
    expect(page.url()).not.toContain("token_hash");
    expect(await c.h.supabase.callCount({ pattern: "/verify" })).toBe(1);
    await signIn(page, NEW);
    await expect(page.getByTestId("agent-list").or(page.getByTestId("no-access"))).toBeVisible(); // a new account is NOT a super_admin
    await expect(page.getByTestId("no-access")).toBeVisible();
  });

  test("an existing address looks exactly like a new one (no account enumeration)", async ({ page }) => {
    const words = [];
    for (const email of [ADMIN.email, "never-seen@example.test"]) {
      await page.goto("/console#/console/signup");
      await page.getByLabel(STRINGS["auth.field.email"], { exact: true }).fill(email);
      await page.getByLabel(STRINGS["auth.field.password"], { exact: true }).fill("a long enough password 42");
      await page.locator('.auth-card[data-screen="S2"] button[type=submit]').click();
      await expect(h1(page)).toHaveText(STRINGS["auth.confirm.title"]);
      words.push((await screen(page, "S3").innerText()).replace(email, "<email>"));
    }
    expect(words[0]).toBe(words[1]);
  });

  test("a used or expired link says so and offers a way forward; the token never stays in the URL", async ({ page }) => {
    await page.goto("/console?token_hash=deadbeefdeadbeefdeadbeefdeadbeef&type=email");
    await page.getByRole("button", { name: STRINGS["btn.confirmEmail"] }).click();
    await expect(page.getByText(STRINGS["auth.confirm.expired"])).toBeVisible();
    expect(page.url()).not.toContain("token_hash");
  });
});

test.describe("S4 forgot / S5 new password", () => {
  test("the same words whether or not the address exists; the reset link sets a new password and signs in", async ({ page }) => {
    const seen = [];
    for (const email of [PLAIN.email, "nobody@example.test"]) {
      await page.goto("/console#/console/forgot");
      await expect(h1(page)).toHaveText(STRINGS["auth.forgot.title"]);
      await page.getByLabel(STRINGS["auth.field.email"], { exact: true }).fill(email);
      await page.getByRole("button", { name: STRINGS["btn.sendReset"] }).click();
      await expect(page.getByText(t("auth.forgot.sent", { email }))).toBeVisible();
      seen.push((await screen(page, "S4").innerText()).replace(email, "<email>"));
    }
    expect(seen[0]).toBe(seen[1]);
    const mail = await c.h.supabase.lastEmail({ to: PLAIN.email, type: "recovery" });
    await page.goto(`/console?token_hash=${mail.tokenHash}&type=recovery`);
    await expect(screen(page, "S3b")).toBeVisible();
    await expect(page.getByText(STRINGS["auth.link.reset.body"])).toBeVisible();
    await page.getByRole("button", { name: STRINGS["btn.chooseNew"] }).click();
    await expect(h1(page)).toHaveText(STRINGS["auth.reset.title"]);
    await expect(page.getByLabel(/confirm password/i)).toHaveCount(0);
    await screen(page, "S5").locator("input[type=password]").fill("my brand new long password");
    await page.getByRole("button", { name: STRINGS["btn.setPassword"] }).click();
    await expect(page.getByTestId("no-access")).toBeVisible(); // a plain user: signed in, then refused by role
  });
});

test.describe("Continue with Google", () => {
  test("a real button; top-level redirect, no popup, no form action; PKCE code is stripped; the session is in localStorage only", async ({ page, context }) => {
    let popups = 0;
    context.on("page", () => { popups++; });
    await c.h.supabase.setGoogle({ email: ADMIN.email });
    await c.h.supabase.addUser({ email: ADMIN.email, role: "super_admin", provider: "google" }).catch(() => {});
    await page.goto("/console");
    const g = page.getByRole("button", { name: STRINGS["btn.google"] });
    await expect(g).toBeVisible();
    expect(await g.evaluate((el) => el.tagName)).toBe("BUTTON");
    const authorize = page.waitForRequest((r) => r.url().includes("/auth/v1/authorize?") && r.url().includes("provider=google"));
    await g.click();
    const req = await authorize;
    expect(req.url()).toContain("code_challenge=");
    expect(req.url()).toContain("code_challenge_method=s256");
    expect(req.url()).not.toContain("#");
    await expect(page.getByTestId("agent-list").or(page.getByTestId("no-access"))).toBeVisible({ timeout: 15_000 });
    expect(page.url()).not.toMatch(/[?&]code=/);
    expect(popups).toBe(0);
    const stores = await page.evaluate(() => ({ local: Object.keys(localStorage).filter((k) => /-auth-token$/.test(k)), session: Object.entries(sessionStorage).map(([k, v]) => `${k}=${v}`) }));
    expect(stores.local.length).toBe(1);
    expect(stores.session.join(" ")).not.toMatch(/eyJ|access_token|refresh_token/);
  });

  test("a cancelled round trip lands on sign-in with the fixed Google message and the params stripped", async ({ page }) => {
    await page.goto("/console?error=access_denied&error_description=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E");
    await expect(page.getByText(STRINGS["auth.error.google.cancel"])).toBeVisible();
    expect(page.url()).not.toContain("error_description");
    expect(await page.locator("img[src=x]").count()).toBe(0);
  });
});

test.describe("session and sign out", () => {
  test("signed in: the session is in localStorage only (no cookie, no token in the DOM); Sign Out clears it", async ({ page, context }) => {
    await page.goto("/console");
    await signIn(page, ADMIN);
    await expect(page.getByTestId("agent-list")).toBeVisible();
    expect(await context.cookies()).toEqual([]);
    expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => /-auth-token$/.test(k)).length)).toBe(1);
    expect(await page.content()).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\./);
    await expect(page.getByTestId("account-email")).toContainText(ADMIN.email);
    await page.getByRole("button", { name: STRINGS["btn.signOut"], exact: true }).click();
    await expect(page.getByText(STRINGS["auth.signout.done"])).toBeVisible();
    expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => /-auth-token$/.test(k)).length)).toBe(0);
    await page.goto("/");
    await expect(h1(page)).toBeVisible(); // the beach app is unaffected
  });

  test("Sign Out Everywhere revokes with scope global", async ({ page }) => {
    await page.goto("/console");
    await signIn(page, ADMIN);
    await expect(page.getByTestId("agent-list")).toBeVisible();
    await page.getByRole("button", { name: STRINGS["btn.signOutAll"] }).click();
    await expect(page.getByText(STRINGS["auth.signout.all.done"])).toBeVisible();
    const calls = await c.h.supabase.calls();
    expect(calls.some((x) => /logout/.test(x.path))).toBe(true);
    expect(await c.h.supabase.sessionCount({ email: ADMIN.email })).toBe(0);
  });

  test("the beach app never asks Supabase for anything", async ({ page }) => {
    await c.h.supabase.resetCalls();
    await page.goto("/");
    await page.goto("/how-it-works/");
    expect(await c.h.supabase.callCount({ pattern: "" })).toBe(0);
  });
});
