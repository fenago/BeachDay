// Harness self-test handler (NOT product code): echoes what the harness hands a real handler.
export function createAgentsHandler(deps: any) {
  return async (req: Request, ctx: any): Promise<Response> => {
    const store = deps.getStore("probe");
    await store.setJSON("seen", { n: 1 });
    return new Response(JSON.stringify({ method: req.method, url: req.url, context: ctx.deploy.context, requestId: ctx.requestId, origin: req.headers.get("origin"), secFetchSite: req.headers.get("sec-fetch-site"), hasEnvKey: typeof deps.env.ANTHROPIC_API_KEY === "string", approveEnabled: deps.settings.approveEnabled, supabaseUrl: deps.supabase.url, stores: Object.keys(deps.stores).sort(), startJobIsFn: typeof deps.startJob === "function" }), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  };
}
