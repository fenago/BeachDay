export function createProposalHandler() {
  return async (_req: Request, ctx: any): Promise<Response> => Response.json({ id: ctx.params.id });
}
