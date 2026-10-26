import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { handle } from "../src/functions/main.js";

const PORT = Number(process.env.PORT) || 8787;
const ROOT = new URL("../public/", import.meta.url).pathname;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

async function toRequest(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return new Request(`http://localhost:${PORT}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: chunks.length ? Buffer.concat(chunks) : undefined,
  });
}

createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (pathname.startsWith("/api/")) {
      const response = await handle(await toRequest(req));
      const headers = Object.fromEntries([...response.headers].filter(([name]) => name !== "set-cookie"));
      const cookies = response.headers.getSetCookie();
      if (cookies.length) headers["set-cookie"] = cookies;
      res.writeHead(response.status, headers);
      return res.end(Buffer.from(await response.arrayBuffer()));
    }
    const file = normalize(join(ROOT, extname(pathname) ? pathname : "/index.html"));
    if (!file.startsWith(ROOT)) throw Object.assign(new Error("forbidden"), { code: "ENOENT" });
    const data = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(data);
  } catch (error) {
    res.writeHead(error.code === "ENOENT" ? 404 : 500, { "content-type": "text/plain" });
    res.end(error.code === "ENOENT" ? "Not found" : String(error));
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
