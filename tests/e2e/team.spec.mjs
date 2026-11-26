// "Ask the team" (team_plan, 2026-11-26): Kai is the default entry on the Agents page, consults experts server-side
// (consult_expert, several in parallel), and gives one combined answer. Real function code, fake Supabase/Anthropic/GitHub.
// Selectors are Remy-B's data-testids (aligned 2026-11-26). They all live in the SEL block.
import { test, expect } from "@playwright/test";
import { consoleApp, seedUsers, loginAs, sendMessage, axe, STRINGS, t, ADMIN, PLAIN, turns as T, projectLabel } from "../helpers/e2e.mjs";

const LEAD = "orchestrator", DEWEY = "open-meteo-integrator", WREN = "ux-designer-apple-hig";
const SEL = {
  team: '[data-testid="team-card"]',                                      // the "Ask the team" card (data-agent, data-selected)
  badge: '[data-testid="team-card-badge"]',
  expertCards: '[data-testid="agent-card"]',                             // experts only: the lead is the team card
  progress: '[data-testid="msg-progress"]',                              // one row per consult event (data-agent, data-state)
  asked: '[data-testid="team-asked"]',                                   // the deterministic "Asked: ..." footer
  working: '[data-testid="team-working"]',                               // the visible working line (the hidden status region repeats its text)
  status: '[data-testid="team-status"]',
  proposalBy: '[data-testid="proposal-by"]',                             // "Drafted by X": sits ABOVE the proposal card
};

let c, h, BASE;
test.beforeEach(async ({ page, baseURL }) => { c = await consoleApp(page, baseURL); h = c.h; await seedUsers(h); BASE = (await h.github.state()).commitCount; });
test.afterEach(() => { c.guard.assertClean(); expect(c.csp, "CSP violations").toEqual([]); });

const teamCard = (page) => page.locator(SEL.team).first();
const leadChat = (page) => page.locator(`[data-testid="chat"][data-agent="${LEAD}"]`);
const chatApiCalls = () => c.apiCalls.filter((x) => /^POST \/api\/chat$/.test(x));
const jobStarts = () => c.apiCalls.filter((x) => /^POST \/api\/jobs$/.test(x));
const approveRequests = () => c.apiCalls.filter((x) => /POST \/api\/proposals\/p_[0-9A-Z]{26}\/approve/.test(x));
const requestsOf = async (agent) => (await h.anthropic.requests()).filter((r) => r.agent === agent);
const DOC = { summary: "Explain the Fair verdict in one clear line so visitors know why the day is only fair", files: [{ path: "docs/fair-verdict.md", content: "# Fair\n\nPick your hours: the best window is short.\n" }] };

