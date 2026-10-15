// Inlines backend modules and front-end assets into a self-contained ./index.js,
// the default entry the Azion `javascript` preset builds from.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const modules = ["backend/queries.js", "backend/health.js", "backend/platform.js", "backend/worker.js"]
  .map((file) =>
    read(file)
      .replace(/^import .*;\n/gm, "")
      .replace(/^export (?!default)/gm, ""),
  )
  .join("\n");

const statics = ["index.html", "styles.css", "app.js"]
  .map((file) => `STATICS.set(${JSON.stringify("/" + file)}, ${JSON.stringify(read(file))});`)
  .join("\n");

const out = modules.replace(
  /export default \{ fetch: handle \};\s*$/m,
  `${statics}\n\nexport default { fetch: handle };\n`,
);

fs.writeFileSync(path.join(root, "index.js"), out);
console.log(`wrote index.js (${out.length} bytes)`);
