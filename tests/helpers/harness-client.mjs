// Control client for a RUNNING harness (Playwright specs run in another process than the webServer).
//   const h = harnessClient(baseURL);  await h.supabase.addUser({ email, password });  await h.reset();
// Every method is one POST /__harness/ctl { op, args }. Ops are listed in tests/harness/server.mjs (ctlOps).
export function harnessClient(baseURL) {
  const call = async (op, args = {}) => {
    const res = await fetch(`${baseURL}/__harness/ctl`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op, args }) });
    const j = await res.json();
    if (!res.ok) throw new Error(`harness ctl ${op}: ${j.error ?? res.status}`);
    return j.result;
  };
  const ns = (prefix, names) => Object.fromEntries(names.map((n) => [n, (args) => call(`${prefix}.${n}`, args)]));
  return {
    call,
    supabase: ns("supabase", ["addUser", "setRole", "deleteProfile", "confirm", "setGoogle", "lastEmail", "outbox", "currentTotp", "enrollVerifiedTotp", "mint", "ageSignIn", "fail", "clearFailures", "calls", "callCount", "resetCalls", "restWrites", "sessionCount", "setSiteUrl", "allowRedirectUrl", "mintExpired"]),
    blobs: ns("blobs", ["peek", "seed", "callCount", "resetCalls", "reset", "keys"]),
    github: ns("github", ["state", "fileText", "log", "pushConcurrent", "failNextPatchWithRace", "patchAppliesThen", "patchFails502", "setReadDown", "failNext"]),
    anthropic: ns("anthropic", ["script", "requests", "pending"]),
    harness: ns("harness", ["setVersion", "setDeployContext", "setApproveEnabled", "setSettings", "advanceClock", "settled", "log", "unexpectedHosts", "routes"]),
    reset: () => call("harness.reset"),
  };
}
