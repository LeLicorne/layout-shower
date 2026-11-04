// Construit dist/firefox et dist/chrome (+ zips dans web-ext-artifacts/) depuis manifest.json (Firefox).
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const FILES = ["manifest.json", "background.js", "popup", "content", "icons", "LICENSE"];
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));

rmSync("dist", { recursive: true, force: true });
rmSync("web-ext-artifacts", { recursive: true, force: true });

for (const target of ["firefox", "chrome"]) {
  const dir = `dist/${target}`;
  mkdirSync(dir, { recursive: true });
  for (const f of FILES) cpSync(f, `${dir}/${f}`, { recursive: true });

  if (target === "chrome") {
    const m = structuredClone(manifest);
    m.background = { service_worker: "background.js" };
    delete m.browser_specific_settings;
    writeFileSync(`${dir}/manifest.json`, JSON.stringify(m, null, 2) + "\n");
  }

  execFileSync(
    "npx",
    ["web-ext", "build", "-s", dir, "-a", "web-ext-artifacts", "-n", `layout_shower-{version}-${target}.zip`, "--overwrite-dest"],
    { stdio: "inherit" },
  );
}
