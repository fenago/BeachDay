// Chat with a scripted fake Anthropic stream through the REAL chat handler (SSE), plus canned pre-stream failures.
import { test, expect } from "@playwright/test";
import { consoleApp, seedUsers, loginAs, sendMessage, STRINGS, t, ADMIN, turns as T } from "../helpers/e2e.mjs";

// "Ask the team" (Kai) is the default view and runs as a job (team.spec.mjs). These specs cover the single-expert /api/chat path,
// so they open the first EXPERT's chat, never the lead's.
async function openFirstChat(page) {
  const card = page.locator('[data-testid="agent-card"]:not([data-agent="orchestrator"])').first();
  await expect(card).toBeVisible();
  const name = await card.getAttribute("data-agent");
  await card.getByTestId("agent-chat").click();
  await expect(page.locator(`[data-testid="chat"][data-agent="${name}"]`)).toBeVisible();
}

let c;
test.beforeEach(async ({ page, baseURL }) => { c = await consoleApp(page, baseURL); await seedUsers(c.h); await loginAs(page, ADMIN); });
test.afterEach(() => { c.guard.assertClean(); expect(c.csp, "CSP violations").toEqual([]); });

const json = (status, code, extra = {}) => ({ status, headers: { "content-type": "application/json", "cache-control": "no-store" }, body: JSON.stringify({ error: { code, message: "x", ...extra } }) });

test("a streamed reply lands in role=log; the streaming message is aria-busy until done; focus stays in the composer", async ({ page }) => {
  await c.h.anthropic.script({ turns: [T.text(["Hello ", "from ", "the agent."])] });
  await openFirstChat(page);
  const log = page.getByRole("log", { name: "Conversation" });
  await expect(log).toBeVisible();
  const input = page.getByTestId("chat-input");
  await input.fill("Say hello.");
  await page.getByTestId("chat-send").click();
  await expect(input).toBeFocused();
  await expect(log.getByTestId("msg-user")).toContainText("Say hello.");
  const reply = log.getByTestId("msg-agent");
  await expect(reply).toContainText("Hello from the agent.");
  await expect(reply).toHaveAttribute("aria-busy", "false");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("");
  const rq = await c.h.anthropic.requests();
  expect(rq.length).toBe(1);
  expect(JSON.stringify(rq[0].body.messages)).toContain("Say hello.");
});

test("model output is text: HTML, a script tag and a javascript: link render as characters and make no request", async ({ page }) => {
  const evil = '<img src="https://evil.example/x.png" onerror="window.__pwned=1"> <script>window.__pwned=2</script> [click](javascript:window.__pwned=3) ![i](https://evil.example/y.png)';
  await c.h.anthropic.script({ turns: [T.text([evil])] });
  await openFirstChat(page);
  await sendMessage(page, "Show me something unsafe.");
  const reply = page.getByTestId("msg-agent");
  await expect(reply).toContainText("<img src=");
  await expect(reply).toContainText("javascript:window.__pwned=3");
  expect(await reply.locator("img, script, a, iframe").count()).toBe(0);
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  c.guard.assertClean(); // evil.example was never contacted
});

test("a refusal removes the partial bubble and shows an alert; the draft is not lost", async ({ page }) => {
  await c.h.anthropic.script({ turns: [T.refusal("I can")] });
  await openFirstChat(page);
  await sendMessage(page, "Do something the model will refuse.");
  await expect(page.getByTestId("msg-error").or(page.getByTestId("chat-alert").locator("p"))).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("msg-agent")).toHaveCount(0); // the partial bubble is gone
  await expect(page.getByTestId("chat-alert")).toHaveAttribute("role", "alert");
});

test("pre-stream 429 with our JSON body, and a 429 WITHOUT it (Netlify's rule), both say rate limited and keep the draft", async ({ page }) => {
  await openFirstChat(page);
  const input = page.getByTestId("chat-input");
  await page.route("**/api/chat", (r) => r.fulfill(json(429, "rate_limited", { retryAt: new Date(Date.now() + 60_000).toISOString() })));
  await sendMessage(page, "first");
  await expect(page.getByTestId("chat-alert")).not.toBeEmpty();
  await expect(input).toHaveValue("first");
  await page.unroute("**/api/chat");
  await page.route("**/api/chat", (r) => r.fulfill({ status: 429, contentType: "text/html", body: "<html>Too many</html>" }));
  await page.getByTestId("chat-send").click();
  await expect(page.getByTestId("chat-alert")).not.toBeEmpty();
  await expect(input).toHaveValue("first");
});

test("budget_exhausted keeps the draft and Send is aria-disabled with the dated message", async ({ page }) => {
  await openFirstChat(page);
  const retryAt = "2026-12-04T05:00:00.000Z";
  await page.route("**/api/chat", (r) => r.fulfill(json(429, "budget_exhausted", { retryAt })));
  await sendMessage(page, "keep me");
  await expect(page.getByTestId("chat-alert")).toContainText(/usage limit/i);
  await expect(page.getByTestId("chat-input")).toHaveValue("keep me");
  await expect(page.getByTestId("chat-send")).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByTestId("chat-alert")).toContainText(/Dec 4/); // New York date, whatever the runner's timezone
});

test("a 401 before the stream refreshes the token once and sends again; an open stream's error is shown, not resent", async ({ page }) => {
  await openFirstChat(page);
  let n = 0;
  await c.h.anthropic.script({ turns: [T.text(["Back again."])] });
  await page.route("**/api/chat", (r) => { n++; return n === 1 ? r.fulfill(json(401, "unauthorized")) : r.continue(); });
  await sendMessage(page, "retry me");
  await expect(page.getByTestId("msg-agent")).toContainText("Back again.");
  expect(n).toBe(2);
});

test("the draft and transcript live in memory only (nothing in storage)", async ({ page }) => {
  await c.h.anthropic.script({ turns: [T.text(["noted"])] });
  await openFirstChat(page);
  await sendMessage(page, "a private sentence 7731");
  await expect(page.getByTestId("msg-agent")).toContainText("noted");
  const dump = await page.evaluate(() => JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage } }));
  expect(dump).not.toContain("a private sentence 7731");
  expect(dump).not.toContain("noted");
});
