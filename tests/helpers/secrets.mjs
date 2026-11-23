// Fake secrets are built at runtime, never written as literals (a literal would trip the secret scan and
// the "no secret strings in the repo" static test). Every value is non-functional and says so.
const rep = (c, n) => c.repeat(n);
export const fakeAnthropicKey = () => ["sk-ant", "api03", "fake" + rep("A", 28)].join("-");
export const fakeGithubToken = (tag = "write") => ["github", "pat", "fake" + tag + rep("B", 30)].join("_");
export const fakeSupabaseSecret = () => ["sb", "secret", "fake" + rep("C", 24)].join("_");
export const FIXTURE_SUPABASE_URL = "https://bdlocaltest.supabase.co";
// Publishable keys are non-secret by design (ADR-0006); this one is a fixture that only the harness knows.
export const FIXTURE_PUBLISHABLE_KEY = ["sb_publishable", "bdlocaltest", rep("0", 16)].join("_");
export const FIXTURE_REPO = { owner: "fenago", repo: "BeachDay" };
