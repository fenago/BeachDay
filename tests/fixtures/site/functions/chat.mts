export function createChatHandler(deps: any) {
  return async (req: Request): Promise<Response> => {
    const body = await req.json();
    if (body.throw) throw new Error("boom with a secret-looking detail");
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      async start(c) {
        c.enqueue(enc.encode(`event: text\ndata: ${JSON.stringify({ delta: "one" })}\n\n`));
        await new Promise((r) => setTimeout(r, 150));
        c.enqueue(enc.encode(`event: done\ndata: ${JSON.stringify({ stopReason: "end_turn" })}\n\n`));
        c.close();
      },
      cancel() { (globalThis as any).__chatCancelled = true; },
    });
    return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
  };
}
