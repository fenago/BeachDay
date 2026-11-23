// FULL STACK through the harness: browser UI -> REAL function code -> fake Supabase, fake Anthropic (scripted stream), fake GitHub.
// Chat -> propose_change -> proposal card (diff, hash, warnings) -> Review and Approve -> step-up -> commit -> Live / No deploy needed.
// What the fake GitHub received is read back through the control channel (base_tree, force:false, trailer, no sha:null).
import { test, expect } from "@playwright/test";
import { consoleApp, seedUsers, loginAs, proposeViaChat, STRINGS, t, ADMIN, turns as T, harnessClient } from "../helpers/e2e.mjs";

let c, h;
test.beforeEach(async ({ page, baseURL }) => { c = await consoleApp(page, baseURL); h = c.h; await seedUsers(h); });
test.afterEach(() => { c.guard.assertClean(); expect(c.csp, "CSP violations").toEqual([]); });

const DOC = { summary: "Add a short note about parking to the beach guide so visitors know where to leave a car", files: [{ path: "docs/parking-note.md", content: "# Parking\n\nArrive early on weekends.\n" }] };
const JS = { summary: "Make the beach picker heading friendlier so first-time visitors feel welcome right away", files: [{ path: "public/js/score-config.js", content: "export const SCORE_CONFIG = { friendly: true };\n" }] };
const card = (page) => page.getByTestId("proposal-card").first();
const sheet = (page) => page.getByTestId("approve-sheet");
const approveRequests = (c) => c.apiCalls.filter((x) => /POST \/api\/proposals\/p_[0-9A-Z]{26}\/approve/.test(x));
const lastCommit = async (h) => (await h.github.log())[0];

async function openSheet(page) {
  await card(page).getByTestId("proposal-review").click();
  await expect(sheet(page)).toBeVisible();
}
async function confirmWithPassword(page, pw = ADMIN.password) {
  await sheet(page).getByTestId("stepup-password").fill(pw);
}

test.describe("the proposal card", () => {
  test("shows heading, file list, diff with + markers (not colour alone), contentHash, and warnings for JS", async ({ page }) => {
    await loginAs(page, ADMIN);
    const id = await proposeViaChat(page, h, T, JS);
    expect(id).toMatch(/^p_[0-9A-Z]{26}$/);
    const c0 = card(page);
    await expect(c0.getByRole("heading").first()).toContainText(STRINGS["agents.proposal.title"]);
    await expect(c0).toContainText("public/js/score-config.js");
    await expect(c0).toContainText(/sha256|[0-9a-f]{8}/);
    await expect(c0.getByTestId("proposal-warnings")).toBeVisible(); // public/**/*.js runs next to the tokens
    const diff = c0.getByTestId("proposal-diff").first();
    await diff.locator("summary").click();
    await expect(diff.locator(".diff__marker").filter({ hasText: "+" }).first()).toBeVisible();
    await expect(diff.getByText(STRINGS["agents.proposal.added"], { exact: false }).first()).toBeAttached(); // spoken label for the marker
    // usage line is not on the card but on the sheet
    await openSheet(page);
    await expect(page.getByTestId("usage-line")).toContainText(t("console.cap.usage", { used: 0 }));
    await expect(sheet(page).getByRole("heading", { level: 2 })).toHaveText(STRINGS["agents.sheet.title"]);
    expect(approveRequests(c), "opening the sheet approves nothing").toHaveLength(0);
  });

  test("Reject marks it rejected, changes nothing, and GitHub is untouched", async ({ page }) => {
    await loginAs(page, ADMIN);
    await proposeViaChat(page, h, T, DOC);
    await card(page).getByTestId("proposal-reject").click();
    await expect(page.getByText(STRINGS["console.status.rejected"])).toBeVisible();
    expect((await h.github.state()).commitCount).toBe(0);
    expect(approveRequests(c)).toHaveLength(0);
  });
});

