# Server-sent events and ReadableStream (the `/api/chat` contract)
Source: https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events ; https://developer.mozilla.org/en-US/docs/Web/API/EventSource/EventSource ; https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream
Retrieved: 2026-11-23

## Event stream format

From [Using server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events):

- The response MIME type is **`text/event-stream`**. Text "must be encoded using UTF-8".
- "Messages in the event stream are separated by a pair of newline characters." Each message is one or more `field: value` lines.
- "A colon as the first character of a line is in essence a comment, and is ignored." A periodic comment line (e.g. `: ping`) keeps connections from timing out.
- Fields:

| Field | Meaning |
|---|---|
| `event` | Event type name. EventSource dispatches it to `addEventListener(name)`; without it, `onmessage` fires |
| `data` | Payload. "multiple consecutive lines that begin with `data:`" are concatenated "inserting a newline character between each one. Trailing newlines are removed." |
| `id` | Sets the EventSource's last event ID |
| `retry` | Reconnection time in **milliseconds**, integer only; a non-integer is ignored |

- "All other field names are ignored." A line without a colon is a field name with an empty value.
- MDN's server example sends `Content-Type: text/event-stream`, `Cache-Control: no-cache` and `X-Accel-Buffering: no` (to stop proxy buffering).
- **Connection limit:** without HTTP/2, SSE is capped at **6** open connections "per browser + domain" (marked "Won't fix" in Chrome and Firefox). With HTTP/2 the stream limit is negotiated (default 100).

## EventSource vs fetch

- `new EventSource(url, { withCredentials })`: the only options are the URL and `withCredentials` (default `false`). ([EventSource()](https://developer.mozilla.org/en-US/docs/Web/API/EventSource/EventSource))
- There is no option for an HTTP method, request body or custom headers. So EventSource can't send our `POST /api/chat` body or the `Authorization: Bearer` header (ADR-0006). The constructor's option list shows this, but MDN doesn't state it in so many words.
- Use **`fetch()` + `response.body` (a ReadableStream)** and parse the SSE format ourselves.

## ReadableStream

From [ReadableStream](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream):

- "represents a readable stream of byte data". `fetch` exposes one as `Response.body`.
- Members: `locked`, `cancel()`, `getReader()` (locks the stream), `pipeThrough()`, `pipeTo()`, `tee()`, `values()`.
- `reader.read()` resolves `{ done, value }`, where `value` is a `Uint8Array`.
- "ReadableStream implements the async iterable protocol", so `for await (const chunk of stream)` works. Use `stream.values({ preventCancel: true })` to keep the stream after a `break`.
- Decode with `pipeThrough(new TextDecoderStream())`. `TextDecoderStream` is not on the pages read; **[UNVERIFIED]** here, but it is a standard Encoding API interface.

Minimal client parser shape:

```js
const res = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` }, body, signal });
let buf = '';
for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n\n')) >= 0) {           // messages end with a blank line
    const block = buf.slice(0, i); buf = buf.slice(i + 2);
    let event = 'message'; const data = [];
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) continue;               // comment / keep-alive
      const [f, ...r] = line.split(':'); const v = r.join(':').replace(/^ /, '');
      if (f === 'event') event = v; else if (f === 'data') data.push(v);
    }
    onEvent(event, JSON.parse(data.join('\n')));
  }
}
```

## Beach Day notes

- **Event types and fields are fixed by docs/04 §2.1** (IDs `p_`/`j_` + ULID; `error.code` uses the **one code list** shared with JSON errors, e.g. `unauthorized`, `forbidden`, `rate_limited`, `budget_exhausted`): `text`, `tool`, `proposal`, `handoff`, `error`, `done`. Each message is `event: <type>` + one `data:` line of JSON. The JSON Schema union for these is in `examples/02-interface-contracts/schemas/sse-event.schema.json`. The client and function must both validate against it.
- **Headers on `/api/chat`:** `content-type: text/event-stream`, `cache-control: no-store` (docs/04; stricter than MDN's `no-cache`, correct for authenticated output). Consider `x-accel-buffering: no`; whether Netlify buffers without it is **[UNVERIFIED]**.
- **Keep-alive:** send `: ping\n\n` about every 15 s during long tool rounds, so intermediaries don't drop an idle stream inside Netlify's 60 s limit.
- **Errors before the stream opens are plain JSON, not SSE** (docs/04 §2.1): auth, role, Origin, body and limit failures answer with their HTTP status and `application/json`. Check `res.ok` and `content-type` before parsing the body as SSE.
- **Terminal events:** every stream ends with exactly one `done` or `error`. `handoff` (switching to a background job at about 45 s) is followed by `done` so the client closes cleanly and starts polling `/api/jobs/:id`.
- **No `id`/`retry` and no auto-reconnect.** A chat turn isn't resumable, because a retry would re-run the Claude call and cost tokens. Reconnection means polling the job.
- **Six-connection limit:** irrelevant on Netlify's HTTP/2 CDN in practice, but the Console must close each stream (`AbortController`) before starting the next turn.
- **Never put secrets or raw tool inputs that might contain them in `data:`.** Stream only what the UI shows (`secure-by-design`).
