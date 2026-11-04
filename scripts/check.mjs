// Garde-fous sur dist/ : manifests cohérents, fichiers référencés présents, shim `browser` en place.
import { existsSync, readFileSync } from "node:fs";

const errors = [];
const fail = (m) => errors.push(m);
const read = (t) => JSON.parse(readFileSync(`dist/${t}/manifest.json`, "utf8"));
const ff = read("firefox");
const ch = read("chrome");

if (ff.version !== ch.version) fail("versions différentes entre Firefox et Chrome");
if (!ff.background?.scripts) fail("Firefox : background.scripts manquant");
if (ff.background?.service_worker) fail("Firefox : service_worker ne doit pas être présent");
if (!ff.browser_specific_settings?.gecko?.id) fail("Firefox : id gecko manquant");
if (ch.background?.service_worker !== "background.js") fail("Chrome : service_worker manquant");
if (ch.background?.scripts) fail("Chrome : background.scripts ne doit pas être présent");
if (ch.browser_specific_settings) fail("Chrome : browser_specific_settings ne doit pas être présent");

for (const [t, m] of [["firefox", ff], ["chrome", ch]]) {
  const refs = [
    ...Object.values(m.icons ?? {}),
    ...Object.values(m.action?.default_icon ?? {}),
    m.action?.default_popup,
    ...(m.background?.scripts ?? []),
    m.background?.service_worker,
  ].filter(Boolean);
  for (const r of refs) if (!existsSync(`dist/${t}/${r}`)) fail(`${t} : fichier référencé introuvable : ${r}`);
  for (const js of ["background.js", "popup/popup.js", "content/overlay.js"]) {
    const src = readFileSync(`dist/${t}/${js}`, "utf8");
    if (/\bbrowser\./.test(src) && !src.includes("globalThis.browser ??= globalThis.chrome"))
      fail(`${t} : ${js} utilise browser.* sans shim`);
  }
}

if (errors.length) {
  console.error(errors.map((e) => "✗ " + e).join("\n"));
  process.exit(1);
}
console.log("✓ dist/ cohérent (firefox + chrome)");
