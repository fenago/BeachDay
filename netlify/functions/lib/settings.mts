// Every pending Dr. Lee decision and launch switch lives here (build_plan §1). Change a value, not code.
export const SETTINGS = Object.freeze({
  computeBudgetMinutes: 180,                 // D1, site:compute, rolling 31 days
  computeNeedChatMs: 60_000, computeNeedJobMs: 300_000,
  githubReadTokenEnv: "GITHUB_TOKEN",        // D2, ADR-0009 Proposed; "GITHUB_READ_TOKEN" if accepted (no fallback)
  serverRefusalFallback: false,              // D5
  denyConsoleUi: false,                      // D6, deny public/console.html + public/js/console/** when true
  approveCap: Object.freeze({ per31Days: 14, perDay: 5, timeZone: "America/New_York" }), // D7, ADR-0008
  approveEnabled: false,                     // D10, pre-launch switch (docs/04 §1 step 5, §4.2)
  jwtHeaderPrecheck: false,                  // D12, on after pre-launch test (f)
  perUserDaily: Object.freeze({ chat: 200, jobs: 20 }),
  perTurn: Object.freeze({ maxToolRounds: 15, maxToolCallsPerRound: 10, maxTokens: 1_000_000, maxUserMessageBytes: 32_768 }),
  chatDeadlineMs: 55_000, chatSdkTimeoutMs: 50_000, jobWallClockMs: 14 * 60_000,
  stepUpWindowS: 600,
  allowedModels: Object.freeze(["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]),
});
