// Static server standing in for Netlify. Serves sw.js with __BUILD_VERSION__ stamped (like scripts/stamp-sw.mjs),
// and lets a test "deploy" a new version (POST /__deploy?v=...) or break the SW (POST /__mutant?kind=...).
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, extname } from "node:path";

const root = new URL("./site/", import.meta.url).pathname;
let version = "v1", mutant = "";
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json" };

createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const send = (status, body, headers = {}) => { res.writeHead(status, headers); res.end(body); };
  if (req.method === "POST" && url.pathname === "/__deploy") { version = url.searchParams.get("v"); return send(200, version); }
  if (req.method === "POST" && url.pathname === "/__mutant") { mutant = url.searchParams.get("kind") ?? ""; return send(200, mutant); }
  if (url.pathname === "/version.json") return send(200, JSON.stringify({ version, commit: version }), { "content-type": "application/json", "cache-control": "no-store" });
  if (url.pathname === "/sw.js") {
    let js = readFileSync(join(root, "sw.js"), "utf8").replace("__BUILD_VERSION__", version);
    if (mutant === "no-ignore-search") js = js.replaceAll("{ ignoreSearch: true }", "{}"); // the bug Pip warned about
    if (mutant === "precache-console") js = js.replace('"/offline.html"', '"/offline.html", "/console.html", "/vendor/auth.mjs", "/version.json"');
    return send(200, js, { "content-type": "text/javascript", "cache-control": "no-cache" });
  }
  if (url.pathname.startsWith("/api/")) return send(401, JSON.stringify({ error: { code: "unauthorized" } }), { "content-type": "application/json", "cache-control": "no-store" });
  const file = url.pathname === "/" ? "index.html" : url.pathname === "/console" ? "console.html" : url.pathname.slice(1);
  try { send(200, readFileSync(join(root, file)), { "content-type": types[extname(file)] ?? "text/plain" }); } catch { send(404, "not found"); }
}).listen(Number(process.env.PORT ?? 4174), "127.0.0.1");
