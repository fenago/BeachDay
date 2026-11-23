// Parse a text/event-stream body into [{event, data}] (data JSON-parsed when possible).
export function parseSse(text) {
  return text.split("\n\n").filter((b) => b.trim()).map((block) => {
    const ev = { event: "message", data: "" };
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) ev.event = line.slice(6).trim();
      else if (line.startsWith("data:")) ev.data += line.slice(5).trim();
    }
    try { ev.data = JSON.parse(ev.data); } catch { /* keep the string */ }
    return ev;
  });
}
