import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import worker, { STATICS } from "./worker.js";

const PORT = Number(process.env.PORT || 8787);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

for (const file of ["index.html", "styles.css", "app.js"]) {
  STATICS.set(`/${file}`, fs.readFileSync(path.join(root, file)));
}

http
  .createServer(async (req, res) => {
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
      else if (v !== undefined) headers.set(k, v);
    }
    try {
      const response = await worker.fetch(
        new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers }),
      );
      res.statusCode = response.status;
      response.headers.forEach((v, k) => res.setHeader(k, v));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (err) {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "dev_server_crash", message: err.message }));
    }
  })
  .listen(PORT, () => console.log(`status-page listening on http://localhost:${PORT}`));