test.describe("Approve", () => {
  test("docs-only change: password step-up, one atomic commit, 'No deploy needed', no version polling", async ({ page }) => {
    await loginAs(page, ADMIN);
    await proposeViaChat(page, h, T, DOC);
    await openSheet(page);
    await expect(sheet(page).getByRole("heading", { level: 2 })).toHaveText(STRINGS["agents.sheet.title.nodeploy"]);
    // nothing is sent until the person activates Approve
    expect(approveRequests(c)).toHaveLength(0);
    const polls = []; page.on("request", (r) => { if (r.url().endsWith("/version.json")) polls.push(r.url()); });
    await confirmWithPassword(page);
    await sheet(page).getByTestId("sheet-approve").click();
    await expect(page.getByTestId("proposal-status")).toContainText(/Committed [0-9a-f]{7,}\. No deploy needed\./, { timeout: 15_000 });
    await expect(page.getByTestId("commit-link")).toBeVisible();
    // what GitHub received
    const st = await h.github.state();
    expect(st.violations, "fake GitHub saw no protocol violation (base_tree present, force:false, no sha:null, one parent, 100644)").toEqual([]);
    const commit = await lastCommit(h);
    expect(commit.parents).toHaveLength(1);
    expect(commit.message.trimEnd().split("\n").pop()).toMatch(/^Beach-Day-Proposal: p_[0-9A-Z]{26}$/);
    expect(commit.author).toMatch(/Beach Day Agent \(.+\)/);
    expect(await h.github.fileText({ path: "docs/parking-note.md" })).toBe(DOC.files[0].content);
    const gh = st.calls.filter((x) => /POST|PATCH|PUT|DELETE/.test(x));
    expect(gh.some((x) => /^POST .*git\/trees/.test(x))).toBe(true);
    expect(gh.some((x) => /^PATCH .*git\/refs\/heads\/main/.test(x))).toBe(true);
    expect(gh.filter((x) => /^DELETE/.test(x))).toEqual([]);
    expect(await h.blobs.peek({ store: "ratelimit", key: "site:approvals" })).toBeTruthy(); // a no-deploy approval still counts
    await page.waitForTimeout(11_000); // longer than one poll interval
    expect(polls, "no deploy, so no polling").toEqual([]);
  });

  test("JS change: 'Committed {sha}. Deploying…' then 'Live' once /version.json names the commit", async ({ page }) => {
    await loginAs(page, ADMIN);
    await proposeViaChat(page, h, T, JS);
    await openSheet(page);
    await expect(sheet(page).getByRole("heading", { level: 2 })).toHaveText(STRINGS["agents.sheet.title"]);
    await expect(sheet(page)).toContainText(STRINGS["console.consequence"].slice(0, 30));
    await confirmWithPassword(page);
    await sheet(page).getByTestId("sheet-approve").click();
    await expect(page.getByTestId("proposal-status")).toContainText(/Committed [0-9a-f]{7,}\. Deploying…/, { timeout: 15_000 });
    await expect(page.getByTestId("proposal-status")).not.toContainText(STRINGS["console.status.live"]);
    const sha = (await lastCommit(h)).sha;
    await h.harness.setVersion({ version: sha }); // the "deploy" finished: /version.json now names the commit
    await expect(page.getByTestId("proposal-status")).toContainText(STRINGS["console.status.live"], { timeout: 20_000 }); // poll interval is 10 s
  });

  test("a stale sign-in: 401 step_up_required keeps the sheet open and the proposal pending; the person confirms and Approve works", async ({ page }) => {
    await loginAs(page, ADMIN);
    await proposeViaChat(page, h, T, DOC);
    await openSheet(page);
    let first = true;
    await page.route("**/api/proposals/*/approve", (r) => {
      if (!first) return r.continue();
      first = false;
      return r.fulfill({ status: 401, headers: { "content-type": "application/json", "cache-control": "no-store", "www-authenticate": "Bearer" }, body: JSON.stringify({ error: { code: "step_up_required", message: "Confirm it's you." } }) });
    });
    await confirmWithPassword(page);
    await sheet(page).getByTestId("sheet-approve").click();
    await expect(sheet(page).getByTestId("sheet-status")).toContainText(/Confirm it's you to approve/);
    await expect(sheet(page)).toBeVisible();
    expect((await h.github.state()).commitCount).toBe(0);
    await expect(card(page)).toHaveAttribute("data-status", "pending");
    await confirmWithPassword(page);
    await sheet(page).getByTestId("sheet-approve").click();
    await expect(page.getByTestId("proposal-status")).toContainText(/Committed/, { timeout: 15_000 });
  });

  test("a wrong password shows an inline alert on the field and sends no approve request", async ({ page }) => {
    await loginAs(page, ADMIN);
    await proposeViaChat(page, h, T, DOC);
    await openSheet(page);
    await confirmWithPassword(page, "not the password at all");
    await sheet(page).getByTestId("sheet-approve").click();
    await expect(sheet(page).getByTestId("stepup-password")).toHaveAttribute("aria-invalid", "true");
    await expect(sheet(page).getByText(STRINGS["console.error.password"])).toBeVisible();
    await expect(sheet(page).getByTestId("stepup-password")).toBeFocused();
    expect(approveRequests(c)).toHaveLength(0);
  });

  test("Esc closes the sheet, focus returns to Review and Approve, the proposal stays pending", async ({ page }) => {
    await loginAs(page, ADMIN);
    await proposeViaChat(page, h, T, DOC);
    await openSheet(page);
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toHaveCount(0);
    await expect(card(page).getByTestId("proposal-review")).toBeFocused();
    await expect(card(page)).toHaveAttribute("data-status", "pending");
  });

  test("409 stale: main moved after the proposal; the message says so, nothing is committed, no approval is used", async ({ page }) => {
    await loginAs(page, ADMIN);
    await proposeViaChat(page, h, T, { summary: DOC.summary, files: [{ path: "docs/README.md", content: "# Docs rewritten by the agent\n" }] });
    await h.github.pushConcurrent({ path: "docs/README.md", text: "# Docs edited by a human meanwhile\n" });
    await openSheet(page);
    await confirmWithPassword(page);
    await sheet(page).getByTestId("sheet-approve").click();
    await expect(page.getByText(STRINGS["console.error.stale"]).or(page.getByText(STRINGS["console.stale.card"])).first()).toBeVisible({ timeout: 15_000 });
    expect(await h.github.fileText({ path: "docs/README.md" })).toBe("# Docs edited by a human meanwhile\n");
    expect(await h.blobs.peek({ store: "ratelimit", key: "site:approvals" })).toBeFalsy();
  });

  test("502 upstream (the ref update's outcome is unknown): 'Couldn't confirm the commit yet', exactly ONE approve request, Approve never offered again", async ({ page }) => {
    await loginAs(page, ADMIN);
    await proposeViaChat(page, h, T, DOC);
    await h.github.patchFails502();
    await openSheet(page);
    await confirmWithPassword(page);
    await sheet(page).getByTestId("sheet-approve").click();
    await expect(page.getByTestId("approve-unconfirmed")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(STRINGS["console.error.confirm"])).toBeVisible();
    await expect(page.getByRole("link", { name: STRINGS["btn.viewCommits"] })).toHaveAttribute("href", /github\.com\/.*commits/);
    await expect(card(page).getByTestId("proposal-review")).toHaveCount(0);
    await page.waitForTimeout(1500);
    expect(approveRequests(c), "never resent automatically").toHaveLength(1);
  });
});

test.describe("limits and switches", () => {
  const seedApprovals = (n, spacingMs) => h.blobs.seed({ store: "ratelimit", key: "site:approvals", value: { times: Array.from({ length: n }, (_, i) => new Date(Date.now() - 60_000 - i * spacingMs).toISOString()) } });

  test("5 approvals today: a blocking alert with the midnight message; Review is hidden; Reject stays; nothing committed", async ({ page }) => {
    await loginAs(page, ADMIN);
    // 5 within the current New York day (minutes apart; a run in the first 5 minutes after midnight Eastern is the one flaky case)
    await seedApprovals(5, 1000);
    await proposeViaChat(page, h, T, DOC).catch(() => {});
    await expect(page.getByTestId("approve-cap")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(STRINGS["console.cap.day"])).toBeVisible();
    await expect(page.getByTestId("approve-cap").locator("..").or(page.getByTestId("proposal-alert"))).toHaveAttribute("role", "alert");
    await expect(card(page).getByTestId("proposal-reject")).toBeVisible();
    await expect(card(page).getByTestId("proposal-review")).toHaveCount(0);
    expect((await h.github.state()).commitCount).toBe(0);
  });

  test("14 approvals in 31 days: the monthly message with a New York date", async ({ page }) => {
    await loginAs(page, ADMIN);
    await seedApprovals(14, 2 * 24 * 3600_000); // two days apart: the DAY cap cannot be what refuses
    await proposeViaChat(page, h, T, DOC).catch(() => {});
    await expect(page.getByTestId("approve-cap")).toContainText(/14 of 14 approvals used in the last 31 days\. Next slot frees [A-Z][a-z]{2} \d{1,2}\./, { timeout: 15_000 });
  });

  test("a 429 approve_cap answered by the server (race) closes the sheet into the same alert", async ({ page }) => {
    await loginAs(page, ADMIN);
    await proposeViaChat(page, h, T, DOC);
    await openSheet(page);
    await page.route("**/api/proposals/*/approve", (r) => r.fulfill({ status: 429, headers: { "content-type": "application/json", "cache-control": "no-store" }, body: JSON.stringify({ error: { code: "approve_cap", message: "cap", retryAt: "2026-12-04T05:00:00.000Z", approvals: { used31: 14, usedToday: 1, per31Days: 14, perDay: 5, retryAt: "2026-12-04T05:00:00.000Z" } } }) }));
    await confirmWithPassword(page);
    await sheet(page).getByTestId("sheet-approve").click();
    await expect(page.getByTestId("approve-cap")).toContainText(/14 of 14 approvals used in the last 31 days\. Next slot frees Dec 4\./);
    await expect(card(page)).toHaveAttribute("data-status", "pending");
  });

  test("approveEnabled false: 'Approve is off', Review and Approve is aria-disabled, the server answers 503 if called anyway", async ({ page, request }) => {
    await h.harness.setApproveEnabled({ value: false });
    await loginAs(page, ADMIN);
    await proposeViaChat(page, h, T, DOC).catch(() => {});
    await expect(page.getByTestId("approve-off")).toContainText(STRINGS["console.approve.disabled"], { timeout: 15_000 });
    await expect(card(page).getByTestId("proposal-review")).toHaveAttribute("aria-disabled", "true");
    expect((await h.github.state()).commitCount).toBe(0);
  });
});

test.describe("nothing in the URL ever approves", () => {
  for (const suffix of ["?approve=1", "#approve", "?code=abc123", "?approve=1&token_hash=zzz&type=email", "#/console/proposal/p_01ARZ3NDEKTSV4RRFFQ69G5FAV?approve=1"]) {
    test(`loading /console${suffix} sends no approve request`, async ({ page }) => {
      await loginAs(page, ADMIN);
      await proposeViaChat(page, h, T, DOC);
      const before = approveRequests(c).length;
      await page.goto(`/console${suffix}`);
      await page.waitForTimeout(1200);
      expect(approveRequests(c).length).toBe(before);
      expect((await h.github.state()).commitCount).toBe(0);
    });
  }
});

test.describe("Google step-up", () => {
  test("Confirm with Google leaves for Google, returns to the SAME proposal, says nothing is approved yet, and needs a click", async ({ page }) => {
    await h.supabase.addUser({ email: "g.admin@example.test", role: "super_admin", provider: "google" });
    await h.supabase.setGoogle({ email: "g.admin@example.test" });
    await page.goto("/console");
    await page.getByRole("button", { name: STRINGS["btn.google"] }).click();
    await expect(page.getByTestId("agent-list")).toBeVisible({ timeout: 15_000 });
    const id = await proposeViaChat(page, h, T, DOC);
    await openSheet(page);
    await expect(sheet(page).getByTestId("stepup-google")).toBeVisible();
    const before = approveRequests(c).length;
    await sheet(page).getByTestId("stepup-google").click();
    await expect(page).toHaveURL(new RegExp(`proposal/${id}`), { timeout: 15_000 });
    await expect(sheet(page)).toBeVisible({ timeout: 15_000 });
    await expect(sheet(page).getByTestId("sheet-status")).toContainText(/Confirmed\. Nothing is approved yet/);
    expect(approveRequests(c).length, "returning from Google approves nothing").toBe(before);
    expect((await h.github.state()).commitCount).toBe(0);
    await sheet(page).getByTestId("sheet-approve").click();
    await expect(page.getByTestId("proposal-status")).toContainText(/Committed/, { timeout: 15_000 });
  });
});