/** Record every piece of text ADDED inside any role=status element (one entry per DOM update). Read it back with announced(page). */
async function watchStatus(page) {
  await page.evaluate(() => {
    window.__announced = [];
    const inStatus = (n) => (n.nodeType === 1 ? n : n.parentElement)?.closest?.('[role="status"]');
    new MutationObserver((recs) => {
      for (const r of recs) {
        if (r.type === "characterData" && inStatus(r.target) && r.target.data.trim()) window.__announced.push(r.target.data.trim());
        for (const n of r.addedNodes) if (inStatus(n) && n.textContent.trim()) window.__announced.push(n.textContent.trim());
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
}
const announced = (page) => page.evaluate(() => window.__announced.slice());
const countIn = (list, needle) => list.filter((x) => x.includes(needle)).length;

/** Collect every /api/jobs/:id answer the page receives (the events live in the job view). */
function captureJobJson(page) {
  const seen = [];
  page.on("response", async (r) => { if (/\/api\/jobs\/j_[0-9A-Z]{26}(\?|$)/.test(r.url())) { try { seen.push(await r.json()); } catch { /* not JSON */ } } });
  return seen;
}
/** Every consult_expert tool event anywhere in the captured job views (deduped by phase+agent+ok). */
function consultEvents(seen) {
  const out = new Map();
  const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") { if (v.type === "tool" && v.name === "consult_expert") out.set(`${v.phase}|${v.agent}|${v.ok}`, v); Object.values(v).forEach(walk); } };
  walk(seen);
  return [...out.values()];
}

const consultTurn = (calls, text) => T.for(LEAD, T.consult(calls, { text }));
const expertReport = (agent, text, startDelayMs = 3500) => T.for(agent, T.held(T.text([text]), startDelayMs));

test("landing on /console as super_admin: 'Ask the team' is selected and its chat is ready; the experts are listed below, Kai is not repeated", async ({ page }, testInfo) => {
  await loginAs(page, ADMIN);
  const team = teamCard(page);
  await expect(team).toBeVisible();
  await expect(team).toContainText(STRINGS["agents.team.title"]);
  await expect(team.locator(SEL.badge)).toHaveText(STRINGS["agents.team.badge"]); // "Default": selection is text, not colour alone
  await expect(team).toHaveAttribute("data-selected", "true");
  await expect(team).toHaveAttribute("data-agent", LEAD);
  await expect(team, "selected state is a class/attribute, not just paint").toHaveClass(/team-card--selected/);
  await expect(team, "ux-build-spec 3.4: aria-current on the card").toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("heading", { level: 1 }), "focus goes to the h1 on a route change").toBeFocused();
  await expect(page.getByTestId("chat-input"), "the composer is ready but NOT auto-focused (spec 3.4)").not.toBeFocused();
  // No click needed: the lead's chat panel and an enabled composer are already there.
  await expect(leadChat(page)).toBeVisible();
  await expect(page.getByTestId("chat-input")).toBeEnabled();
  await expect(page.getByTestId("chat-send")).toBeVisible();
  await expect(page.locator("h1:visible"), `one h1 on ${projectLabel(testInfo)}`).toHaveCount(1);
  // The experts follow in a list below: 12 agents minus the lead.
  await expect(page.getByText(STRINGS["agents.experts.heading"], { exact: true })).toBeVisible();
  await expect(page.locator(SEL.expertCards)).toHaveCount(11);
  await expect(page.locator(`[data-agent="${LEAD}"][data-testid="agent-card"]`), "Kai is not in the expert list").toHaveCount(0);
  const tb = await team.boundingBox(), eb = await page.locator(SEL.expertCards).first().boundingBox();
  expect(tb.y, "team card above the first expert").toBeLessThan(eb.y);
  expect(c.apiCalls, "landing makes the one access check and starts nothing").toEqual(["GET /api/agents"]);
  // An expert is still one click away (#/console/agent/<expert> keeps working).
  await page.goto(`/console#/console/agent/${DEWEY}`);
  await expect(page.locator(`[data-testid="chat"][data-agent="${DEWEY}"]`)).toBeVisible();
});

test("Kai consults Dewey and Wren in ONE round: both requests overlap, progress lines show, one combined answer, 'Asked: Dewey, Wren' footer", async ({ page }) => {
  test.setTimeout(90_000);
  await h.anthropic.script({ turns: [
    consultTurn([{ agent: DEWEY, question: "Is Saturday good at Hollywood Beach? Use the wind rule.", id: "toolu_d" }, { agent: WREN, question: "Is the wind rule too strict for families? Judge the wording.", id: "toolu_w" }], "I'll ask two experts."),
    expertReport(DEWEY, "Dewey: Saturday scores Good; gusts stay under 19 mph."),
    expertReport(WREN, "Wren: the rule is fine, but say 'gusty' in plain words."),
    T.for(LEAD, T.text(["Saturday is a Good beach day. ", "The wind rule is fine; reword it as 'gusty'."])),
  ] });
  await loginAs(page, ADMIN);
  await expect(leadChat(page)).toBeVisible();
  await watchStatus(page);
  const feed = captureJobJson(page);
  await sendMessage(page, "Is Saturday a good beach day at Hollywood Beach, and is our wind rule too strict for families? Ask whoever you need.");

  // R-1: a team turn is a background job, never /api/chat.
  await expect.poll(jobStarts, { timeout: 10_000 }).toHaveLength(1);
  expect(chatApiCalls(), "Kai never goes through /api/chat").toEqual([]);
  await expect(page.locator(SEL.working)).toHaveText(STRINGS["agents.team.working"], { timeout: 10_000 });

  // R-4: "Asking {persona}…" for both, together (the consults are 3.5 s long, the poll is 2.5 s).
  const asking = (p) => t("agents.chat.tool.consult_expert.start", { agent: p });
  await expect(page.locator(SEL.progress).filter({ hasText: asking("Dewey") })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(SEL.progress).filter({ hasText: asking("Wren") })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(SEL.progress).filter({ hasText: t("agents.chat.tool.consult_expert.end", { agent: "Dewey" }) })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(SEL.progress).filter({ hasText: t("agents.chat.tool.consult_expert.end", { agent: "Wren" }) })).toBeVisible({ timeout: 30_000 });

  // One combined answer, then the footer built from the events (not from the model's words).
  const answer = leadChat(page).getByTestId("msg-agent").last();
  await expect(answer).toContainText("Saturday is a Good beach day.", { timeout: 30_000 });
  await expect(answer).toContainText("reword it as 'gusty'");
  await expect(leadChat(page).locator(SEL.asked)).toHaveText(t("agents.team.asked", { list: "Dewey, Wren" }));
  await expect(page.locator(SEL.working)).toHaveCount(0);
  // role=status cadence (ux-build-spec 3.4): each start and end announced ONCE, same-poll starts joined, no re-announcement on later polls.
  const say = (k, p) => t(`agents.chat.tool.consult_expert.${k}`, { agent: p });
  const first = await announced(page);
  expect(countIn(first, say("start", "Dewey")), `"${say("start", "Dewey")}" announced once`).toBe(1);
  expect(countIn(first, say("start", "Wren"))).toBe(1);
  expect(countIn(first, say("end", "Dewey"))).toBe(1);
  expect(countIn(first, say("end", "Wren"))).toBe(1);
  expect(first.some((x) => x.includes(say("start", "Dewey")) && x.includes(say("start", "Wren"))), "parallel starts of one poll go out as ONE update").toBe(true);
  expect(countIn(first, STRINGS["agents.team.working"]), "the working line is announced once").toBe(1);
  await page.waitForTimeout(6000); // more than two 2.5 s polls with nothing new
  expect(await announced(page), "later polls announce nothing").toEqual(first);
  // One row per consult: it changes state (asking -> done) and is never removed.
  await expect(page.locator(SEL.progress)).toHaveCount(2);
  for (const a of [DEWEY, WREN]) await expect(page.locator(`${SEL.progress}[data-agent="${a}"]`)).toHaveAttribute("data-state", "done");
  await expect(page.locator(`${SEL.progress}[data-agent="${DEWEY}"]`)).toContainText(say("end", "Dewey")); // "Dewey answered"
  await expect(page.locator(`${SEL.progress}[data-agent="${WREN}"]`)).toContainText(say("end", "Wren"));  // "Wren answered"
  const ev = consultEvents(feed);
  expect(ev.map((e) => `${e.phase}:${e.agent}`).sort(), "a start and an end per consult").toEqual([`end:${DEWEY}`, `end:${WREN}`, `start:${DEWEY}`, `start:${WREN}`]);
  expect(ev.filter((e) => e.phase === "end").every((e) => e.ok === true)).toBe(true);
  expect(ev.filter((e) => "summary" in e), "no consult event carries a summary (the expert's words stay server-side)").toEqual([]);
  // Nested expert text is NOT forwarded to the page (it goes to Kai only).
  await expect(page.getByText("Dewey: Saturday scores Good")).toHaveCount(0);
  await expect(page.getByText("Wren: the rule is fine")).toHaveCount(0);

  // What the fake Anthropic saw.
  const dewey = await requestsOf(DEWEY), wren = await requestsOf(WREN), kai = await requestsOf(LEAD);
  expect([dewey.length, wren.length, kai.length], "one request each for the experts, two for Kai (consult round, then the answer)").toEqual([1, 1, 2]);
  expect(dewey[0].t0 < wren[0].t1 && wren[0].t0 < dewey[0].t1, `Dewey [${dewey[0].t0},${dewey[0].t1}] and Wren [${wren[0].t0},${wren[0].t1}] must overlap in time`).toBe(true);
  expect(await h.anthropic.pending(), "everything scripted was used").toBe(0);
  expect(JSON.stringify(dewey[0].body.messages), "the expert's one user turn carries Kai's question and the framing").toContain("Is Saturday good at Hollywood Beach?");
  expect(dewey[0].body.tools.map((x) => x.name).sort(), "an expert has no consult_expert (depth 1)").toEqual(["list_files", "propose_change", "read_file"]);
  expect(kai[0].body.tools.map((x) => x.name).sort(), "the lead has consult_expert and no propose_change").toEqual(["consult_expert", "list_files", "read_file"]);
  expect(JSON.stringify(kai[1].body.messages), "the report reaches Kai as framed data").toContain("<expert_report");
  expect((await h.github.state()).commitCount, "a consult changes nothing").toBe(BASE);
});

test("an expert drafts a proposal through Kai: the card says 'Drafted by Wren', shows the diff, and Approve commits it with the expert as author", async ({ page }) => {
  test.setTimeout(90_000);
  await h.anthropic.script({ turns: [
    consultTurn([{ agent: WREN, question: "Draft a clearer one-line explanation of the Fair verdict in docs/fair-verdict.md.", id: "toolu_w" }]),
    T.for(WREN, T.proposeChange(DOC)),
    T.for(WREN, T.text(["Drafted. A human must approve it."])),
    T.for(LEAD, T.text(["Wren drafted the change; please review and approve it."])),
  ] });
  await loginAs(page, ADMIN);
  await sendMessage(page, "Have the right expert propose a clearer one-line explanation of the 'Fair' verdict.");
  const card = page.getByTestId("proposal-card").first();
  await expect(card).toBeVisible({ timeout: 45_000 });
  await expect(card.getByTestId("proposal-review")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(SEL.proposalBy).first()).toHaveText(t("agents.team.proposalBy", { agent: "Wren" }));
  await expect(page.locator(SEL.proposalBy).first()).toHaveAttribute("data-agent", WREN);
  await expect(card).toContainText("docs/fair-verdict.md");
  const diff = card.getByTestId("proposal-diff").first();
  await diff.locator("summary").click();
  await expect(diff.locator(".diff__marker").filter({ hasText: "+" }).first()).toBeVisible();
  await expect(leadChat(page).locator(SEL.asked)).toHaveText(t("agents.team.asked", { list: "Wren" }), { timeout: 30_000 });
  // place(): "Drafted by" and the card sit BEFORE Kai's reply bubble, even though Kai's reply text started first.
  const reply = leadChat(page).getByTestId("msg-agent").last();
  await expect(reply).toContainText("Wren drafted the change");
  const order = await page.evaluate(() => {
    const by = document.querySelector('[data-testid="proposal-by"]'), cardEl = document.querySelector('[data-testid="proposal-card"]');
    const msgs = [...document.querySelectorAll('[data-testid="msg-agent"]')], last = msgs[msgs.length - 1];
    const before = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    return { byBeforeCard: before(by, cardEl), byBeforeReply: before(by, last), cardBeforeReply: before(cardEl, last) };
  });
  expect(order, "proposal-by, then the card, then Kai's reply").toEqual({ byBeforeCard: true, byBeforeReply: true, cardBeforeReply: true });
  expect(approveRequests(), "showing a proposal approves nothing").toHaveLength(0);
  expect((await h.github.state()).commitCount).toBe(BASE);

  // Approve works end to end, exactly as for a chat proposal (docs-only: no deploy needed).
  await card.getByTestId("proposal-review").click();
  const sheet = page.getByTestId("approve-sheet");
  await expect(sheet).toBeVisible();
  await sheet.getByTestId("stepup-password").fill(ADMIN.password);
  await sheet.getByTestId("sheet-approve").click();
  await expect(page.getByTestId("proposal-status")).toContainText(/Committed [0-9a-f]{7,}\. No deploy needed\./, { timeout: 20_000 });
  const st = await h.github.state();
  expect(st.violations).toEqual([]);
  expect(st.commitCount).toBe(BASE + 1);
  const commit = (await h.github.log())[0];
  expect(commit.author.name, "the commit is attributed to the drafting expert, not to Kai").toBe(`Beach Day Agent (${WREN})`);
  expect(commit.message.trimEnd().split("\n").pop()).toMatch(/^Beach-Day-Proposal: p_[0-9A-Z]{26}$/);
  expect(await h.github.fileText({ path: "docs/fair-verdict.md" })).toBe(DOC.files[0].content);
});

test("default build (approveEnabled false, D10): the team proposal card shows 'Approve is off' and nothing is committed", async ({ page }) => {
  test.setTimeout(90_000);
  await h.harness.setApproveEnabled({ value: false });
  await h.anthropic.script({ turns: [
    consultTurn([{ agent: WREN, question: "Draft a one-line note.", id: "toolu_w" }]),
    T.for(WREN, T.proposeChange(DOC)),
    T.for(WREN, T.text(["Drafted."])),
    T.for(LEAD, T.text(["Wren drafted it."])),
  ] });
  await loginAs(page, ADMIN);
  await sendMessage(page, "Have Wren draft a note.");
  const card = page.getByTestId("proposal-card").first();
  await expect(card).toBeVisible({ timeout: 45_000 });
  await expect(page.locator(SEL.proposalBy).first()).toHaveText(t("agents.team.proposalBy", { agent: "Wren" }));
  await expect(page.locator(SEL.proposalBy).first()).toHaveAttribute("data-agent", WREN);
  await expect(page.getByTestId("approve-off")).toContainText(STRINGS["console.approve.disabled"], { timeout: 15_000 });
  await expect(card.getByTestId("proposal-review")).toHaveAttribute("aria-disabled", "true");
  expect(approveRequests()).toHaveLength(0);
  expect((await h.github.state()).commitCount).toBe(BASE);
});

test("role user: the no-access screen, no team card, and no /api/jobs or /api/chat call", async ({ page }) => {
  await loginAs(page, PLAIN);
  await expect(page.getByTestId("no-access")).toBeVisible();
  await expect(page.locator(SEL.team)).toHaveCount(0);
  await expect(page.getByTestId("chat-input")).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(c.apiCalls, "exactly one access check, then nothing").toEqual(["GET /api/agents"]);
  expect(jobStarts()).toEqual([]);
  expect(await h.anthropic.requests(), "Claude was never called").toEqual([]);
});

test("D6 through an expert: a consult that proposes public/js/console/x.js is refused, no card appears, Kai reports it, nothing is committed", async ({ page }) => {
  test.setTimeout(90_000);
  await h.anthropic.script({ turns: [
    consultTurn([{ agent: WREN, question: "Add a file public/js/console/x.js with a greeting.", id: "toolu_w" }]),
    T.for(WREN, T.proposeChange({ summary: "Add a greeting helper to the Agents page so the console feels friendlier today", files: [{ path: "public/js/console/x.js", content: "export const hi = 1;\n" }] }, { id: "toolu_p" })),
    T.for(WREN, T.text(["That path is protected, so I could not draft it."])),
    T.for(LEAD, T.text(["Wren could not draft it: public/js/console/** is off limits to agents."])),
  ] });
  await loginAs(page, ADMIN);
  await sendMessage(page, "Have someone add public/js/console/x.js.");
  const answer = leadChat(page).getByTestId("msg-agent").last();
  await expect(answer).toContainText("off limits to agents", { timeout: 45_000 });
  await expect(page.getByTestId("proposal-card")).toHaveCount(0);
  await expect(leadChat(page).locator(SEL.asked)).toHaveText(t("agents.team.asked", { list: "Wren" }));
  const wren = await requestsOf(WREN);
  expect(wren, "the expert got the refusal back and carried on").toHaveLength(2);
  expect(JSON.stringify(wren[1].body.messages), "the refusal is an is_error tool_result").toMatch(/"is_error":true/);
  expect((await h.github.state()).commitCount).toBe(BASE);
  expect(approveRequests()).toHaveLength(0);
  expect(await h.anthropic.pending()).toBe(0);
});

test("an expert that fails is reported, not fatal: \"Wren couldn't answer\", and Kai still answers with what Dewey said", async ({ page }) => {
  test.setTimeout(90_000);
  await h.anthropic.script({ turns: [
    consultTurn([{ agent: DEWEY, question: "Score Saturday.", id: "toolu_d" }, { agent: WREN, question: "Judge the wording.", id: "toolu_w" }]),
    T.for(DEWEY, T.text(["Dewey: Saturday is Good."])),
    T.for(WREN, T.refusal("I can")), // a refusal INSIDE a consult must not end Kai's turn (R-2)
    T.for(LEAD, T.text(["Only Dewey could answer: Saturday is Good."])),
  ] });
  await loginAs(page, ADMIN);
  const feed = captureJobJson(page);
  await sendMessage(page, "Score Saturday and check the wording.");
  await expect(page.locator(SEL.progress).filter({ hasText: t("agents.chat.tool.consult_expert.error", { agent: "Wren" }) })).toBeVisible({ timeout: 45_000 });
  await expect(leadChat(page).getByTestId("msg-agent").last()).toContainText("Only Dewey could answer", { timeout: 30_000 });
  await expect(page.getByTestId("chat-alert")).toBeEmpty(); // the turn did not fail
  await expect(page.locator(`${SEL.progress}[data-agent="${WREN}"]`)).toHaveAttribute("data-state", "failed");
  const ev = consultEvents(feed);
  expect(ev.find((e) => e.phase === "end" && e.agent === WREN)?.ok, "the end event says ok:false").toBe(false);
  expect(ev.find((e) => e.phase === "end" && e.agent === DEWEY)?.ok).toBe(true);
  expect(ev.filter((e) => "summary" in e), "no consult event carries a summary").toEqual([]);
});

test("axe: the landing view of Ask the team, and the same view while a team turn is running, have no violations", async ({ page }) => {
  test.setTimeout(90_000);
  await h.anthropic.script({ turns: [
    consultTurn([{ agent: DEWEY, question: "Score Saturday.", id: "toolu_d" }]),
    expertReport(DEWEY, "Dewey: Good."),
    T.for(LEAD, T.text(["Saturday is Good."])),
  ] });
  await loginAs(page, ADMIN);
  await expect(teamCard(page)).toBeVisible();
  const landing = await axe(page);
  expect(landing.violations, "landing").toEqual([]);
  await sendMessage(page, "Score Saturday.");
  await expect(page.locator(SEL.progress).first()).toBeVisible({ timeout: 20_000 });
  const running = await axe(page);
  expect(running.violations, "while the team works").toEqual([]);
  await expect(leadChat(page).locator(SEL.asked)).toBeVisible({ timeout: 30_000 });
  const done = await axe(page);
  expect(done.violations, "after the answer").toEqual([]);
});
