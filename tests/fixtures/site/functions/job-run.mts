export function createJobRunHandler(deps: any) {
  return async (req: Request): Promise<Response> => {
    await new Promise((r) => setTimeout(r, 100));
    await deps.getStore("probe").setJSON("job-ran", { ok: true });
    return new Response("done");
  };
}
