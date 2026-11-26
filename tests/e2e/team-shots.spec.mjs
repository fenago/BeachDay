// Review screenshots for "Ask the team" at deviceScaleFactor 2 (docs/qa/screenshots/<project>-team-<state>.png).
// Skipped in the normal suite; run with:  TEAM_SHOTS=1 npx playwright test tests/e2e/team-shots.spec.mjs --project=pixel --project=iphone-chromium --trace off
import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { consoleApp, seedUsers, loginAs, sendMessage, ADMIN, turns as T } from "../helpers/e2e.mjs";

test.skip(!process.env.TEAM_SHOTS, "set TEAM_SHOTS=1 to take the review screenshots");
test.use({ deviceScaleFactor: 2 });

const DIR = "docs/qa/screenshots";
const DEWEY = "open-meteo-integrator", WREN = "ux-designer-apple-hig", LEAD = "orchestrator";

test("team screenshots: landing, progress, answer, proposal", async ({ page, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  mkdirSync(DIR, { recursive: true });
  const shot = (state) => page.screenshot({ path: `${DIR}/${testInfo.project.name}-team-${state}.png`, fullPage: false });
  const c = await consoleApp(page, baseURL); const h = c.h; await seedUsers(h);
  const held = (agent, text, ms) => T.for(agent, T.held(T.text([text]), ms));
  await h.anthropic.script({ turns: [
    T.for(LEAD, T.consult([{ agent: DEWEY, question: "Is Saturday good at Hollywood Beach?", id: "toolu_d" }, { agent: WREN, question: "Is the wind rule too strict for families?", id: "toolu_w" }])),
    held(DEWEY, "Dewey: Saturday scores Good.", 6000),
    held(WREN, "Wren: the rule is fine.", 9000),
    T.for(LEAD, T.text(["Saturday is a Good beach day, and the wind rule is fine for families."])),
    T.for(LEAD, T.consult([{ agent: WREN, question: "Draft a one-line note about the Fair verdict.", id: "toolu_w2" }])),
    T.for(WREN, T.proposeChange({ summary: "Explain the Fair verdict in one clear line so visitors know why the day is only fair", files: [{ path: "docs/fair-verdict.md", content: "# Fair\n\nPick your hours: the best window is short.\n" }] })),
    T.for(WREN, T.text(["Drafted."])),
    T.for(LEAD, T.text(["Wren drafted the note. Please review and approve it."])),
  ] });
  await loginAs(page, ADMIN);
  await expect(page.getByTestId("team-card")).toBeVisible();
  await page.waitForTimeout(400);
  await shot("landing");
  await sendMessage(page, "Is Saturday a good beach day at Hollywood Beach, and is our wind rule too strict for families?");
  await expect(page.getByTestId("msg-progress").first()).toBeVisible({ timeout: 20_000 });
  await shot("progress");
  await expect(page.getByTestId("team-asked")).toBeVisible({ timeout: 40_000 });
  await shot("answer");
  await sendMessage(page, "Have Wren draft a one-line note about the Fair verdict.");
  await expect(page.getByTestId("proposal-card").first()).toBeVisible({ timeout: 40_000 });
  await page.getByTestId("proposal-card").first().scrollIntoViewIfNeeded();
  await shot("proposal");
});
